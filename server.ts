import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

import crypto from 'crypto';
import { ProductSchema, SaleSchema, EmployeeSchema, AdminActivateBoutiqueSchema } from './src/lib/serverValidation';

dotenv.config({ path: '.env.local' });
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// SÉCURITÉ FORTERESSE - EN-TÊTES HTTP SÉCURISÉS (CSP, X-Frame-Options, XSS, etc.)
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self' https: data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: blob: https:; connect-src 'self' https: wss:; font-src 'self' https: data:; frame-ancestors 'self' https:;"
  );
  next();
});

// Limitation de taille des payloads JSON contre les attaques DoS
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// Supabase client pour le backend (Zéro clé en clair dans le code)
const supabaseUrl = (process.env.VITE_SUPABASE_URL || 'https://ebqhujxkliutkkhgsekd.supabase.co').trim();
const supabaseAnonKey = (process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '').trim();
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// ==============================================================================
// RATE LIMITING ANTI-BRUTE FORCE (SLIDING WINDOW)
// ==============================================================================
interface RateLimitRecord {
  count: number;
  resetAt: number;
}
const rateLimitMaps = new Map<string, Map<string, RateLimitRecord>>();

function createRateLimiter(bucketName: string, maxRequests: number, windowMs: number) {
  if (!rateLimitMaps.has(bucketName)) {
    rateLimitMaps.set(bucketName, new Map());
  }
  const bucket = rateLimitMaps.get(bucketName)!;

  return (req: Request, res: Response, next: NextFunction) => {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || '127.0.0.1';
    const now = Date.now();
    const record = bucket.get(ip);

    if (!record || now > record.resetAt) {
      bucket.set(ip, { count: 1, resetAt: now + windowMs });
      return next();
    }

    if (record.count >= maxRequests) {
      const retryAfterSec = Math.ceil((record.resetAt - now) / 1000);
      res.setHeader('Retry-After', retryAfterSec.toString());
      return res.status(429).json({
        error: 'TOO_MANY_REQUESTS',
        message: `Limite de requêtes atteinte. Veuillez patienter ${retryAfterSec} secondes.`,
      });
    }

    record.count++;
    return next();
  };
}

const adminLoginLimiter = createRateLimiter('admin_login', 5, 15 * 60 * 1000); // 5 tentatives / 15 min
const generalApiLimiter = createRateLimiter('api_general', 120, 60 * 1000); // 120 req / min

// Appliquer le limiteur général sur toutes les requêtes API
app.use('/api', generalApiLimiter);

// ==============================================================================
// 1. DÉFINITION DES PLANS & LIMITES STRICTES
// ==============================================================================
export interface PlanConfig {
  name: string;
  maxArticles: number;
  maxEmployes: number;
  maxAppareils: number;
  maxBoutiques: number;
  hasVocal: boolean;
  hasOfficialInvoice: boolean;
  hasPrioritySupport: boolean;
  hasAdvancedExport: boolean;
  features: {
    voix_efa: boolean;
    micro_vocal: boolean;
    benefice_caisse: boolean;
    recu_whatsapp: boolean;
    facture_officielle_pdf: boolean;
    export_comptable_avance: boolean;
    support_whatsapp_prioritaire: boolean;
    historique_illimite: boolean;
    sauvegarde_cloud_auto: boolean;
  };
}

