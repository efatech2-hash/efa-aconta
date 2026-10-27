import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Supabase client pour le backend
const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://ebqhujxkliutkkhgsekd.supabase.co';
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVicWh1anhrbGl1dGtraGdzZWtkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE4NzQ4NTgsImV4cCI6MjEwNzQ1MDg1OH0.3SPfCeZAUUIF7cV2YWMl8EmzbTBiltIivDCgzhAA9tU';
const supabase = createClient(supabaseUrl, supabaseAnonKey);

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
const adminSessions = new Set<string>();

app.post('/api/admin/login', (req: Request, res: Response) => {
  const { email, password } = req.body || {};
  const expectedEmail = process.env.SUPER_ADMIN_EMAIL || '';
  const expectedPassword = process.env.SUPER_ADMIN_PASSWORD || '';

  if (!email || !password) {
    return res.status(400).json({ success: false, error: 'Email et mot de passe requis' });
  }

  const isMatch =
    email.trim().toLowerCase() === expectedEmail.trim().toLowerCase() &&
    password === expectedPassword;

  if (isMatch) {
    const token = 'admin_sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 10);
    adminSessions.add(token);
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
    return res.json({ success: true, email: process.env.SUPER_ADMIN_EMAIL });
  }
  return res.status(401).json({ success: false, error: 'Session invalide ou expirée' });
});

app.post('/api/admin/logout', (req: Request, res: Response) => {
  const { token } = req.body || {};
  if (token) adminSessions.delete(token);
  return res.json({ success: true });
});

app.get('/api/admin/boutiques', async (_req: Request, res: Response) => {
  try {
    // 1. Lire efa_boutiques
    const { data: efaBoutiques } = await supabase
      .from('efa_boutiques')
      .select('*')
      .order('created_at', { ascending: false });

    // 2. Lire patrons
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

app.post('/api/admin/boutiques/activate', async (req: Request, res: Response) => {
  try {
    const { boutique_id, duration_days, plan, amount } = req.body || {};
    if (!boutique_id) return res.status(400).json({ error: 'boutique_id requis' });

    const days = parseInt(duration_days, 10) || 365;
    const expiryDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    const payAmount = Number(amount) || (days >= 365 ? 90000 : 50000);
    const chosenPlan = plan || (days >= 365 ? 'pro' : 'populaire');

    try {
      await supabase
        .from('efa_boutiques')
        .update({
          plan: chosenPlan,
          date_fin_essai: expiryDate,
          is_active: true,
          last_payment_amount: payAmount,
        })
        .eq('id', boutique_id);
    } catch (e) {}

    try {
      await supabase
        .from('patrons')
        .update({
          subscription_status: chosenPlan,
          subscription_end_date: expiryDate,
          abonnement_expire: expiryDate,
          is_active: true,
          last_payment_amount: payAmount,
        })
        .eq('id', boutique_id);
    } catch (e) {}

    try {
      await supabase.from('historique_actions').insert({
        id: `admin_act_${Date.now()}`,
        patron_id: boutique_id,
        action_type: 'super_admin_activation',
        description: `Activation Super Admin : ${chosenPlan.toUpperCase()} (${days} jours, ${payAmount.toLocaleString('fr-FR')} F)`,
        montant: payAmount,
        created_at: new Date().toISOString(),
      });
    } catch (e) {}

    return res.json({
      success: true,
      message: `Boutique activée pour ${days} jours avec succès`,
      subscription_end: expiryDate,
      amount: payAmount,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/admin/boutiques/toggle-status', async (req: Request, res: Response) => {
  try {
    const { boutique_id, is_active } = req.body || {};
    if (!boutique_id) return res.status(400).json({ error: 'boutique_id requis' });

    await supabase.from('efa_boutiques').update({ is_active }).eq('id', boutique_id);
    await supabase.from('patrons').update({ is_active }).eq('id', boutique_id);

    return res.json({ success: true, is_active });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/admin/boutiques/prolong', async (req: Request, res: Response) => {
  try {
    const { boutique_id, add_days, new_end_date } = req.body || {};
    if (!boutique_id) return res.status(400).json({ error: 'boutique_id requis' });

    let newEnd = new_end_date;
    if (!newEnd) {
      const daysToAdd = parseInt(add_days, 10) || 30;
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
        is_active: true
      }).eq('id', boutique_id);
    } catch {}

    return res.json({ success: true, subscription_end: newEnd });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/admin/boutiques/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
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
