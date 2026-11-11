import type { Patron, SubscriptionStatus } from './types';
import { db } from './db';
import { queueSyncItem } from './sync';
import { supabase } from './supabase';

export interface PlanLimits {
  name: string;
  maxArticles: number;
  maxEmployes: number;
  maxAppareils: number;
  maxBoutiques: number;
  hasVocal: boolean;
  hasOfficialInvoice: boolean;
  hasPrioritySupport: boolean;
  hasAdvancedExport: boolean;
}

export interface OfficialPlanLimites {
  plan: 'essai' | 'populaire' | 'pro';
  name: string;
  maxArticles: number; // 7, 100, 300
  maxVendeurs: number; // 1, 3, 10
  maxAppareils: number; // 1, 3, 5
  maxBoutiques: number; // 1, 1, 3
}

/**
 * PLANS OFFICIELS EFA ACONTA - fonction unique getLimites(plan)
 * - ESSAI 0F/21j : 7 articles TOTAL, 1 vendeur, 1 appareil, 1 boutique
 * - POPULAIRE 16500F/1an : 100 TOTAL, 3 vendeurs, 3 appareils, 1 boutique
 * - PRO 50000F/6mois OU 90000F/1an = MÊME PRO : 300 TOTAL, 10 vendeurs, 5 appareils, 3 boutiques
 */
export function getLimites(plan?: string | null): OfficialPlanLimites {
  const p = (plan || '').toLowerCase().trim();
  if (p === 'pro' || p.includes('pro') || p.includes('50000') || p.includes('90000') || p.includes('6mois') || p.includes('1an')) {
    return {
      plan: 'pro',
      name: 'Boutique Pro (50 000 F/6 mois OU 90 000 F/1 an)',
      maxArticles: 300,
      maxVendeurs: 10,
      maxAppareils: 5,
      maxBoutiques: 3,
    };
  }
  if (p === 'populaire' || p.includes('populaire') || p.includes('16500')) {
    return {
      plan: 'populaire',
      name: 'Offre Populaire (16 500 F/1 an)',
      maxArticles: 100,
      maxVendeurs: 3,
      maxAppareils: 3,
      maxBoutiques: 1,
    };
  }
  // ESSAI 0F/21j par défaut
  return {
    plan: 'essai',
    name: 'Essai Gratuit 21 Jours (0 F)',
    maxArticles: 7,
    maxVendeurs: 1,
    maxAppareils: 1,
    maxBoutiques: 1,
  };
}

export const PLAN_CONFIGS: Record<SubscriptionStatus, PlanLimits> = {
  trial: {
    name: 'Essai Gratuit 21 Jours',
    maxArticles: 7,
    maxEmployes: 1,
    maxAppareils: 1,
    maxBoutiques: 1,
    hasVocal: false,
    hasOfficialInvoice: false,
    hasPrioritySupport: false,
    hasAdvancedExport: false,
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
  },
  populaire: {
    name: 'Offre Populaire (1 500 F/mois - 16 500 F/an)',
    maxArticles: 100,
    maxEmployes: 3,
    maxAppareils: 3,
    maxBoutiques: 1,
    hasVocal: false, // BLOQUÉ en Populaire (Réservé Boutique Pro)
    hasOfficialInvoice: false, // BLOQUÉ en Populaire (Réservé Boutique Pro)
    hasPrioritySupport: false,
    hasAdvancedExport: false,
  },
  pro: {
    name: 'Boutique Pro (50 000 F/6 mois - 90 000 F/an)',
    maxArticles: 300,
    maxEmployes: 10,
    maxAppareils: 5,
    maxBoutiques: 3,
    hasVocal: true, // DÉBLOQUÉ en Boutique Pro
    hasOfficialInvoice: true, // DÉBLOQUÉ en Boutique Pro
    hasPrioritySupport: true,
    hasAdvancedExport: true,
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
  },
};

/**
 * Vérifie si le patron a l'offre Boutique Pro active
 */
export function isBoutiquePro(patron?: Patron | null): boolean {
  if (!patron) return false;
  const status = (patron.subscription_status || '').toLowerCase();
  const plan = (patron.current_plan || '').toLowerCase();
  const forfait = (patron.forfait || '').toLowerCase();
  const statut = (patron.statut || '').toLowerCase();
  return (
    status === 'pro' ||
    plan === 'pro' ||
    forfait.includes('pro') ||
    statut.includes('pro') ||
    patron.isProActive === true ||
    patron.isSubOfPro === true
  );
}