export const BACKEND_PLANS: Record<string, PlanConfig> = {
  trial: {
    name: 'Essai Gratuit 21 Jours',
    maxArticles: 50,
    maxEmployes: 2,
    maxAppareils: 2,
    maxBoutiques: 1,
    hasVocal: false,
    hasOfficialInvoice: true,
    hasPrioritySupport: false,
    hasAdvancedExport: false,
    features: {
      voix_efa: true,
      micro_vocal: false,
      benefice_caisse: true,
      recu_whatsapp: true,
      facture_officielle_pdf: true,
      export_comptable_avance: false,
      support_whatsapp_prioritaire: false,
      historique_illimite: false,
      sauvegarde_cloud_auto: true,
    },
  },
  free: {
    name: 'Gratuit Limité',
    maxArticles: 7,
    maxEmployes: 1,
    maxAppareils: 1,
    maxBoutiques: 1,
    hasVocal: false,
    hasOfficialInvoice: false,
    hasPrioritySupport: false,
    hasAdvancedExport: false,
    features: {
      voix_efa: false,
      micro_vocal: false,
      benefice_caisse: true,
      recu_whatsapp: true,
      facture_officielle_pdf: false,
      export_comptable_avance: false,
      support_whatsapp_prioritaire: false,
      historique_illimite: false,
      sauvegarde_cloud_auto: false,
    },
  },
  populaire: {
    name: 'Offre Populaire (1 500 F/mois)',
    maxArticles: 100, // max 100 articles
    maxEmployes: 3, // max 3 vendeurs PIN
    maxAppareils: 3, // max 3 appareils connectés
    maxBoutiques: 1, // max 1 boutique
    hasVocal: false, // BLOCK micro vocal actif
    hasOfficialInvoice: false, // Facture officielle PDF bloquée (réservée Pro)
    hasPrioritySupport: false,
    hasAdvancedExport: false,
    features: {
      voix_efa: true,
      micro_vocal: false, // BLOQUÉ
      benefice_caisse: true,
      recu_whatsapp: true,
      facture_officielle_pdf: false, // BLOQUÉ
      export_comptable_avance: false, // BLOQUÉ
      support_whatsapp_prioritaire: false,
      historique_illimite: false,
      sauvegarde_cloud_auto: true,
    },
  },
  pro: {
    name: 'Boutique Pro (4 999 F/mois)',
    maxArticles: 300, // max 300 articles
    maxEmployes: 10, // max 10 vendeurs PIN
    maxAppareils: 5, // max 5 appareils connectés
    maxBoutiques: 3, // max 3 boutiques distinctes
    hasVocal: true, // ALLOW Voix EFA + micro vocal
    hasOfficialInvoice: true, // ALLOW reçu + facture officielle PDF
    hasPrioritySupport: true,
    hasAdvancedExport: true, // ALLOW export comptable avancé
    features: {
      voix_efa: true,
      micro_vocal: true, // DÉBLOQUÉ
      benefice_caisse: true,
      recu_whatsapp: true,
      facture_officielle_pdf: true, // DÉBLOQUÉ
      export_comptable_avance: true, // DÉBLOQUÉ
      support_whatsapp_prioritaire: true,
      historique_illimite: true,
      sauvegarde_cloud_auto: true,
    },
  },
  expired: {
    name: 'Essai Expiré',
    maxArticles: 0,
    maxEmployes: 0,
    maxAppareils: 0,
    maxBoutiques: 0,
    hasVocal: false,
    hasOfficialInvoice: false,
    hasPrioritySupport: false,
    hasAdvancedExport: false,
    features: {
      voix_efa: false,
      micro_vocal: false,
      benefice_caisse: false,
      recu_whatsapp: false,
      facture_officielle_pdf: false,
      export_comptable_avance: false,
      support_whatsapp_prioritaire: false,
      historique_illimite: false,
      sauvegarde_cloud_auto: false,
    },
  },
};

// Mémoire cache des appareils connectés
const activeDevicesMap = new Map<string, Set<string>>();

// Helper pour récupérer le statut d'abonnement actif d'un patron
async function getPatronSubscription(patronId: string) {
  try {
    const { data: patron } = await supabase
      .from('patrons')
      .select('subscription_status, current_plan, subscription_end_date, trial_end_date')
      .eq('id', patronId)
      .maybeSingle();

    if (patron) {
      let plan = patron.current_plan || patron.subscription_status || 'trial';
      const endDate = patron.subscription_end_date || patron.trial_end_date;
      if (endDate && new Date(endDate) < new Date() && plan !== 'free') {
        plan = 'expired';
      }
      return { plan, endDate, config: BACKEND_PLANS[plan] || BACKEND_PLANS.trial };
    }
  } catch (err) {
    console.warn('[Backend] Erreur lecture patron:', err);
  }
  return { plan: 'trial', endDate: null, config: BACKEND_PLANS.trial };
}

