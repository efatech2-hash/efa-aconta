import { supabase } from './supabase';
import { db } from './db';
import type { Patron, ReferralLogRecord } from './types';

/**
 * Génère un code de parrainage unique, propre et mémorisable
 * Format : EFA-XXXXX (ex: EFA-X7Y2Z)
 */
export function generateReferralCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans 0/O 1/I pour lisibilité
  let randomPart = '';
  for (let i = 0; i < 5; i++) {
    randomPart += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `EFA-${randomPart}`;
}

/**
 * Plans annuels strictement éligibles au bonus Ambassadeur +60 jours
 */
export const ELIGIBLE_ANNUAL_PLANS = [
  'populaire_annuel',
  'pro_annuel',
  'boutique_pro_annuel',
  'suite_annuel',
];

/**
 * Vérifie si un forfait/montant correspond à une souscription ANNUELLE
 */
export function isAnnualPlan(plan?: string | null, amount?: number | null, durationDays?: number | null): boolean {
  if (!plan) return false;
  const p = plan.toLowerCase().trim();
  if (ELIGIBLE_ANNUAL_PLANS.includes(p)) return true;
  if ((p === 'populaire' || p === 'pro') && durationDays && durationDays >= 365) return true;
  if (amount && (amount === 16500 || amount === 90000 || amount >= 16500 && (p.includes('annuel') || durationDays && durationDays >= 360))) {
    return true;
  }
  return false;
}

export interface ReferralBonusResult {
  success: boolean;
  reason?: string;
  parrainNom?: string;
  parrainCode?: string;
  bonusDays?: number;
}

/**
 * FONCTION CRITIQUE checkAndGiveReferralBonus(filleul)
 * RÈGLE D'OR = 1 AN SEULEMENT :
 * Le bonus ambassadeur +60 jours n'est donné QUE SI ET SEULEMENT SI le filleul paye un FORFAIT ANNUEL.
 * Appelée UNIQUEMENT depuis Super Admin lors de l'activation d'un abonnement 1 an.
 */