/**
 * RÈGLE D'OR : Si une boutique du patron est PRO, TOUTES ses boutiques sont PRO
 */
export async function isPatronOrAnyBoutiquePro(patron?: Patron | null): Promise<boolean> {
  if (!patron) return false;
  if (isBoutiquePro(patron) || patron.isProActive === true || patron.isSubOfPro === true) return true;

  try {
    const ownerId = patron.parentId || patron.ownerId || (patron as any).patron_id || patron.id;
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      const orFilter = `id.eq.${ownerId},patron_id.eq.${ownerId}${patron.telephone ? `,telephone.eq.${patron.telephone}` : ''}`;
      const { data: btqs } = await supabase
        .from('boutiques')
        .select('id, plan, status, statut, last_payment_amount')
        .or(orFilter);

      if (btqs && btqs.length > 0) {
        const found = btqs.some((b) => {
          const p = (b.plan || '').toLowerCase().trim();
          const s = (b.status || (b as any).statut || '').toLowerCase().trim();
          const isAct = s === 'active' || s === 'actif' || s === '';
          const isNotTr = p !== 'trial' && p !== 'essai' && p !== 'free' && p !== '';
          const amt = Number(b.last_payment_amount) || 0;
          return (isNotTr && isAct) || p === 'pro' || p.includes('pro') || amt >= 50000;
        });
        if (found) {
          patron.isProActive = true;
          patron.subscription_status = 'pro';
          return true;
        }
      }
    }
  } catch (err) {
    console.warn('[isPatronOrAnyBoutiquePro] Erreur:', err);
  }
  return false;
}

/**
 * Détermine le forfait effectif du patron ('essai' | 'populaire' | 'pro')
 */
export async function getEffectivePlan(patron?: Patron | null): Promise<'essai' | 'populaire' | 'pro'> {
  if (!patron) return 'essai';
  const isPro = await isPatronOrAnyBoutiquePro(patron);
  if (isPro) return 'pro';
  const status = (patron.subscription_status || patron.current_plan || '').toLowerCase();
  if (status === 'populaire' || status.includes('populaire')) return 'populaire';
  return 'essai';
}

/**
 * BUG 1 : Calcule le total d'articles créés par patron_id (toutes ses boutiques réunies)
 */
export async function getTotalProductsCountByPatron(patron: Patron): Promise<number> {
  try {
    const ownerId = patron.parentId || patron.ownerId || (patron as any).patron_id || patron.id;
    let storeIds = [ownerId, patron.id];

    if (typeof navigator !== 'undefined' && navigator.onLine) {
      try {
        const { data: siblingStores } = await supabase
          .from('boutiques')
          .select('id')
          .or(`id.eq.${ownerId},patron_id.eq.${ownerId}${patron.telephone ? `,telephone.eq.${patron.telephone}` : ''}`);
        if (siblingStores && siblingStores.length > 0) {
          storeIds = Array.from(new Set([...storeIds, ...siblingStores.map((s) => s.id)]));
        }
      } catch {}

      const orFilter = `patron_id.eq.${ownerId},${storeIds.map((sid) => `boutique_id.eq.${sid}`).join(',')}`;
      const { count, error } = await supabase
        .from('produits')
        .select('id', { count: 'exact', head: true })
        .or(orFilter);

      if (!error && typeof count === 'number') {
        const localAll = await db.produits.toArray();
        const localCount = localAll.filter(
          (p) => storeIds.includes(p.boutique_id || '') || storeIds.includes(p.patron_id)
        ).length;
        return Math.max(count, localCount);
      }
    }

    const localAll = await db.produits.toArray();
    return localAll.filter(
      (p) => storeIds.includes(p.boutique_id || '') || storeIds.includes(p.patron_id)
    ).length;
  } catch (err) {
    console.warn('[getTotalProductsCountByPatron] Erreur:', err);
    return 0;
  }
}

/**
 * BUG 1 : Calcule le total de vendeurs / employés par patron_id (toutes ses boutiques réunies)
 */