// ==============================================================================
// 2. MIDDLEWARE CHECK SUBSCRIPTION (ENFORCEMENT STRICT)
// ==============================================================================
export function checkSubscription(
  action: 'create_article' | 'create_vendeur' | 'login_device' | 'create_boutique' | 'use_feature',
  featureKey?: string
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const patronId = (req.body?.patron_id || req.headers['x-patron-id'] || req.query?.patron_id) as string;

    if (!patronId) {
      // Si pas de patronId dans la requête, autoriser pour compatibilité tout en avertissant
      return next();
    }

    const { plan, config } = await getPatronSubscription(patronId);

    if (plan === 'expired') {
      return res.status(403).json({
        error: 'SUBSCRIPTION_EXPIRED',
        message: "Votre période d'abonnement a expiré. Veuillez choisir un forfait pour continuer.",
        plan,
      });
    }

    try {
      if (action === 'create_article') {
        const { count, error } = await supabase
          .from('produits')
          .select('*', { count: 'exact', head: true })
          .eq('patron_id', patronId);

        const currentCount = error ? (req.body?.current_count || 0) : (count || 0);
        if (currentCount >= config.maxArticles) {
          return res.status(403).json({
            error: 'LIMIT_ARTICLES_REACHED',
            message: `Limite de ${config.maxArticles} articles atteinte pour le forfait ${config.name}. Passez à Pro pour ajouter jusqu'à 300 articles.`,
            plan,
            limit: config.maxArticles,
            current: currentCount,
            upgradePlan: 'pro',
          });
        }
      } else if (action === 'create_vendeur') {
        const { count, error } = await supabase
          .from('employes')
          .select('*', { count: 'exact', head: true })
          .eq('patron_id', patronId)
          .neq('status', 'deleted');

        const currentCount = error ? (req.body?.current_count || 0) : (count || 0);
        if (currentCount >= config.maxEmployes) {
          return res.status(403).json({
            error: 'LIMIT_EMPLOYEES_REACHED',
            message: `Limite de ${config.maxEmployes} vendeurs atteinte pour le forfait ${config.name}. Passez à Pro pour ajouter jusqu'à 10 vendeurs avec code PIN.`,
            plan,
            limit: config.maxEmployes,
            current: currentCount,
            upgradePlan: 'pro',
          });
        }
      } else if (action === 'create_boutique') {
        const currentCount = req.body?.current_count || 1;
        if (currentCount >= config.maxBoutiques) {
          return res.status(403).json({
            error: 'LIMIT_BOUTIQUES_REACHED',
            message: `Le multi-boutique (jusqu'à 3 boutiques distinctes) est réservé à l'offre Boutique Pro.`,
            plan,
            limit: config.maxBoutiques,
            current: currentCount,
            upgradePlan: 'pro',
          });
        }
      } else if (action === 'login_device') {
        const deviceId = (req.body?.device_id || req.headers['x-device-id']) as string;
        if (deviceId) {
          let devices = activeDevicesMap.get(patronId);
          if (!devices) {
            devices = new Set<string>();
            activeDevicesMap.set(patronId, devices);
          }
          if (!devices.has(deviceId) && devices.size >= config.maxAppareils) {
            return res.status(403).json({
              error: 'LIMIT_DEVICES_REACHED',
              message: `Limite de ${config.maxAppareils} appareils connectés atteinte pour votre compte. Passez à Pro pour connecter jusqu'à 5 appareils.`,
              plan,
              limit: config.maxAppareils,
              current: devices.size,
              upgradePlan: 'pro',
            });
          }
          devices.add(deviceId);
        }
      } else if (action === 'use_feature' && featureKey) {
        const isAllowed = (config.features as any)?.[featureKey];
        if (!isAllowed) {
          return res.status(403).json({
            error: 'FEATURE_LOCKED',
            message: `La fonctionnalité "${featureKey}" est réservée à l'offre Boutique Pro.`,
            plan,
            upgradePlan: 'pro',
          });
        }
      }
    } catch (err) {
      console.warn('[checkSubscription] Erreur de vérification:', err);
    }

    return next();
  };
}