export async function checkAndGiveReferralBonus(filleul: {
  id: string;
  nom_boutique?: string;
  nom_personne?: string;
  nom?: string;
  plan?: string;
  forfait?: string;
  last_payment_amount?: number;
  prix?: number;
  duration_days?: number;
  referral_bonus_given?: boolean;
  referred_by?: string | null;
}): Promise<ReferralBonusResult> {
  try {
    // 1. Vérifier si le filleul a déjà donné son bonus
    if (filleul.referral_bonus_given === true) {
      return { success: false, reason: 'Bonus déjà donné pour ce filleul' };
    }

    // Récupérer les données à jour du filleul si referred_by n'est pas fourni
    let referredBy: string | null | undefined = filleul.referred_by;
    let currentFilleulBonusGiven: boolean | undefined = filleul.referral_bonus_given;

    if (!referredBy || currentFilleulBonusGiven === undefined) {
      try {
        const { data: dbFilleul } = await supabase
          .from('patrons')
          .select('referred_by, referral_bonus_given, plan, forfait')
          .eq('id', filleul.id)
          .maybeSingle();

        if (dbFilleul) {
          if (!referredBy) referredBy = dbFilleul.referred_by;
          if (dbFilleul.referral_bonus_given) currentFilleulBonusGiven = true;
        }
      } catch (e) {
        console.warn('[Ambassadeur] Erreur lecture filleul remote:', e);
      }

      if (!referredBy) {
        try {
          const localF = await db.patrons.get(filleul.id);
          if (localF) {
            if (!referredBy) referredBy = localF.referred_by;
            if (localF.referral_bonus_given) currentFilleulBonusGiven = true;
          }
        } catch (e) {}
      }
    }

    if (currentFilleulBonusGiven === true) {
      return { success: false, reason: 'Bonus déjà donné' };
    }

    // 2. Vérifier si le filleul a un parrain
    if (!referredBy || !referredBy.trim()) {
      return { success: false, reason: 'Ce filleul n’a pas de parrain (pas de code utilisé)' };
    }

    const cleanReferredBy = referredBy.trim().toUpperCase();

    // 3. CONDITION OR : Vérifier si plan est ANNUEL
    const activePlan = filleul.plan || filleul.forfait || '';
    const paymentAmount = filleul.last_payment_amount || filleul.prix || 0;
    const isAnnual = isAnnualPlan(activePlan, paymentAmount, filleul.duration_days);

    if (!isAnnual) {
      return {
        success: false,
        reason: `Plan ${activePlan} non éligible - Seul le paiement de 1 AN donne droit au bonus +60j`,
      };
    }

    // 4. Vérifier si le parrain existe
    let parrain: any = null;

    try {
      const { data } = await supabase
        .from('patrons')
        .select('*')
        .eq('referral_code', cleanReferredBy)
        .maybeSingle();
      if (data) parrain = data;
    } catch (e) {
      console.warn('[Ambassadeur] Erreur recherche parrain remote:', e);
    }

    if (!parrain) {
      try {
        const { data: btq } = await supabase
          .from('efa_boutiques')
          .select('*')
          .eq('referral_code', cleanReferredBy)
          .maybeSingle();
        if (btq) parrain = btq;
      } catch (e) {}
    }

    if (!parrain) {
      // Vérifier dans Dexie local
      const localPatrons = await db.patrons.toArray();
      parrain = localPatrons.find((p) => p.referral_code?.toUpperCase() === cleanReferredBy);
    }

    if (!parrain) {
      return { success: false, reason: `Parrain avec le code ${cleanReferredBy} introuvable` };
    }

    // Empêcher l'auto-parrainage
    if (parrain.id === filleul.id) {
      return { success: false, reason: 'Auto-parrainage interdit' };
    }

    // 5. DONNER BONUS +60 JOURS AU PARRAIN
    const parrainRawEnd =
      parrain.subscription_end ||
      parrain.subscription_end_date ||
      parrain.fin_abonnement ||
      parrain.abonnement_expire ||
      parrain.date_fin_essai;

    const now = new Date();
    let baseDate = now;
    if (parrainRawEnd) {
      const d = new Date(parrainRawEnd);
      if (!isNaN(d.getTime()) && d > now) {
        baseDate = d;
      }
    }

    const newEnd = new Date(baseDate.getTime() + 60 * 24 * 60 * 60 * 1000);
    const newEndIso = newEnd.toISOString();
    const newReferralsCount = (parrain.referrals_count || 0) + 1;
    const newBonusDays = (parrain.bonus_days_earned || 0) + 60;

    // Mise à jour Cloud Supabase du Parrain
    try {
      await supabase
        .from('patrons')
        .update({
          subscription_end: newEndIso,
          subscription_end_date: newEndIso,
          fin_abonnement: newEndIso,
          abonnement_expire: newEndIso,
          referrals_count: newReferralsCount,
          bonus_days_earned: newBonusDays,
          is_active: true,
          statut: 'ACTIF',
        } as any)
        .eq('id', parrain.id);
    } catch (e) {
      console.warn('[Ambassadeur] Update patron remote:', e);
    }

    try {
      await supabase
        .from('efa_boutiques')
        .update({
          date_fin_essai: newEndIso,
          is_active: true,
          referrals_count: newReferralsCount,
          bonus_days_earned: newBonusDays,
        } as any)
        .eq('id', parrain.id);
    } catch (e) {}

    // Mise à jour Dexie local du Parrain
    try {
      const localP = await db.patrons.get(parrain.id);
      if (localP) {
        await db.patrons.update(parrain.id, {
          subscription_end_date: newEndIso,
          abonnement_expire: newEndIso,
          fin_abonnement: newEndIso,
          referrals_count: newReferralsCount,
          bonus_days_earned: newBonusDays,
        });
      }
    } catch (e) {}

    // 6. Marquer le filleul comme ayant donné son bonus (1 seule fois à vie)
    try {
      await supabase
        .from('patrons')
        .update({
          referral_bonus_given: true,
          has_paid_annuel: true,
        } as any)
        .eq('id', filleul.id);
    } catch (e) {}

    try {
      await supabase
        .from('efa_boutiques')
        .update({
          referral_bonus_given: true,
          has_paid_annuel: true,
        } as any)
        .eq('id', filleul.id);
    } catch (e) {}

    try {
      const localF = await db.patrons.get(filleul.id);
      if (localF) {
        await db.patrons.update(filleul.id, {
          referral_bonus_given: true,
          has_paid_annuel: true,
        });
      }
    } catch (e) {}

    // 7. Enregistrer dans referrals_log Supabase
    const logId = 'ref_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);
    try {
      await supabase.from('referrals_log').insert({
        id: logId,
        parrain_id: parrain.id,
        filleul_id: filleul.id,
        filleul_plan: activePlan,
        bonus_days: 60,
        is_annual: true,
        created_at: new Date().toISOString(),
      });
    } catch (e) {
      console.warn('[Ambassadeur] Insertion referrals_log (remote):', e);
    }

    // Sauvegarde miroir local pour affichage immédiat et offline
    try {
      const stored = localStorage.getItem('efa_referrals_log');
      const list = stored ? JSON.parse(stored) : [];
      list.push({
        id: logId,
        parrain_id: parrain.id,
        parrain_nom: parrain.nom_boutique || parrain.nom_affichage || parrain.nom || 'Parrain',
        filleul_id: filleul.id,
        filleul_nom: filleul.nom_boutique || filleul.nom_personne || filleul.nom || 'Filleul',
        filleul_plan: activePlan,
        bonus_days: 60,
        is_annual: true,
        created_at: new Date().toISOString(),
      });
      localStorage.setItem('efa_referrals_log', JSON.stringify(list));
    } catch (e) {}

    const parrainNom = parrain.nom_affichage || parrain.nom_boutique || parrain.nom || 'Parrain';
    return {
      success: true,
      parrainNom,
      parrainCode: cleanReferredBy,
      bonusDays: 60,
    };
  } catch (error: any) {
    console.error('[Ambassadeur] Erreur checkAndGiveReferralBonus:', error);
    return { success: false, reason: error?.message || 'Erreur inattendue' };
  }
}