export async function getTotalEmployesCountByPatron(patron: Patron): Promise<number> {
  try {
    const ownerId = patron.parentId || patron.ownerId || (patron as any).patron_id || patron.id;
    let storeIds = [ownerId, patron.id];

    if (typeof navigator !== 'undefined' && navigator.onLine) {
      try {
        const { data: siblingStores } = await supabase
          .from('boutiques')
          .select('id')
          .or(`id.eq.${ownerId},patron_id.eq.${ownerId}${patron.telephone ? `,telephone.eq.${patron.telephone}` : ''}`);
        if (siblingStores && siblingStores.length > 0) {
          storeIds = Array.from(new Set([...storeIds, ...siblingStores.map((s) => s.id)]));
        }
      } catch {}

      const orFilter = `patron_id.eq.${ownerId},${storeIds.map((sid) => `boutique_id.eq.${sid}`).join(',')}`;
      const { count, error } = await supabase
        .from('employes')
        .select('id', { count: 'exact', head: true })
        .or(orFilter);

      if (!error && typeof count === 'number') {
        const localAll = await db.employes.toArray();
        const localCount = localAll.filter(
          (e) => e.status !== 'deleted' && (storeIds.includes(e.boutique_id || '') || storeIds.includes(e.patron_id))
        ).length;
        return Math.max(count, localCount);
      }
    }

    const localAll = await db.employes.toArray();
    return localAll.filter(
      (e) => e.status !== 'deleted' && (storeIds.includes(e.boutique_id || '') || storeIds.includes(e.patron_id))
    ).length;
  } catch (err) {
    console.warn('[getTotalEmployesCountByPatron] Erreur:', err);
    return 0;
  }
}

/**
 * VÉRIFICATION ASYNCHRONE DU QUOTA PRODUIT TOTAL PAR PATRON_ID
 * Ex: Essai si totalProduits >= 7 bloque l'ajout du 8e article !
 */
export async function checkCanAddProduct(patron: Patron): Promise<{
  allowed: boolean;
  currentCount: number;
  maxLimit: number;
  plan: 'essai' | 'populaire' | 'pro';
  message?: string;
}> {
  const plan = await getEffectivePlan(patron);
  const limites = getLimites(plan);
  const currentCount = await getTotalProductsCountByPatron(patron);
  const allowed = currentCount < limites.maxArticles;

  let message: string | undefined;
  if (!allowed) {
    if (plan === 'essai') {
      message = `Limite Essai atteinte : ${limites.maxArticles} articles TOTAL autorisés (actuellement ${currentCount}/${limites.maxArticles}). Passez à Populaire (100) ou Pro (300) pour en ajouter d'autres.`;
    } else if (plan === 'populaire') {
      message = `Limite Populaire atteinte : ${limites.maxArticles} articles TOTAL autorisés (actuellement ${currentCount}/${limites.maxArticles}). Passez à Pro (300) pour en ajouter d'autres.`;
    } else {
      message = `Limite Pro atteinte : ${limites.maxArticles} articles TOTAL pour toutes vos boutiques réunies.`;
    }
  }

  return {
    allowed,
    currentCount,
    maxLimit: limites.maxArticles,
    plan,
    message,
  };
}

/**
 * VÉRIFICATION ASYNCHRONE DU QUOTA EMPLOYÉS / VENDEURS TOTAL PAR PATRON_ID
 * Ex: Essai si totalEmployes >= 1 bloque l'ajout du 2e vendeur !
 */
export async function checkCanAddEmploye(patron: Patron): Promise<{
  allowed: boolean;
  currentCount: number;
  maxLimit: number;
  plan: 'essai' | 'populaire' | 'pro';
  message?: string;
}> {
  const plan = await getEffectivePlan(patron);
  const limites = getLimites(plan);
  const currentCount = await getTotalEmployesCountByPatron(patron);
  const allowed = currentCount < limites.maxVendeurs;

  let message: string | undefined;
  if (!allowed) {
    if (plan === 'essai') {
      message = `Limite Essai atteinte : ${limites.maxVendeurs} vendeur TOTAL autorisé (actuellement ${currentCount}/${limites.maxVendeurs}). Passez à Populaire (3) ou Pro (10) pour en ajouter d'autres.`;
    } else if (plan === 'populaire') {
      message = `Limite Populaire atteinte : ${limites.maxVendeurs} vendeurs TOTAL autorisés (actuellement ${currentCount}/${limites.maxVendeurs}). Passez à Pro (10) pour en ajouter d'autres.`;
    } else {
      message = `Limite Pro atteinte : ${limites.maxVendeurs} vendeurs TOTAL pour toutes vos boutiques réunies.`;
    }
  }

  return {
    allowed,
    currentCount,
    maxLimit: limites.maxVendeurs,
    plan,
    message,
  };
}