// ==============================================================================
// 3. ROUTES API SUBSCRIPTIONS & ENFORCEMENT
// ==============================================================================

// Vérification dynamique pour le frontend
app.post('/api/subscriptions/check', async (req: Request, res: Response) => {
  const { patron_id, action, feature, current_count } = req.body;
  if (!patron_id) {
    return res.json({ allowed: true });
  }

  const { plan, config } = await getPatronSubscription(patron_id);

  if (action === 'create_article') {
    const isAllowed = (current_count || 0) < config.maxArticles;
    return res.json({
      allowed: isAllowed,
      plan,
      limit: config.maxArticles,
      current: current_count || 0,
      message: isAllowed ? 'OK' : `Limite de ${config.maxArticles} articles atteinte. Passez à Pro pour 300 articles.`,
    });
  }

  if (action === 'create_vendeur') {
    const isAllowed = (current_count || 0) < config.maxEmployes;
    return res.json({
      allowed: isAllowed,
      plan,
      limit: config.maxEmployes,
      current: current_count || 0,
      message: isAllowed ? 'OK' : `Limite de ${config.maxEmployes} vendeurs PIN atteinte. Passez à Pro pour 10 vendeurs.`,
    });
  }

  if (action === 'login_device') {
    const isAllowed = (current_count || 0) < config.maxAppareils;
    return res.json({
      allowed: isAllowed,
      plan,
      limit: config.maxAppareils,
      message: isAllowed ? 'OK' : `Limite de ${config.maxAppareils} appareils connectés atteinte.`,
    });
  }

  if (action === 'create_boutique') {
    const isAllowed = (current_count || 0) < config.maxBoutiques;
    return res.json({
      allowed: isAllowed,
      plan,
      limit: config.maxBoutiques,
      message: isAllowed ? 'OK' : `Multi-boutique réservé à Boutique Pro (jusqu'à 3 boutiques).`,
    });
  }

  if (action === 'use_feature' && feature) {
    const isAllowed = Boolean((config.features as any)?.[feature]);
    return res.json({
      allowed: isAllowed,
      plan,
      feature,
      message: isAllowed ? 'OK' : `Fonctionnalité réservée à l'offre Boutique Pro.`,
    });
  }

  return res.json({ allowed: true, plan });
});

// Récupération de l'état complet de l'abonnement
app.get('/api/subscriptions/:patronId', async (req: Request, res: Response) => {
  const { patronId } = req.params;
  const { plan, endDate, config } = await getPatronSubscription(patronId);

  let articlesCount = 0;
  let employesCount = 0;

  try {
    const [pRes, eRes] = await Promise.all([
      supabase.from('produits').select('*', { count: 'exact', head: true }).eq('patron_id', patronId),
      supabase.from('employes').select('*', { count: 'exact', head: true }).eq('patron_id', patronId).neq('status', 'deleted'),
    ]);
    articlesCount = pRes.count || 0;
    employesCount = eRes.count || 0;
  } catch (e) {
    // ignore
  }

  const devices = activeDevicesMap.get(patronId);
  const devicesCount = devices ? devices.size : 1;

  res.json({
    patron_id: patronId,
    plan,
    plan_name: config.name,
    expires_at: endDate,
    limits: {
      limit_articles: config.maxArticles,
      limit_vendeurs: config.maxEmployes,
      limit_appareils: config.maxAppareils,
      limit_boutiques: config.maxBoutiques,
    },
    usage: {
      articles: articlesCount,
      vendeurs: employesCount,
      appareils: devicesCount,
      boutiques: 1,
    },
    features: config.features,
  });
});