/**
 * Récupère le nombre total de parrainages annuels validés (+60j donnés)
 */
export async function getTotalAnnualReferralsCount(): Promise<number> {
  try {
    const { count, error } = await supabase
      .from('referrals_log')
      .select('*', { count: 'exact', head: true });

    if (!error && typeof count === 'number') {
      return count;
    }
  } catch (e) {}

  // Fallback 1 : compter les patrons avec has_paid_annuel
  try {
    const { count } = await supabase
      .from('patrons')
      .select('*', { count: 'exact', head: true })
      .eq('has_paid_annuel', true);
    if (typeof count === 'number' && count > 0) return count;
  } catch (e) {}

  // Fallback 2 : localStorage
  try {
    const stored = localStorage.getItem('efa_referrals_log');
    if (stored) {
      const list = JSON.parse(stored);
      if (Array.isArray(list)) return list.length;
    }
  } catch (e) {}

  return 0;
}

export interface FilleulInfo {
  id: string;
  nom: string;
  nom_boutique: string;
  telephone?: string;
  created_at?: string;
  plan: string;
  statutText: 'Essai' | 'Payé 30j (non éligible)' | 'Payé 6 mois (non éligible)' | 'Payé 1 AN (Bonus +60j donné ✅)';
  isBonusAwarded: boolean;
}

/**
 * Récupère la liste des filleuls d'un parrain donné (par son referral_code)
 */
export async function getFilleulsForParrain(referralCode?: string | null): Promise<FilleulInfo[]> {
  if (!referralCode) return [];
  const code = referralCode.trim().toUpperCase();

  const results: FilleulInfo[] = [];
  const visitedIds = new Set<string>();

  // 1. Chercher dans patrons Supabase
  try {
    const { data } = await supabase
      .from('patrons')
      .select('id, nom, nom_boutique, telephone, created_at, plan, forfait, referral_bonus_given, has_paid_annuel, last_payment_amount, prix')
      .eq('referred_by', code);

    if (data && Array.isArray(data)) {
      for (const p of data) {
        visitedIds.add(p.id);
        results.push(classifyFilleul(p));
      }
    }
  } catch (e) {}

  // 2. Chercher dans efa_boutiques
  try {
    const { data: btqs } = await supabase
      .from('efa_boutiques')
      .select('*')
      .eq('referred_by', code);

    if (btqs && Array.isArray(btqs)) {
      for (const b of btqs) {
        if (!visitedIds.has(b.id)) {
          visitedIds.add(b.id);
          results.push(
            classifyFilleul({
              id: b.id,
              nom: b.nom_patron || b.nom_affichage,
              nom_boutique: b.nom_affichage || b.nom_boutique,
              telephone: '',
              created_at: b.created_at,
              plan: b.plan,
              referral_bonus_given: (b as any).referral_bonus_given,
              has_paid_annuel: (b as any).has_paid_annuel,
              last_payment_amount: b.last_payment_amount,
            })
          );
        }
      }
    }
  } catch (e) {}

  // 3. Chercher dans Dexie local
  try {
    const local = await db.patrons.toArray();
    for (const lp of local) {
      if (lp.referred_by?.toUpperCase() === code && !visitedIds.has(lp.id)) {
        visitedIds.add(lp.id);
        results.push(classifyFilleul(lp));
      }
    }
  } catch (e) {}

  return results;
}

function classifyFilleul(p: any): FilleulInfo {
  const plan = (p.plan || p.forfait || 'essai').toLowerCase();
  const amount = p.last_payment_amount || p.prix || 0;
  const bonusGiven = p.referral_bonus_given === true || p.has_paid_annuel === true;

  let statutText: FilleulInfo['statutText'] = 'Essai';

  if (bonusGiven || isAnnualPlan(plan, amount)) {
    statutText = 'Payé 1 AN (Bonus +60j donné ✅)';
  } else if (plan === 'pro_6mois' || amount === 50000) {
    statutText = 'Payé 6 mois (non éligible)';
  } else if (plan === 'mensuel_30j' || plan === 'prolonge' || amount === 1500) {
    statutText = 'Payé 30j (non éligible)';
  } else {
    statutText = 'Essai';
  }

  return {
    id: p.id,
    nom: p.nom || 'Commerçante',
    nom_boutique: p.nom_boutique || p.nom_affichage || 'Boutique',
    telephone: p.telephone || p.phone_full || '',
    created_at: p.created_at,
    plan,
    statutText,
    isBonusAwarded: statutText.startsWith('Payé 1 AN'),
  };
}