/**
 * Hook utilitaire pour obtenir l'abonnement actif
 */
export function useAbonnement(patron?: Patron | null) {
  const isPro = isBoutiquePro(patron);
  const plan = isPro ? 'pro' : (patron?.subscription_status || 'free');
  return {
    plan,
    isPro,
    canUseVoice: isPro,
  };
}

/**
 * Calcule si le patron est actuellement en période d'essai expirée
 */
export function isSubscriptionExpired(patron?: Patron | null): boolean {
  if (!patron) return false;
  // Si le patron est PRO actif, il n'est JAMAIS expiré d'essai
  if (isBoutiquePro(patron) || patron.isProActive === true) {
    if (patron.subscription_end_date) {
      const now = new Date();
      const end = new Date(patron.subscription_end_date);
      return now > end;
    }
    return false;
  }
  if (patron.subscription_status === 'expired') return true;

  // Si statut 'trial', vérifier la date de fin
  if (patron.subscription_status === 'trial' || !patron.subscription_status) {
    if (patron.trial_end_date) {
      const now = new Date();
      const end = new Date(patron.trial_end_date);
      if (now > end) {
        return true;
      }
    }
  }

  // Si abonnement payant expiré
  if (patron.subscription_end_date) {
    const now = new Date();
    const end = new Date(patron.subscription_end_date);
    if (now > end && patron.subscription_status !== 'trial') {
      return true;
    }
  }

  return false;
}

/**
 * Nombre de jours restants dans l'essai gratuit
 */