// Création d'article avec validation backend
app.post('/api/articles', checkSubscription('create_article'), async (req: Request, res: Response) => {
  const article = req.body;
  if (!article || !article.nom || !article.patron_id) {
    return res.status(400).json({ error: 'Article invalide' });
  }

  try {
    const { data, error } = await supabase.from('produits').upsert(article).select().maybeSingle();
    if (error) throw error;
    return res.status(201).json({ success: true, article: data || article });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Erreur sauvegarde article' });
  }
});

// Création d'employé avec validation backend
app.post('/api/vendeurs', checkSubscription('create_vendeur'), async (req: Request, res: Response) => {
  const vendeur = req.body;
  if (!vendeur || !vendeur.nom || !vendeur.patron_id) {
    return res.status(400).json({ error: 'Vendeur invalide' });
  }

  try {
    const { data, error } = await supabase.from('employes').upsert(vendeur).select().maybeSingle();
    if (error) throw error;
    return res.status(201).json({ success: true, vendeur: data || vendeur });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Erreur sauvegarde vendeur' });
  }
});

// Enregistrement d'appareil avec validation backend
app.post('/api/appareils/login', checkSubscription('login_device'), (req: Request, res: Response) => {
  const { patron_id, device_id } = req.body;
  return res.json({ success: true, patron_id, device_id, message: 'Appareil autorisé' });
});

// Création de boutique avec validation backend
app.post('/api/boutiques', checkSubscription('create_boutique'), async (req: Request, res: Response) => {
  const boutique = req.body;
  return res.status(201).json({ success: true, boutique, message: 'Boutique créée avec succès' });
});

// ==============================================================================
// 4. WEBHOOK PAIEMENT AUTO (INSTANT UNLOCK)
// ==============================================================================
app.post('/api/webhooks/paiement', async (req: Request, res: Response) => {
  const {
    patron_id,
    plan,
    billing_cycle = 'mensuel',
    transaction_id,
    montant,
    moyen_paiement = 'Mobile Money',
  } = req.body;

  if (!patron_id || !plan || (plan !== 'populaire' && plan !== 'pro')) {
    return res.status(400).json({
      error: 'INVALID_PAYLOAD',
      message: 'patron_id et plan (populaire ou pro) requis.',
    });
  }

  const daysToAdd = billing_cycle === 'annuel' ? 365 : 30;
  const now = new Date();
  const expiresDate = new Date(now.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
  const expiresAt = expiresDate.toISOString();

  const config = BACKEND_PLANS[plan];

  try {
    // 1. Mise à jour Patron
    await supabase
      .from('patrons')
      .update({
        subscription_status: plan,
        current_plan: plan,
        subscription_end_date: expiresAt,
      })
      .eq('id', patron_id);

    // 2. Mise à jour ou insertion dans abonnements
    await supabase
      .from('abonnements')
      .upsert(
        {
          entreprise_id: patron_id,
          statut: 'actif',
          plan,
          expire_le: expiresAt,
        },
        { onConflict: 'entreprise_id' }
      );

    // 3. Mise à jour de tous les employés du patron
    await supabase
      .from('employes')
      .update({ subscription_status: plan })
      .eq('patron_id', patron_id);

    // 4. Log dans historique_actions
    await supabase.from('historique_actions').insert({
      id: `hist_pay_${Date.now()}`,
      patron_id,
      action_type: 'abonnement_paiement',
      description: `Paiement ${montant || ''} F (${moyen_paiement}) validé. Forfait ${config.name} activé jusqu'au ${expiresDate.toLocaleDateString('fr-FR')}. Ref: ${transaction_id || 'AUTO'}`,
      montant: montant || (plan === 'populaire' ? 1500 : 4999),
      created_at: now.toISOString(),
    });

    console.log(`[WEBHOOK PAIEMENT] ✅ Forfait ${plan.toUpperCase()} activé pour patron ${patron_id}`);

    return res.json({
      success: true,
      plan,
      plan_name: config.name,
      expires_at: expiresAt,
      limits: {
        limit_articles: config.maxArticles,
        limit_vendeurs: config.maxEmployes,
        limit_appareils: config.maxAppareils,
        limit_boutiques: config.maxBoutiques,
      },
      message: `Abonnement ${config.name} activé avec succès !`,
    });
  } catch (err: any) {
    console.error('[WEBHOOK PAIEMENT] ❌ Erreur:', err);
    return res.status(500).json({ error: 'DATABASE_ERROR', message: err.message });
  }
});

// ==============================================================================
// 4.5. ENDPOINTS MODE SUPER ADMIN SÉPARÉ ET SÉCURISÉ
// ==============================================================================
// ==============================================================================
// 4.5. ENDPOINTS MODE SUPER ADMIN SÉPARÉ ET SÉCURISÉ (FORTERESSE)
// ==============================================================================
interface AdminSessionInfo {
  token: string;
  createdAt: number;
  expiresAt: number;
}
const adminSessions = new Map<string, AdminSessionInfo>();

function safeStringCompare(a: string, b: string): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a.trim());
  const bufB = Buffer.from(b.trim());
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Middleware d'authentification pour les routes administratives
function requireAdminAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  const token = (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : (req.headers['x-admin-token'] as string))?.trim();

  if (!token) {
    return res.status(401).json({ success: false, error: 'Accès refusé : token Super Admin manquant' });
  }

  const session = adminSessions.get(token);
  if (!session || Date.now() > session.expiresAt) {
    if (session) adminSessions.delete(token);
    return res.status(401).json({ success: false, error: 'Session Super Admin invalide ou expirée' });
  }

  return next();
}

