import type { Patron, SubscriptionStatus } from './types';
import { db } from './db';
import { queueSyncItem } from './sync';
import { supabase } from './supabase';
import { getActiveBoutiqueId } from './deviceAuth';

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
 * - ESSAI = 7 articles max, 1 vendeur max, 21 jours depuis date_inscription du patron, 1 boutique, pas de multi-boutique
 * - POPULAIRE 16500 = 100 articles max, 3 vendeurs max, 3 appareils max, 1 boutique
 * - PRO 90000 (ou 50000) = 300 articles max, 10 vendeurs max, 5 appareils max, 3 boutiques max
 */
export function getLimites(plan?: string | null): OfficialPlanLimites {
  const p = (plan || '').toLowerCase().trim();
  if (p === 'populaire' || p.includes('populaire') || p.includes('16500') || p === 'payant' || p.includes('prolonge')) {
    return {
      plan: 'populaire',
      name: 'Offre Populaire (16 500 F/1 an)',
      maxArticles: 100,
      maxVendeurs: 3,
      maxAppareils: 3,
      maxBoutiques: 1,
    };
  }
  if (
    p === 'pro' ||
    p.includes('pro') ||
    p.includes('50000') ||
    p.includes('90000') ||
    p.includes('6mois') ||
    p === 'suite_annuel'
  ) {
    return {
      plan: 'pro',
      name: 'Boutique Pro (90 000 F/1 an)',
      maxArticles: 300,
      maxVendeurs: 10,
      maxAppareils: 5,
      maxBoutiques: 3,
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
 * Vérifie si le patron a l'offre Boutique Pro active (exclut Populaire!)
 */
export function isBoutiquePro(patron?: Patron | null): boolean {
  if (!patron) return false;
  const status = (patron.subscription_status || '').toLowerCase();
  const plan = (patron.current_plan || '').toLowerCase();
  const forfait = (patron.forfait || '').toLowerCase();
  const statut = (patron.statut || '').toLowerCase();
  if (
    status.includes('populaire') ||
    plan.includes('populaire') ||
    forfait.includes('populaire') ||
    status.includes('prolonge') ||
    plan.includes('prolonge') ||
    forfait.includes('prolonge') ||
    forfait.includes('16500')
  ) {
    return false;
  }
  return (
    status === 'pro' ||
    status.startsWith('pro_') ||
    plan === 'pro' ||
    plan.startsWith('pro_') ||
    (forfait.includes('pro') && !forfait.includes('prolonge')) ||
    (statut.includes('pro') && !statut.includes('prolonge')) ||
    patron.isProActive === true ||
    patron.isSubOfPro === true
  );
}

/**
 * RÈGLE D'OR : Si une boutique du patron est PRO (50 000 F ou 90 000 F), TOUTES ses boutiques sont PRO
 * (Ne jamais confondre POPULAIRE 16500 avec PRO!)
 */
export async function isPatronOrAnyBoutiquePro(patron?: Patron | null): Promise<boolean> {
  if (!patron) return false;
  if (isBoutiquePro(patron)) return true;

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
          const amt = Number(b.last_payment_amount) || 0;
          if (p.includes('populaire') || p.includes('16500') || p.includes('prolonge')) return false;
          return p === 'pro' || p.startsWith('pro_') || (p.includes('pro') && !p.includes('prolonge')) || amt >= 50000;
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
  const status = (patron.subscription_status || patron.current_plan || patron.forfait || '').toLowerCase();
  if (status === 'populaire' || status.includes('populaire') || status.includes('16500') || status.includes('prolonge')) {
    return 'populaire';
  }
  const isPro = await isPatronOrAnyBoutiquePro(patron);
  if (isPro) return 'pro';
  return 'essai';
}

/**
 * Résout l'ID du patron principal (`ownerId`) et TOUS les IDs de ses boutiques (Principale + Boutique 2 + Boutique 3)
 */
export async function resolvePatronStoreIds(patron: Patron): Promise<{ ownerId: string; storeIds: string[] }> {
  let ownerId = patron.parentId || patron.ownerId || (patron as any).patron_id || patron.id;

  try {
    const localPatrons = await db.patrons.toArray();
    const selfLocal = localPatrons.find((p) => p.id === patron.id);
    if (selfLocal) {
      ownerId = selfLocal.parentId || selfLocal.ownerId || (selfLocal as any).patron_id || ownerId;
    }

    if (typeof navigator !== 'undefined' && navigator.onLine && ownerId.startsWith('btq_sub_')) {
      try {
        const { data: selfRemote } = await supabase
          .from('boutiques')
          .select('id, patron_id')
          .eq('id', ownerId)
          .maybeSingle();
        if (selfRemote?.patron_id) {
          ownerId = selfRemote.patron_id;
        }
      } catch {}
    }

    const idSet = new Set<string>([ownerId, patron.id]);
    for (const lp of localPatrons) {
      if (
        lp.id === ownerId ||
        lp.parentId === ownerId ||
        lp.ownerId === ownerId ||
        (lp as any).patron_id === ownerId
      ) {
        idSet.add(lp.id);
      }
    }

    if (typeof navigator !== 'undefined' && navigator.onLine) {
      try {
        const { data: siblingStores } = await supabase
          .from('boutiques')
          .select('id, patron_id')
          .or(`id.eq.${ownerId},patron_id.eq.${ownerId}${patron.telephone ? `,telephone.eq.${patron.telephone}` : ''}`);
        if (Array.isArray(siblingStores)) {
          for (const s of siblingStores) {
            if (s.id) idSet.add(s.id);
          }
        }
      } catch {}
    }

    return { ownerId, storeIds: Array.from(idSet) };
  } catch {
    return { ownerId, storeIds: Array.from(new Set([ownerId, patron.id])) };
  }
}

/**
 * Compte uniquement les produits actifs de la boutique actuellement affichée (pour affichage inventaire local).
 * Pour les limites d'abonnement, utiliser TOUJOURS getTotalProductsCountByPatron(patron).
 */
export async function getActiveBoutiqueProductsCount(patron: Patron): Promise<number> {
  try {
    const activeBoutiqueId = getActiveBoutiqueId(patron) || patron.id;
    const isSub = activeBoutiqueId.startsWith('btq_sub_') || Boolean(patron.parentId);

    const localAll = await db.produits.toArray();
    const localActive = localAll.filter(
      (p) =>
        p.status !== 'deleted' &&
        p.is_deleted !== true &&
        (isSub
          ? p.boutique_id === activeBoutiqueId
          : p.boutique_id
          ? p.boutique_id === activeBoutiqueId
          : p.patron_id === activeBoutiqueId)
    );

    if (typeof navigator !== 'undefined' && navigator.onLine) {
      const orFilter = isSub
        ? `boutique_id.eq.${activeBoutiqueId}`
        : `boutique_id.eq.${activeBoutiqueId},and(boutique_id.is.null,patron_id.eq.${activeBoutiqueId})`;

      const { data: remoteRows, error } = await supabase
        .from('produits')
        .select('id, status, is_deleted')
        .or(orFilter);

      if (!error && Array.isArray(remoteRows)) {
        const remoteActiveIds = new Set(
          remoteRows
            .filter((r: any) => r.status !== 'deleted' && r.is_deleted !== true)
            .map((r: any) => r.id)
        );
        for (const lp of localActive) {
          if (lp.synced === false) {
            remoteActiveIds.add(lp.id);
          }
        }
        return remoteActiveIds.size;
      }
    }

    return localActive.length;
  } catch (err) {
    console.warn('[getActiveBoutiqueProductsCount] Erreur:', err);
    return 0;
  }
}

/**
 * RÈGLE STRICTE : Les limites de produits sont par PATRON, partagées sur TOUTES ses boutiques.
 * Compte total = COUNT(*) dans produits WHERE patron_id = patron actuel (ou l'une de ses boutiques),
 * toutes boutiques confondues, hors produits supprimés (status = 'deleted' ou is_deleted = true).
 */
export async function getTotalProductsCountByPatron(patron: Patron): Promise<number> {
  try {
    const { ownerId, storeIds } = await resolvePatronStoreIds(patron);
    const localAll = await db.produits.toArray();
    const localActive = localAll.filter(
      (p) =>
        p.status !== 'deleted' &&
        p.is_deleted !== true &&
        (p.patron_id === ownerId ||
          storeIds.includes(p.patron_id || '') ||
          storeIds.includes(p.boutique_id || ''))
    );

    if (typeof navigator !== 'undefined' && navigator.onLine) {
      const orClauses = [
        `patron_id.eq.${ownerId}`,
        ...storeIds.map((sid) => `boutique_id.eq.${sid}`),
        ...storeIds.filter((sid) => sid !== ownerId).map((sid) => `patron_id.eq.${sid}`),
      ];

      const { data: remoteRows, error } = await supabase
        .from('produits')
        .select('id, status, is_deleted')
        .or(orClauses.join(','));

      if (!error && Array.isArray(remoteRows)) {
        const activeIds = new Set<string>(
          remoteRows
            .filter((r: any) => r.status !== 'deleted' && r.is_deleted !== true)
            .map((r: any) => String(r.id))
        );
        for (const lp of localActive) {
          if (lp.synced === false) {
            activeIds.add(String(lp.id));
          }
        }
        return activeIds.size;
      }
    }

    return new Set(localActive.map((p) => String(p.id))).size;
  } catch (err) {
    console.warn('[getTotalProductsCountByPatron] Erreur:', err);
    return 0;
  }
}

/**
 * Calcule le total d'employés / vendeurs actifs (hors supprimés) par patron_id,
 * toutes boutiques du patron confondues (Principale + Boutique 2 + Boutique 3).
 */
export async function getTotalEmployesCountByPatron(patron: Patron): Promise<number> {
  try {
    const { ownerId, storeIds } = await resolvePatronStoreIds(patron);
    const localAll = await db.employes.toArray();
    const localActive = localAll.filter(
      (e) =>
        e.status !== 'deleted' &&
        e.is_deleted !== true &&
        (e.patron_id === ownerId ||
          storeIds.includes(e.patron_id || '') ||
          storeIds.includes(e.boutique_id || ''))
    );

    if (typeof navigator !== 'undefined' && navigator.onLine) {
      const orClauses = [
        `patron_id.eq.${ownerId}`,
        ...storeIds.map((sid) => `boutique_id.eq.${sid}`),
        ...storeIds.filter((sid) => sid !== ownerId).map((sid) => `patron_id.eq.${sid}`),
      ];
      const { data: remoteEmps, error } = await supabase
        .from('employes')
        .select('id, status, is_deleted')
        .or(orClauses.join(','));

      if (!error && Array.isArray(remoteEmps)) {
        const activeIds = new Set<string>(
          remoteEmps
            .filter((e: any) => e.status !== 'deleted' && e.is_deleted !== true)
            .map((e: any) => String(e.id))
        );
        for (const le of localActive) {
          if ((le as any).synced === false) {
            activeIds.add(String(le.id));
          }
        }
        return activeIds.size;
      }
    }

    return new Set(localActive.map((e) => String(e.id))).size;
  } catch (err) {
    console.warn('[getTotalEmployesCountByPatron] Erreur:', err);
    return 0;
  }
}

/**
 * VÉRIFICATION ASYNCHRONE DU QUOTA PRODUITS PARTAGÉ SUR TOUTES LES BOUTIQUES DU PATRON
 * Bloque dès que totalPatron >= maxArticles (y compris si déjà > maxArticles suite à l'ancien bug, sans rien supprimer).
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
    message = `Limite de produits atteinte pour votre abonnement (${limites.maxArticles}/${limites.maxArticles}). Supprimez un produit ou passez à un plan supérieur.`;
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
 * VÉRIFICATION ASYNCHRONE DU QUOTA EMPLOYÉS / VENDEURS TOTAL PAR PATRON_ID (toutes boutiques confondues)
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
    message = `Limite d'employés atteinte (${limites.maxVendeurs}/${limites.maxVendeurs})`;
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
 * Calcule la date de fin d'essai de 21 jours STRICTEMENT depuis patrons.date_inscription
 * (jamais depuis une boutique secondaire btq_sub_...).
 */
export function getTrialEndDateFromPatron(patron?: Patron | null): Date | null {
  if (!patron) return null;
  if (patron.date_inscription) {
    const start = new Date(patron.date_inscription);
    if (!isNaN(start.getTime())) {
      return new Date(start.getTime() + 21 * 24 * 60 * 60 * 1000);
    }
  }
  const isSub = patron.type === 'SUB' || Boolean(patron.parentId) || Boolean(patron.id?.startsWith('btq_sub_'));
  if (!isSub && (patron.trial_start_date || patron.created_at)) {
    const start = new Date(patron.trial_start_date || patron.created_at);
    if (!isNaN(start.getTime())) {
      return new Date(start.getTime() + 21 * 24 * 60 * 60 * 1000);
    }
  }
  if (patron.trial_end_date) {
    const end = new Date(patron.trial_end_date);
    if (!isNaN(end.getTime())) return end;
  }
  return null;
}

/**
 * Calcule si le patron est actuellement en période d'essai expirée
 */
export function isSubscriptionExpired(patron?: Patron | null): boolean {
  if (!patron) return false;
  // Si le patron est PRO actif
  if (isBoutiquePro(patron) || patron.isProActive === true) {
    const paidEnd = patron.subscription_end_date || patron.fin_abonnement || patron.abonnement_expire;
    if (paidEnd) {
      const end = new Date(paidEnd);
      if (!isNaN(end.getTime())) return new Date() > end;
    }
    return false;
  }
  // Si Populaire actif
  const status = (patron.subscription_status || patron.current_plan || patron.forfait || '').toLowerCase();
  if (status === 'populaire' || status.includes('populaire') || status.includes('prolonge')) {
    const paidEnd = patron.subscription_end_date || patron.fin_abonnement || patron.abonnement_expire;
    if (paidEnd) {
      const end = new Date(paidEnd);
      if (!isNaN(end.getTime())) return new Date() > end;
    }
    return false;
  }

  // Essai gratuit : 21 jours calculés depuis patrons.date_inscription
  const trialEnd = getTrialEndDateFromPatron(patron);
  if (trialEnd) {
    return new Date() > trialEnd;
  }

  if (patron.subscription_status === 'expired') return true;
  return false;
}

/**
 * Nombre de jours restants dans l'essai gratuit (21 jours depuis patrons.date_inscription)
 */
export function getRemainingTrialDays(patron?: Patron | null): number {
  const end = getTrialEndDateFromPatron(patron);
  if (!end) return 0;
  const now = new Date();
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

  const effPlan = await getEffectivePlan(patron);
  const isExpired = isSubscriptionExpired(patron);
  const plan: SubscriptionStatus = isExpired
    ? 'expired'
    : effPlan === 'pro'
    ? 'pro'
    : effPlan === 'populaire'
    ? 'populaire'
    : (patron.subscription_status || 'trial');
  const config = PLAN_CONFIGS[plan] || PLAN_CONFIGS.trial;
  const limites = getLimites(effPlan);
  const mainStoreId = patron.parentId || patron.ownerId || (patron as any).patron_id || patron.id;

  const [articlesCount, employesCount, appareilsCount, boutiquesCount] = await Promise.all([
    getTotalProductsCountByPatron(patron),
    getTotalEmployesCountByPatron(patron),
    db.appareils.where('patron_id').equals(mainStoreId).count(),
    db.boutiques.where('patron_id').equals(mainStoreId).count(),
  ]);

  const activeBoutiques = Math.max(1, boutiquesCount);
  const activeAppareils = Math.max(1, appareilsCount);

  return {
    plan,
    planName: config.name,
    expiresAt: patron.subscription_end_date || getTrialEndDateFromPatron(patron)?.toISOString() || patron.trial_end_date,
    isExpired: isSubscriptionExpired(patron),
    articles: {
      used: articlesCount,
      max: limites.maxArticles,
      percent: Math.min(100, Math.round((articlesCount / Math.max(1, limites.maxArticles)) * 100)),
      isLimitReached: articlesCount >= limites.maxArticles,
    },
    employes: {
      used: employesCount,
      max: limites.maxVendeurs,
      percent: Math.min(100, Math.round((employesCount / Math.max(1, limites.maxVendeurs)) * 100)),
      isLimitReached: employesCount >= limites.maxVendeurs,
    },
    appareils: {
      used: activeAppareils,
      max: limites.maxAppareils,
      percent: Math.min(100, Math.round((activeAppareils / Math.max(1, limites.maxAppareils)) * 100)),
      isLimitReached: activeAppareils >= limites.maxAppareils,
    },
    boutiques: {
      used: activeBoutiques,
      max: limites.maxBoutiques,
      percent: Math.min(100, Math.round((activeBoutiques / Math.max(1, limites.maxBoutiques)) * 100)),
      isLimitReached: activeBoutiques >= limites.maxBoutiques,
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


