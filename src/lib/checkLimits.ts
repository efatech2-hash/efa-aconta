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
  return patron.subscription_status === 'pro';
}

/**
 * Hook utilitaire pour obtenir l'abonnement actif
 */
export function useAbonnement(patron?: Patron | null) {
  const plan = patron?.subscription_status || 'free';
  const isPro = plan === 'pro';
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
 * Vérifie si le patron peut ajouter un nouvel article
 */
export function canAddArticle(patron: Patron | null | undefined, currentCount: number): boolean {
  if (!patron) return false;
  if (isSubscriptionExpired(patron)) return false;

  const status: SubscriptionStatus = patron.subscription_status || 'trial';
  const limits: Record<SubscriptionStatus, number> = {
    free: 7,
    populaire: 100,
    pro: 300,
    trial: 7, // 7 articles max en essai gratuit
    expired: 0,
  };

  const max = limits[status] ?? 7;
  return currentCount < max;
}

/**
 * Informations détaillées sur la limite d'articles
 */
export function getArticleLimitInfo(patron: Patron | null | undefined, currentCount: number) {
  const status: SubscriptionStatus = patron?.subscription_status || 'trial';
  const limits: Record<SubscriptionStatus, number> = {
    free: 7,
    populaire: 100,
    pro: 300,
    trial: 7,
    expired: 0,
  };
  const max = limits[status] ?? 7;
  const isTrial = status === 'trial' || status === 'free';
  const allowed = !isSubscriptionExpired(patron) && currentCount < max;
  return {
    allowed,
    max,
    current: currentCount,
    isTrial,
    status,
    message: isTrial
      ? `Limite atteinte - Essai gratuit = 7 articles max. Passez à Populaire pour illimité`
      : `Limite de ${max} articles atteinte pour votre forfait actuel.`,
  };
}

/**
 * Vérifie si le patron peut ajouter un nouvel employé / vendeur
 */
export function canAddEmploye(patron: Patron | null | undefined, currentCount: number): boolean {
  if (!patron) return false;
  if (isSubscriptionExpired(patron)) return false;

  const status: SubscriptionStatus = patron.subscription_status || 'trial';
  const limits: Record<SubscriptionStatus, number> = {
    free: 1,
    populaire: 3,
    pro: 10,
    trial: 1, // 1 vendeur max en essai gratuit
    expired: 0,
  };

  const max = limits[status] ?? 1;
  return currentCount < max;
}

/**
 * Alias officiel pour vendeur (exigé par la consigne)
 */
export const canAddVendeur = canAddEmploye;

/**
 * Informations détaillées sur la limite de vendeurs
 */
export function getVendeurLimitInfo(patron: Patron | null | undefined, currentCount: number) {
  const status: SubscriptionStatus = patron?.subscription_status || 'trial';
  const limits: Record<SubscriptionStatus, number> = {
    free: 1,
    populaire: 3,
    pro: 10,
    trial: 1,
    expired: 0,
  };
  const max = limits[status] ?? 1;
  const isTrial = status === 'trial' || status === 'free';
  const allowed = !isSubscriptionExpired(patron) && currentCount < max;
  return {
    allowed,
    max,
    current: currentCount,
    isTrial,
    status,
    message: isTrial
      ? `1 vendeur max en essai gratuit. Passez à Populaire ou Boutique Pro pour ajouter plus de vendeurs.`
      : `Limite de ${max} vendeurs atteinte pour votre forfait actuel.`,
  };
}

/**
 * Vérifie si le patron peut connecter un nouvel appareil
 */
export function canAddAppareil(patron: Patron | null | undefined, currentCount: number): boolean {
  if (!patron) return false;
  if (isSubscriptionExpired(patron)) return false;

  const status: SubscriptionStatus = patron.subscription_status || 'trial';
  const limits: Record<SubscriptionStatus, number> = {
    free: 1,
    populaire: 3,
    pro: 5,
    trial: 2,
    expired: 0,
  };

  const max = limits[status] ?? 2;
  return currentCount < max;
}

/**
 * Vérifie si le patron peut créer/gérer une nouvelle boutique distincte
 */
export function canAddBoutique(patron: Patron | null | undefined, currentCount: number): boolean {
  if (!patron) return false;
  if (isSubscriptionExpired(patron)) return false;

  const status: SubscriptionStatus = patron.subscription_status || 'trial';
  const limits: Record<SubscriptionStatus, number> = {
    free: 1,
    populaire: 1,
    pro: 3,
    trial: 1,
    expired: 0,
  };

  const max = limits[status] ?? 1;
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

  // 5. Tentative de sync directe avec le backend / Supabase
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      await supabase
        .from('patrons')
        .update({
          subscription_status: newPlan,
          current_plan: newPlan,
          subscription_end_date: expiresAt,
        })
        .eq('id', patron.id);

      await supabase
        .from('abonnements')
        .upsert({
          entreprise_id: patron.id,
          statut: 'actif',
          plan: newPlan,
          expire_le: expiresAt,
        }, { onConflict: 'entreprise_id' });
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