// Connexion Super Admin avec limitation anti-bruteforce stricte
app.post('/api/admin/login', adminLoginLimiter, (req: Request, res: Response) => {
  const { email, password } = req.body || {};
  const expectedEmail = process.env.SUPER_ADMIN_EMAIL || '';
  const expectedPassword = process.env.SUPER_ADMIN_PASSWORD || '';

  if (!email || !password) {
    return res.status(400).json({ success: false, error: 'Email et mot de passe requis' });
  }

  if (!expectedEmail || !expectedPassword) {
    console.error('[SECURITY ALERT] Variables SUPER_ADMIN_EMAIL ou SUPER_ADMIN_PASSWORD non configurées !');
    return res.status(500).json({ success: false, error: 'Configuration serveur incomplète' });
  }

  const isEmailMatch = safeStringCompare(email.toLowerCase(), expectedEmail.toLowerCase());
  const isPassMatch = safeStringCompare(password, expectedPassword);

  if (isEmailMatch && isPassMatch) {
    // Génération d'un token aléatoire cryptographiquement fort (256 bits)
    const token = 'admin_sec_' + crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    adminSessions.set(token, {
      token,
      createdAt: now,
      expiresAt: now + 8 * 60 * 60 * 1000, // Valide 8 heures
    });

    return res.json({
      success: true,
      token,
      email: expectedEmail,
      whatsappNumber: process.env.WHATSAPP_NUMBER || '22896100972',
    });
  }

  return res.status(401).json({ success: false, error: 'Email ou mot de passe incorrect' });
});

app.post('/api/admin/verify', (req: Request, res: Response) => {
  const { token } = req.body || {};
  if (token && adminSessions.has(token)) {
    const session = adminSessions.get(token)!;
    if (Date.now() < session.expiresAt) {
      return res.json({ success: true, email: process.env.SUPER_ADMIN_EMAIL });
    }
    adminSessions.delete(token);
  }
  return res.status(401).json({ success: false, error: 'Session invalide ou expirée' });
});

