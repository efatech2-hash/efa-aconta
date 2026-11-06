import { supabase } from './supabase';
import type { ReferralLogRecord } from './types';

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
 * Plans annuels strictement éligibles au bonus Ambassadeur +2 MOIS (+60 jours)
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
  if (amount && (amount === 16500 || amount === 90000 || (amount >= 16500 && (p.includes('annuel') || (durationDays && durationDays >= 360))))) {
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

export interface CentralReferralRow {
  id: string;
  parrain_id: string;
  filleul_id: string;
  status: 'pending' | 'paid';
  reward_given: boolean;
  parrain_code?: string;
  filleul_code?: string;
  parrain_nom?: string;
  filleul_nom?: string;
  filleul_plan?: string;
  reward_date?: string | null;
  created_at: string;
}

/**
 * FONCTION CRITIQUE checkAndGiveReferralBonus(filleul)
 * RÈGLE D'OR = 1 AN SEULEMENT :
 * Le bonus ambassadeur +2 mois (+60 jours) n'est accordé QUE SI ET SEULEMENT SI le filleul paye un FORFAIT ANNUEL.
 * Met à jour Supabase table "referrals" -> status='paid', reward_given=true.
 * Prolonge subscription_end_date de +2 mois pour le PARRAIN et le FILLEUL.
 * 100% Supabase (Zéro localStorage).
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

    // Récupérer les données à jour du filleul depuis Supabase
    let referredBy: string | null | undefined = filleul.referred_by;
    let currentFilleulBonusGiven: boolean | undefined = filleul.referral_bonus_given;
    let filleulPlan = filleul.plan || filleul.forfait || '';
    let paymentAmount = filleul.last_payment_amount || filleul.prix || 0;

    try {
      const { data: dbBoutique } = await supabase
        .from('boutiques')
        .select('referred_by, referred_by_code, referral_bonus_given, plan, last_payment_amount, subscription_end, subscription_end_date')
        .eq('id', filleul.id)
        .maybeSingle();

      if (dbBoutique) {
        if (!referredBy) referredBy = dbBoutique.referred_by_code || dbBoutique.referred_by;
        if (dbBoutique.referral_bonus_given) currentFilleulBonusGiven = true;
        if (!filleulPlan) filleulPlan = dbBoutique.plan;
        if (!paymentAmount) paymentAmount = Number(dbBoutique.last_payment_amount) || 0;
      }
    } catch (e) {
      console.warn('[Ambassadeur] Erreur lecture boutique Supabase:', e);
    }

    if (!referredBy) {
      try {
        const { data: dbPatron } = await supabase
          .from('patrons')
          .select('referred_by, referral_bonus_given, plan, forfait, last_payment_amount')
          .eq('id', filleul.id)
          .maybeSingle();

        if (dbPatron) {
          if (!referredBy) referredBy = dbPatron.referred_by;
          if (dbPatron.referral_bonus_given) currentFilleulBonusGiven = true;
          if (!filleulPlan) filleulPlan = dbPatron.plan || dbPatron.forfait;
        }
      } catch (e) {}
    }

    if (currentFilleulBonusGiven === true) {
      return { success: false, reason: 'Bonus déjà accordé' };
    }

    // 2. Vérifier si le filleul a un parrain
    if (!referredBy || !referredBy.trim()) {
      return { success: false, reason: 'Ce filleul n’a pas de parrain (aucun code utilisé)' };
    }

    const cleanReferredBy = referredBy.trim().toUpperCase();

    // 3. CONDITION OR : Vérifier si le plan est ANNUEL (1 AN)
    const isAnnual = isAnnualPlan(filleulPlan, paymentAmount, filleul.duration_days);
    if (!isAnnual) {
      return {
        success: false,
        reason: `Plan ${filleulPlan} non éligible - Seul le paiement de 1 AN donne droit au bonus +2 mois`,
      };
    }

    // 4. Tentative d'exécution via RPC Supabase
    try {
      const { data: rpcData, error: rpcErr } = await (supabase.rpc as any)('reward_referral_bonus', {
        target_filleul_id: filleul.id,
      });

      if (!rpcErr && rpcData?.success) {
        console.log('[Ambassadeur] RPC reward_referral_bonus exécuté avec succès:', rpcData);
        return {
          success: true,
          bonusDays: 60,
          parrainCode: cleanReferredBy,
        };
      }
    } catch (rpcEx) {
      console.warn('[Ambassadeur] Note RPC Supabase (fallback vers requêtes directes):', rpcEx);
    }

    // 5. Recherche du parrain dans Supabase (boutiques, profiles, patrons)
    let parrain: any = null;
    try {
      const { data: btqParrain } = await supabase
        .from('boutiques')
        .select('*')
        .eq('referral_code', cleanReferredBy)
        .maybeSingle();
      if (btqParrain) parrain = btqParrain;
    } catch (e) {}

    if (!parrain) {
      try {
        const { data: patronParrain } = await supabase
          .from('patrons')
          .select('*')
          .eq('referral_code', cleanReferredBy)
          .maybeSingle();
        if (patronParrain) parrain = patronParrain;
      } catch (e) {}
    }

    if (!parrain) {
      try {
        const { data: profileParrain } = await supabase
          .from('profiles')
          .select('*')
          .eq('referral_code', cleanReferredBy)
          .maybeSingle();
        if (profileParrain) parrain = profileParrain;
      } catch (e) {}
    }

    if (!parrain) {
      return { success: false, reason: `Parrain avec le code ${cleanReferredBy} introuvable` };
    }

    // Empêcher l'auto-parrainage
    if (parrain.id === filleul.id) {
      return { success: false, reason: 'Auto-parrainage interdit' };
    }

    // 6. CALCUL EXTENSION +2 MOIS (60 jours) POUR LE PARRAIN
    const now = new Date();
    const parrainRawEnd = parrain.subscription_end_date || parrain.subscription_end || parrain.fin_abonnement;
    let parrainBaseDate = now;
    if (parrainRawEnd) {
      const d = new Date(parrainRawEnd);
      if (!isNaN(d.getTime()) && d > now) {
        parrainBaseDate = d;
      }
    }
    const parrainNewEnd = new Date(parrainBaseDate.getTime() + 60 * 24 * 60 * 60 * 1000);
    const parrainNewEndIso = parrainNewEnd.toISOString();
    const newReferralsCount = (Number(parrain.referrals_count) || 0) + 1;
    const newBonusDays = (Number(parrain.bonus_days_earned) || 0) + 60;

    // 7. CALCUL EXTENSION +2 MOIS (60 jours) POUR LE FILLEUL
    let filleulBaseDate = now;
    try {
      const { data: fRow } = await supabase
        .from('boutiques')
        .select('subscription_end, subscription_end_date')
        .eq('id', filleul.id)
        .maybeSingle();
      const fEnd = fRow?.subscription_end_date || fRow?.subscription_end;
      if (fEnd) {
        const df = new Date(fEnd);
        if (!isNaN(df.getTime()) && df > now) filleulBaseDate = df;
      }
    } catch {}
    const filleulNewEnd = new Date(filleulBaseDate.getTime() + 60 * 24 * 60 * 60 * 1000);
    const filleulNewEndIso = filleulNewEnd.toISOString();

    // 8. METTRE À JOUR SUPABASE (Table centrale referrals)
    try {
      // Vérifier si une entrée referral existe déjà pour ce filleul
      const { data: existingRef } = await supabase
        .from('referrals')
        .select('id')
        .eq('filleul_id', filleul.id)
        .maybeSingle();

      if (existingRef) {
        await supabase
          .from('referrals')
          .update({
            status: 'paid',
            reward_given: true,
            reward_date: now.toISOString(),
            filleul_plan: filleulPlan,
          })
          .eq('id', existingRef.id);
      } else {
        await supabase.from('referrals').insert({
          id: 'ref_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6),
          parrain_id: parrain.id,
          filleul_id: filleul.id,
          status: 'paid',
          reward_given: true,
          parrain_code: cleanReferredBy,
          filleul_code: (filleul as any).referral_code,
          parrain_nom: parrain.proprietaire || parrain.nom_boutique || parrain.nom || 'Parrain',
          filleul_nom: filleul.nom_boutique || filleul.nom_personne || filleul.nom || 'Filleul',
          filleul_plan: filleulPlan,
          reward_date: now.toISOString(),
          created_at: now.toISOString(),
        });
      }
    } catch (refErr) {
      console.warn('[Ambassadeur] Update referrals table:', refErr);
    }

    // 9. METTRE À JOUR PARRAIN DANS BOUTIQUES, PROFILES, PATRONS
    try {
      const parrainPlanRaw = (parrain.plan || '').toLowerCase();
      // Si parrain est PRO ou POPULAIRE, il GARDE son plan. Jamais retour en ESSAI.
      const preservedParrainPlan = parrainPlanRaw.includes('pro')
        ? 'pro'
        : parrainPlanRaw.includes('pop')
        ? 'populaire'
        : parrainPlanRaw || 'populaire';

      await supabase
        .from('boutiques')
        .update({
          subscription_end: parrainNewEndIso,
          subscription_end_date: parrainNewEndIso,
          plan: preservedParrainPlan,
          is_active: true,
          status: 'active',
          updated_at: new Date().toISOString(),
        })
        .eq('id', parrain.id);
    } catch (e) {}

    try {
      await supabase
        .from('profiles')
        .update({
          subscription_end_date: parrainNewEndIso,
        })
        .eq('id', parrain.id);
    } catch (e) {}

    try {
      await supabase
        .from('patrons')
        .update({
          subscription_end: parrainNewEndIso,
          subscription_end_date: parrainNewEndIso,
          fin_abonnement: parrainNewEndIso,
          abonnement_expire: parrainNewEndIso,
          referrals_count: newReferralsCount,
          bonus_days_earned: newBonusDays,
          is_active: true,
          statut: 'ACTIF',
        } as any)
        .eq('id', parrain.id);
    } catch (e) {}

    // 10. METTRE À JOUR FILLEUL DANS BOUTIQUES, PROFILES, PATRONS
    try {
      const filleulPlanRaw = (filleulPlan || '').toLowerCase();
      const preservedFilleulPlan = filleulPlanRaw.includes('pro') ? 'pro' : 'populaire';

      await supabase
        .from('boutiques')
        .update({
          subscription_end: filleulNewEndIso,
          subscription_end_date: filleulNewEndIso,
          plan: preservedFilleulPlan,
          has_paid_annuel: true,
          is_active: true,
          status: 'active',
          updated_at: new Date().toISOString(),
        })
        .eq('id', filleul.id);
    } catch (e) {}

    try {
      await supabase
        .from('profiles')
        .update({
          subscription_end_date: filleulNewEndIso,
        })
        .eq('id', filleul.id);
    } catch (e) {}

    try {
      await supabase
        .from('patrons')
        .update({
          subscription_end: filleulNewEndIso,
          subscription_end_date: filleulNewEndIso,
          referral_bonus_given: true,
          has_paid_annuel: true,
          is_active: true,
          statut: 'ACTIF',
        } as any)
        .eq('id', filleul.id);
    } catch (e) {}

    const parrainNom = parrain.proprietaire || parrain.nom_boutique || parrain.nom || 'Parrain';
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
 * Récupère le nombre total de parrainages validés (payés 1 an, bonus accordé)
 * 100% Supabase
 */
export async function getTotalAnnualReferralsCount(): Promise<number> {
  try {
    const { count, error } = await supabase
      .from('referrals')
      .select('*', { count: 'exact', head: true })
      .or('status.eq.paid,reward_given.eq.true');

    if (!error && typeof count === 'number') {
      return count;
    }
  } catch (e) {}

  try {
    const { count } = await supabase
      .from('boutiques')
      .select('*', { count: 'exact', head: true })
      .eq('has_paid_annuel', true);
    if (typeof count === 'number' && count > 0) return count;
  } catch (e) {}

  return 0;
}

/**
 * Récupère tous les enregistrements de parrainage pour le Super Admin
 * 100% Supabase
 */
export async function getReferralsListCentral(): Promise<CentralReferralRow[]> {
  try {
    const { data, error } = await supabase
      .from('referrals')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && Array.isArray(data)) {
      return data as CentralReferralRow[];
    }
  } catch (e) {
    console.warn('[Ambassadeur] Erreur lecture referrals:', e);
  }
  return [];
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
 * Récupère la liste des filleuls d'un parrain donné depuis Supabase
 * 100% Supabase (Zéro localStorage)
 */
export async function getFilleulsForParrain(referralCode?: string | null): Promise<FilleulInfo[]> {
  if (!referralCode) return [];
  const code = referralCode.trim().toUpperCase();

  const results: FilleulInfo[] = [];
  const visitedIds = new Set<string>();

  // 1. Chercher dans la table centrale "referrals"
  try {
    const { data: refData } = await supabase
      .from('referrals')
      .select('*')
      .or(`parrain_code.eq.${code},parrain_id.eq.${code}`);

    if (refData && Array.isArray(refData)) {
      for (const r of refData) {
        visitedIds.add(r.filleul_id);
        const isBonus = r.status === 'paid' || r.reward_given === true;
        results.push({
          id: r.filleul_id,
          nom: r.filleul_nom || 'Commerçante',
          nom_boutique: r.filleul_nom || 'Boutique',
          telephone: '',
          created_at: r.created_at,
          plan: r.filleul_plan || 'essai',
          statutText: isBonus ? 'Payé 1 AN (Bonus +60j donné ✅)' : 'Essai',
          isBonusAwarded: isBonus,
        });
      }
    }
  } catch (e) {}

  // 2. Chercher dans la table centrale "boutiques"
  try {
    const { data: btqs } = await supabase
      .from('boutiques')
      .select('*')
      .or(`referred_by_code.eq.${code},referred_by.eq.${code}`);

    if (btqs && Array.isArray(btqs)) {
      for (const b of btqs) {
        if (!visitedIds.has(b.id)) {
          visitedIds.add(b.id);
          results.push(classifyFilleul(b));
        }
      }
    }
  } catch (e) {}

  // 3. Compléter avec "patrons"
  try {
    const { data: patrons } = await supabase
      .from('patrons')
      .select('*')
      .eq('referred_by', code);

    if (patrons && Array.isArray(patrons)) {
      for (const p of patrons) {
        if (!visitedIds.has(p.id)) {
          visitedIds.add(p.id);
          results.push(classifyFilleul(p));
        }
      }
    }
  } catch (e) {}

  return results;
}

function classifyFilleul(p: any): FilleulInfo {
  const plan = (p.plan || p.forfait || 'essai').toLowerCase();
  const amount = Number(p.last_payment_amount) || Number(p.prix) || 0;
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
    nom: p.proprietaire || p.nom || 'Commerçante',
    nom_boutique: p.nom_boutique || p.nom_affichage || 'Boutique',
    telephone: p.telephone || p.phone_full || '',
    created_at: p.created_at,
    plan,
    statutText,
    isBonusAwarded: statutText.startsWith('Payé 1 AN'),
  };
}