export function getRemainingTrialDays(patron?: Patron | null): number {
  if (!patron || !patron.trial_end_date) return 0;
  const now = new Date();
  const end = new Date(patron.trial_end_date);
  const diffMs = end.getTime() - now.getTime();
  if (diffMs <= 0) return 0;
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Vérifie si le patron peut ajouter un nouvel article (calcul synchrone direct via getLimites)
 */
export function canAddArticle(patron: Patron | null | undefined, currentCount: number): boolean {
  if (!patron) return false;
  if (isSubscriptionExpired(patron)) return false;
  const plan = isBoutiquePro(patron) ? 'pro' : (patron.subscription_status || 'essai');
  const limites = getLimites(plan);
  return currentCount < limites.maxArticles;
}

/**
 * Informations détaillées sur la limite d'articles
 */
export function getArticleLimitInfo(patron: Patron | null | undefined, currentCount: number) {
  const plan = isBoutiquePro(patron) ? 'pro' : (patron?.subscription_status || 'essai');
  const limites = getLimites(plan);
  const max = limites.maxArticles;
  const isTrial = limites.plan === 'essai';
  const allowed = !isSubscriptionExpired(patron) && currentCount < max;
  const remaining = Math.max(0, max - currentCount);
  return {
    allowed,
    max,
    current: currentCount,
    remaining,
    isTrial,
    status: limites.plan,
    message: allowed
      ? `${remaining} articles restants (quota : ${currentCount}/${max})`
      : (isTrial
        ? `Limite atteinte - Essai gratuit = 7 articles max. Passez à Populaire pour 100 articles`
        : `Limite de ${max} articles atteinte pour votre forfait actuel.`),
  };
}

/**
 * Vérifie si le patron peut ajouter un nouvel employé / vendeur (synchrone via getLimites)
 */
export function canAddEmploye(patron: Patron | null | undefined, currentCount: number): boolean {
  if (!patron) return false;
  if (isSubscriptionExpired(patron)) return false;
  const plan = isBoutiquePro(patron) ? 'pro' : (patron.subscription_status || 'essai');
  const limites = getLimites(plan);
  return currentCount < limites.maxVendeurs;
}

/**
 * Alias officiel pour vendeur (exigé par la consigne)
 */
export const canAddVendeur = canAddEmploye;

/**
 * Informations détaillées sur la limite de vendeurs
 */
export function getVendeurLimitInfo(patron: Patron | null | undefined, currentCount: number) {
  const plan = isBoutiquePro(patron) ? 'pro' : (patron?.subscription_status || 'essai');
  const limites = getLimites(plan);
  const max = limites.maxVendeurs;
  const isTrial = limites.plan === 'essai';
  const allowed = !isSubscriptionExpired(patron) && currentCount < max;
  const remaining = Math.max(0, max - currentCount);
  return {
    allowed,
    max,
    current: currentCount,
    remaining,
    isTrial,
    status: limites.plan,
    message: allowed
      ? `${remaining} vendeurs restants (quota : ${currentCount}/${max})`
      : (isTrial
        ? `1 vendeur max en essai gratuit. Passez à Populaire (3 vendeurs) ou Boutique Pro (10 vendeurs).`
        : `Limite de ${max} vendeurs atteinte pour votre forfait actuel.`),
  };
}

/**
 * Vérifie si le patron peut connecter un nouvel appareil
 */
export function canAddAppareil(patron: Patron | null | undefined, currentCount: number): boolean {
  if (!patron) return false;
  if (isSubscriptionExpired(patron)) return false;

  const isPro = isBoutiquePro(patron) || patron.isProActive === true;
  const status: SubscriptionStatus = isPro ? 'pro' : (patron.subscription_status || 'trial');
  const limits: Record<SubscriptionStatus, number> = {
    free: 1,
    populaire: 3,
    pro: 5,
    trial: 1, // Strict: 1 appareil max en essai gratuit
    expired: 0,
  };

  const max = limits[status] ?? (isPro ? 5 : 1);
  return currentCount < max;
}

/**
 * Vérifie si le patron peut créer/gérer une nouvelle boutique distincte
 */
export function canAddBoutique(patron: Patron | null | undefined, currentCount: number): boolean {
  if (!patron) return false;
  if (isSubscriptionExpired(patron)) return false;

  const isPro = isBoutiquePro(patron) || patron.isProActive === true;
  const status: SubscriptionStatus = isPro ? 'pro' : (patron.subscription_status || 'trial');
  const limits: Record<SubscriptionStatus, number> = {
    free: 1,
    populaire: 1,
    pro: 3,
    trial: 1,
    expired: 0,
  };

  const max = limits[status] ?? (isPro ? 3 : 1);
  return currentCount < max;
}

export type ProFeature =
  | 'multi_boutique'
  | 'official_invoice'
  | 'priority_support'
  | 'advanced_export'
  | 'vocal';

/**
 * Vérifie si le patron a accès à une fonctionnalité Pro donnée
 */
export function hasAccess(patron: Patron | null | undefined, feature: ProFeature): boolean {
  if (!patron) return false;
  if (isSubscriptionExpired(patron)) return false;

  const status: SubscriptionStatus = patron.subscription_status || 'trial';
  const config = PLAN_CONFIGS[status] || PLAN_CONFIGS.trial;

  switch (feature) {
    case 'multi_boutique':
      return config.maxBoutiques > 1;
    case 'official_invoice':
      return config.hasOfficialInvoice;
    case 'priority_support':
      return config.hasPrioritySupport;
    case 'advanced_export':
      return config.hasAdvancedExport;
    case 'vocal':
      return config.hasVocal;
    default:
      return false;
  }
}

/**
 * Enregistre ou actualise l'appareil actuel dans la base locale et distante
 */
export async function registerCurrentDevice(patronId: string): Promise<{ success: boolean; currentCount: number; maxAllowed: number }> {
  try {
    let deviceId = localStorage.getItem('efa_device_id');
    if (!deviceId) {
      deviceId = 'dev_' + Math.random().toString(36).substring(2, 10);
      localStorage.setItem('efa_device_id', deviceId);
    }

    const patron = await db.patrons.get(patronId);
    const plan = patron?.subscription_status || 'trial';
    const config = PLAN_CONFIGS[plan] || PLAN_CONFIGS.trial;
    const maxAllowed = config.maxAppareils;

    const existingDevices = await db.appareils.where('patron_id').equals(patronId).toArray();
    const existing = existingDevices.find((d) => d.device_id === deviceId);

    const now = new Date().toISOString();
    const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : 'Appareil Web';
    const deviceName = userAgent.includes('Android')
      ? 'Téléphone Android'
      : userAgent.includes('iPhone')
      ? 'Apple iPhone'
      : 'Ordinateur / Caisse';

    if (existing) {
      await db.appareils.update(existing.id, { last_active: now });
      return { success: true, currentCount: existingDevices.length, maxAllowed };
    }

    if (existingDevices.length >= maxAllowed) {
      return { success: false, currentCount: existingDevices.length, maxAllowed };
    }

    const newDevice = {
      id: `device_${patronId}_${deviceId}`,
      patron_id: patronId,
      device_id: deviceId,
      device_name: deviceName,
      last_active: now,
      created_at: now,
    };
    await db.appareils.put(newDevice);
    return { success: true, currentCount: existingDevices.length + 1, maxAllowed };
  } catch (err) {
    console.warn('Erreur registerCurrentDevice:', err);
    return { success: true, currentCount: 1, maxAllowed: 3 };
  }
}

/**
 * Récupère l'usage complet actuel du patron (articles, vendeurs, appareils, boutiques)
 */
export async function getSubscriptionUsage(patron: Patron | null | undefined) {
  if (!patron) return null;

  const plan: SubscriptionStatus = patron.subscription_status || 'trial';
  const config = PLAN_CONFIGS[plan] || PLAN_CONFIGS.trial;

  const [articlesCount, employesCount, appareilsCount, boutiquesCount] = await Promise.all([
    db.produits.where('patron_id').equals(patron.id).count(),
    db.employes.where('patron_id').equals(patron.id).and((e) => e.status !== 'deleted').count(),
    db.appareils.where('patron_id').equals(patron.id).count(),
    db.boutiques.where('patron_id').equals(patron.id).count(),
  ]);

  const activeBoutiques = Math.max(1, boutiquesCount);
  const activeAppareils = Math.max(1, appareilsCount);

  return {
    plan,
    planName: config.name,
    expiresAt: patron.subscription_end_date || patron.trial_end_date,
    isExpired: isSubscriptionExpired(patron),
    articles: {
      used: articlesCount,
      max: config.maxArticles,
      percent: Math.min(100, Math.round((articlesCount / Math.max(1, config.maxArticles)) * 100)),
      isLimitReached: articlesCount >= config.maxArticles,
    },
    employes: {
      used: employesCount,
      max: config.maxEmployes,
      percent: Math.min(100, Math.round((employesCount / Math.max(1, config.maxEmployes)) * 100)),
      isLimitReached: employesCount >= config.maxEmployes,
    },
    appareils: {
      used: activeAppareils,
      max: config.maxAppareils,
      percent: Math.min(100, Math.round((activeAppareils / Math.max(1, config.maxAppareils)) * 100)),
      isLimitReached: activeAppareils >= config.maxAppareils,
    },
    boutiques: {
      used: activeBoutiques,
      max: config.maxBoutiques,
      percent: Math.min(100, Math.round((activeBoutiques / Math.max(1, config.maxBoutiques)) * 100)),
      isLimitReached: activeBoutiques >= config.maxBoutiques,
    },
    features: {
      voix_efa: plan !== 'free' && plan !== 'expired',
      micro_vocal: config.hasVocal,
      benefice_caisse: true,
      recu_whatsapp: true,
      facture_officielle_pdf: config.hasOfficialInvoice,
      export_comptable_avance: config.hasAdvancedExport,
      support_whatsapp_prioritaire: config.hasPrioritySupport,
      historique_illimite: plan === 'pro',
      sauvegarde_cloud_auto: plan !== 'free',
    },
  };
}

/**
 * Active instantanément un forfait (Populaire ou Pro) en DB locale + distante + synchronise les employés
 */
export async function activateSubscription(
  patron: Patron,
  newPlan: 'populaire' | 'pro',
  billingCycle: 'mensuel' | 'annuel' = 'mensuel'
): Promise<{ success: boolean; expiresAt: string; message: string }> {
  const daysToAdd = billingCycle === 'annuel' ? 365 : 30;
  const now = new Date();
  const expiresDate = new Date(now.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
  const expiresAt = expiresDate.toISOString();

  const config = PLAN_CONFIGS[newPlan];

  // 1. Mettre à jour l'objet patron en local Dexie
  const isPro = newPlan === 'pro';
  const updatedPatron: Patron = {
    ...patron,
    subscription_status: newPlan,
    current_plan: newPlan,
    subscription_end_date: expiresAt,
    abonnement_expire: expiresAt,
    isProActive: isPro,
    proExpiresAt: isPro ? expiresAt : patron.proExpiresAt,
    maxBoutiques: isPro ? 3 : 1,
    type: patron.type || 'MAIN',
  };

  await db.patrons.update(patron.id, {
    subscription_status: newPlan,
    current_plan: newPlan,
    subscription_end_date: expiresAt,
    abonnement_expire: expiresAt,
    isProActive: isPro,
    proExpiresAt: isPro ? expiresAt : patron.proExpiresAt,
    maxBoutiques: isPro ? 3 : 1,
    type: patron.type || 'MAIN',
  });

  // 2. Mettre à jour la table subscriptions en local
  const subRecord = {
    id: `sub_${patron.id}`,
    patron_id: patron.id,
    plan: newPlan,
    status: 'active' as const,
    limit_articles: config.maxArticles,
    limit_vendeurs: config.maxEmployes,
    limit_appareils: config.maxAppareils,
    limit_boutiques: config.maxBoutiques,
    features: {
      voix_efa: true,
      micro_vocal: config.hasVocal,
      benefice_caisse: true,
      recu_whatsapp: true,
      facture_officielle_pdf: config.hasOfficialInvoice,
      export_comptable_avance: config.hasAdvancedExport,
      support_whatsapp_prioritaire: config.hasPrioritySupport,
      historique_illimite: newPlan === 'pro',
      sauvegarde_cloud_auto: true,
    },
    expires_at: expiresAt,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  };

  await db.subscriptions.put(subRecord);

  // 3. Queue sync
  await queueSyncItem('patrons', 'update', patron.id, {
    subscription_status: newPlan,
    current_plan: newPlan,
    subscription_end_date: expiresAt,
  });

  // 4. Synchroniser tous les employés
  await syncEmployeesSubscription(patron.id, newPlan);

  // 5. Tentative de sync directe avec Supabase table boutiques
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      const isAnnual = billingCycle === 'annuel';
      const paymentAmount = newPlan === 'pro' ? (isAnnual ? 90000 : 50000) : 16500;
      await supabase
        .from('boutiques')
        .update({
          plan: newPlan,
          status: 'active',
          is_active: true,
          has_paid_annuel: isAnnual,
          subscription_end_date: expiresAt,
          subscription_end: expiresAt,
          last_payment_amount: paymentAmount,
          updated_at: now.toISOString(),
        })
        .eq('id', patron.id);

      // Si Pro, les sous-boutiques héritent du même plan et expiration
      if (newPlan === 'pro') {
        await supabase
          .from('boutiques')
          .update({
            plan: 'pro',
            status: 'active',
            is_active: true,
            has_paid_annuel: isAnnual,
            subscription_end_date: expiresAt,
            subscription_end: expiresAt,
            updated_at: now.toISOString(),
          })
          .eq('patron_id', patron.id);
      }

      await supabase
        .from('patrons')
        .update({
          subscription_status: newPlan,
          current_plan: newPlan,
          subscription_end_date: expiresAt,
        })
        .eq('id', patron.id);
    }
  } catch (err) {
    console.warn('Sync distant abonnement différé:', err);
  }

  return {
    success: true,
    expiresAt,
    message: `Forfait ${config.name} activé avec succès jusqu'au ${expiresDate.toLocaleDateString('fr-FR')} !`,
  };
}

/**
 * Synchronise le statut de forfait du patron avec tous ses employés
 */
export async function syncEmployeesSubscription(
  patronId: string,
  plan: SubscriptionStatus
): Promise<void> {
  try {
    const employes = await db.employes.toArray();
    for (const emp of employes) {
      if (emp.subscription_status !== plan) {
        await db.employes.update(emp.id, { subscription_status: plan });
        await queueSyncItem('employes', 'update', emp.id, { subscription_status: plan });
      }
    }
  } catch (err) {
    console.warn('Erreur lors de la synchronisation du forfait des employés:', err);
  }
}