app.post('/api/admin/logout', (req: Request, res: Response) => {
  const { token } = req.body || {};
  if (token) adminSessions.delete(token);
  return res.json({ success: true });
});

// ==============================================================================
// VALIDATION STRICTE DES DONNÉES CÔTÉ SERVEUR (ZOD)
// ==============================================================================
app.post('/api/validate/product', (req: Request, res: Response) => {
  const parsed = ProductSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      errors: parsed.error.issues.map((e: any) => `${e.path.join('.')}: ${e.message}`),
    });
  }
  return res.json({ success: true, data: parsed.data });
});

app.post('/api/validate/sale', (req: Request, res: Response) => {
  const parsed = SaleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      errors: parsed.error.issues.map((e: any) => `${e.path.join('.')}: ${e.message}`),
    });
  }
  return res.json({ success: true, data: parsed.data });
});

app.post('/api/validate/employee', (req: Request, res: Response) => {
  const parsed = EmployeeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      errors: parsed.error.issues.map((e: any) => `${e.path.join('.')}: ${e.message}`),
    });
  }
  return res.json({ success: true, data: parsed.data });
});

// ==============================================================================
// GESTION SÉCURISÉE DES BOUTIQUES (ADMIN UNIQUEMENT - IDOR BLOQUÉ)
// ==============================================================================
app.get('/api/admin/boutiques', requireAdminAuth, async (_req: Request, res: Response) => {
  try {
    const { data: efaBoutiques } = await supabase
      .from('efa_boutiques')
      .select('*')
      .order('created_at', { ascending: false });

    const { data: patronsData } = await supabase
      .from('patrons')
      .select('*')
      .order('created_at', { ascending: false });

    const combinedMap = new Map<string, any>();

    if (patronsData) {
      for (const p of patronsData) {
        const subEnd = p.subscription_end_date || p.abonnement_expire || p.trial_end_date;
        const now = new Date();
        const isExp = subEnd ? new Date(subEnd) < now : false;
        const status = p.is_active === false ? 'bloque' : isExp ? 'expire' : (p.subscription_status || 'actif');

        combinedMap.set(p.id, {
          id: p.id,
          nom_personne: p.nom || 'Patron',
          nom_boutique: p.nom_boutique || 'Ma Boutique',
          pin_code: p.pin_code || p.code_pin || '----',
          quartier: p.quartier || '',
          telephone: p.telephone || p.phone_full || '',
          status,
          is_active: p.is_active !== false,
          subscription_end: subEnd || null,
          plan: p.subscription_status || 'essai',
          last_payment_amount: p.last_payment_amount || 0,
          created_at: p.created_at || new Date().toISOString(),
          source: 'patrons',
        });
      }
    }

    if (efaBoutiques) {
      for (const b of efaBoutiques) {
        const existing = combinedMap.get(b.id);
        const subEnd = b.date_fin_essai;
        const now = new Date();
        const isExp = subEnd ? new Date(subEnd) < now : false;
        const status = b.is_active === false ? 'bloque' : isExp ? 'expire' : (b.plan || 'actif');

        combinedMap.set(b.id, {
          id: b.id,
          nom_personne: b.nom_patron || existing?.nom_personne || b.nom_affichage,
          nom_boutique: b.nom_affichage || b.nom_boutique,
          pin_code: b.pin_code || existing?.pin_code || '----',
          quartier: b.quartier || existing?.quartier || '',
          telephone: existing?.telephone || '',
          status,
          is_active: b.is_active !== false,
          subscription_end: subEnd || existing?.subscription_end || null,
          plan: b.plan || 'essai',
          last_payment_amount: b.last_payment_amount || existing?.last_payment_amount || 0,
          created_at: b.created_at || new Date().toISOString(),
          source: 'efa_boutiques',
        });
      }
    }

    const boutiques = Array.from(combinedMap.values());
    const total_boutiques = boutiques.length;
    const actives = boutiques.filter((b) => b.is_active && b.status !== 'expire' && b.status !== 'bloque').length;
    const expirees = boutiques.filter((b) => b.status === 'expire').length;
    const revenu_total = boutiques.reduce((sum, b) => sum + (Number(b.last_payment_amount) || 0), 0);

    return res.json({
      success: true,
      stats: {
        total_boutiques,
        actives,
        expirees,
        revenu_total,
      },
      boutiques,
    });
  } catch (err: any) {
    console.error('[SUPER ADMIN] Erreur list boutiques:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/admin/boutiques/activate', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const parsed = AdminActivateBoutiqueSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: 'Données invalides',
        details: parsed.error.issues.map((e: any) => e.message),
      });
    }

    const { boutique_id, duration_days, plan, amount } = parsed.data;
    const expiryDate = new Date(Date.now() + duration_days * 24 * 60 * 60 * 1000).toISOString();

    try {
      await supabase
        .from('efa_boutiques')
        .update({
          plan,
          date_fin_essai: expiryDate,
          is_active: true,
          last_payment_amount: amount,
        })
        .eq('id', boutique_id);
    } catch (e) {}

    try {
      await supabase
        .from('patrons')
        .update({
          subscription_status: plan,
          subscription_end_date: expiryDate,
          abonnement_expire: expiryDate,
          is_active: true,
          last_payment_amount: amount,
        })
        .eq('id', boutique_id);
    } catch (e) {}

    try {
      await supabase.from('historique_actions').insert({
        id: `admin_act_${Date.now()}`,
        patron_id: boutique_id,
        action_type: 'super_admin_activation',
        description: `Activation Super Admin : ${plan.toUpperCase()} (${duration_days} jours, ${amount.toLocaleString('fr-FR')} F)`,
        montant: amount,
        created_at: new Date().toISOString(),
      });
    } catch (e) {}

    return res.json({
      success: true,
      message: `Boutique activée pour ${duration_days} jours avec succès`,
      subscription_end: expiryDate,
      amount,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/admin/boutiques/toggle-status', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { boutique_id, is_active } = req.body || {};
    if (!boutique_id) return res.status(400).json({ error: 'boutique_id requis' });

    await supabase.from('efa_boutiques').update({ is_active: Boolean(is_active) }).eq('id', boutique_id);
    await supabase.from('patrons').update({ is_active: Boolean(is_active) }).eq('id', boutique_id);

    return res.json({ success: true, is_active: Boolean(is_active) });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/admin/boutiques/prolong', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { boutique_id, add_days, new_end_date } = req.body || {};
    if (!boutique_id) return res.status(400).json({ error: 'boutique_id requis' });

    let newEnd = new_end_date;
    if (!newEnd) {
      const daysToAdd = Math.max(1, Math.min(parseInt(add_days, 10) || 30, 3650));
      newEnd = new Date(Date.now() + daysToAdd * 86400000).toISOString();
    }

    try {
      await supabase.from('efa_boutiques').update({ date_fin_essai: newEnd, is_active: true }).eq('id', boutique_id);
    } catch {}

    try {
      await supabase.from('patrons').update({
        fin_abonnement: newEnd,
        statut: 'ACTIF',
        forfait: 'PROLONGE',
        subscription_end_date: newEnd,
        abonnement_expire: newEnd,
        is_active: true,
      }).eq('id', boutique_id);
    } catch {}

    return res.json({ success: true, subscription_end: newEnd });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/admin/boutiques/:id', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    if (!id || typeof id !== 'string') return res.status(400).json({ error: 'ID invalide' });

    await supabase.from('efa_boutiques').delete().eq('id', id);
    await supabase.from('patrons').delete().eq('id', id);
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ==============================================================================
// 5. INTÉGRATION VITE & DÉMARRAGE DU SERVEUR
// ==============================================================================
async function startServer() {
  const isDev = process.env.NODE_ENV !== 'production';

  if (isDev) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 EFA ACONTA Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch(console.error);
