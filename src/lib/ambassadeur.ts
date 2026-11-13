import { supabase } from './supabase';
import type { ReferralLogRecord } from './types';
import { safeSupabaseWrite, resolveMainPatronId } from './supabaseHelper';

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
  if (p.includes('6mois') || p.includes('prolonge') || p.includes('30j') || amount === 50000 || amount === 1500) {
    return false;
  }
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
 * - Le bonus +60 jours (2 mois) est accordé AU PARRAIN SEUL, JAMAIS au filleul (le filleul paye 11 mois au lieu de 12).
 * - 1 filleul = 1 bonus, 1 seule fois.
 * - Vérifie `parrainage` WHERE `filleul_id = patron_principal` : si déjà validé/récompensé, ne redonne pas.
 * - Jamais pour `btq_sub_...` (boutiques secondaires).
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
    // 0. RÈGLE PARRAINAGE : Uniquement pour le PATRON PRINCIPAL (jamais pour les boutiques secondaires btq_sub_...)
    if (!filleul.id || filleul.id.startsWith('btq_sub_')) {
      return { success: false, reason: 'Les boutiques secondaires ne déclenchent pas de bonus parrainage' };
    }

    const mainFilleulId = await resolveMainPatronId(filleul.id);
    if (!mainFilleulId || mainFilleulId !== filleul.id || mainFilleulId.startsWith('btq_sub_')) {
      return { success: false, reason: 'Le bonus parrainage ne s’applique qu’au patron principal (une seule fois)' };
    }

    // 1. Vérifier si le filleul a déjà donné son bonus
    if (filleul.referral_bonus_given === true) {
      return { success: false, reason: 'Bonus déjà donné pour ce patron filleul' };
    }

    // Vérification préliminaire stricte dans parrainage WHERE filleul_id = mainFilleulId AVANT toute mise à jour
    let existingParrRowId: string | null = null;
    try {
      const { data: existingParrRows } = await supabase
        .from('parrainage')
        .select('id, status, mois_gagnes, date_abo_1an')
        .eq('filleul_id', mainFilleulId);

      if (Array.isArray(existingParrRows) && existingParrRows.length > 0) {
        const alreadyRewardedParr = existingParrRows.some(
          (row: any) =>
            row.status === 'valide' ||
            row.status === 'paid' ||
            Number(row.mois_gagnes) > 0 ||
            Boolean(row.date_abo_1an)
        );
        if (alreadyRewardedParr) {
          return { success: false, reason: 'Bonus déjà donné pour ce patron filleul' };
        }
        existingParrRowId = existingParrRows[0].id;
      }
    } catch (e) {}

    let existingRefRowId: string | null = null;
    try {
      const { data: existingRefRows } = await supabase
        .from('referrals')
        .select('id, status, reward_given')
        .eq('filleul_id', mainFilleulId);

      if (Array.isArray(existingRefRows) && existingRefRows.length > 0) {
        const alreadyRewardedRef = existingRefRows.some(
          (row: any) => row.status === 'paid' || row.reward_given === true
        );
        if (alreadyRewardedRef) {
          return { success: false, reason: 'Bonus déjà donné pour ce patron filleul' };
        }
        existingRefRowId = existingRefRows[0].id;
      }
    } catch (e) {}

    // Récupérer les données à jour du filleul depuis Supabase
    let referredBy: string | null | undefined = filleul.referred_by;
    let currentFilleulBonusGiven: boolean | undefined = filleul.referral_bonus_given;
    let filleulPlan = filleul.plan || filleul.forfait || '';
    let paymentAmount = filleul.last_payment_amount || filleul.prix || 0;

    try {
      const { data: dbBoutique } = await supabase
        .from('boutiques')
        .select('patron_id, referred_by, referred_by_code, referral_bonus_given, plan, last_payment_amount, subscription_end, subscription_end_date')
        .eq('id', mainFilleulId)
        .maybeSingle();

      if (dbBoutique) {
        if (dbBoutique.patron_id && dbBoutique.patron_id !== mainFilleulId) {
          return { success: false, reason: 'Les boutiques secondaires ne déclenchent pas de bonus parrainage' };
        }
        if (!referredBy) referredBy = dbBoutique.referred_by_code || dbBoutique.referred_by;
        if (dbBoutique.referral_bonus_given) currentFilleulBonusGiven = true;
        if (!filleulPlan) filleulPlan = dbBoutique.plan;
        if (!paymentAmount) paymentAmount = Number(dbBoutique.last_payment_amount) || 0;
      }
    } catch (e) {
      console.warn('[Ambassadeur] Erreur lecture boutique Supabase:', e);
    }

    try {
      const { data: dbPatron } = await supabase
        .from('patrons')
        .select('referred_by, referral_bonus_given, plan, forfait, last_payment_amount')
        .eq('id', mainFilleulId)
        .maybeSingle();

      if (dbPatron) {
        if (!referredBy) referredBy = dbPatron.referred_by;
        if (dbPatron.referral_bonus_given) currentFilleulBonusGiven = true;
        if (!filleulPlan) filleulPlan = dbPatron.plan || dbPatron.forfait;
      }
    } catch (e) {}

    if (currentFilleulBonusGiven === true) {
      return { success: false, reason: 'Bonus déjà accordé' };
    }

    // 2. Vérifier si le filleul a un parrain
    if (!referredBy || !referredBy.trim()) {
      return { success: false, reason: 'Ce filleul n’a pas de parrain (aucun code utilisé)' };
    }

    const cleanReferredBy = referredBy.trim().toUpperCase();

    // 3. CONDITION OR : Vérifier si le plan est ANNUEL (1 AN — 11 mois payés au lieu de 12)
    const isAnnual = isAnnualPlan(filleulPlan, paymentAmount, filleul.duration_days);
    if (!isAnnual) {
      return {
        success: false,
        reason: `Plan ${filleulPlan} non éligible - Seul le paiement de 1 AN donne droit au bonus +60 jours au parrain`,
      };
    }

    // 4. Recherche du parrain dans Supabase (boutiques, patrons, profiles)
    let parrain: any = null;
    try {
      const { data: btqParrain } = await supabase
        .from('boutiques')
        .select('*')
        .or(`referral_code.eq.${cleanReferredBy},code_parrainage.eq.${cleanReferredBy}`)
        .limit(1)
        .maybeSingle();
      if (btqParrain) parrain = btqParrain;
    } catch (e) {}

    if (!parrain) {
      try {
        const { data: patronByCode } = await supabase
          .from('patrons')
          .select('*')
          .eq('code_parrainage', cleanReferredBy)
          .maybeSingle();
        if (patronByCode) parrain = patronByCode;
      } catch (e) {}
    }

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

    // Toujours résoudre le patron principal du parrain
    const mainParrainId = await resolveMainPatronId(parrain.id);

    // Empêcher l'auto-parrainage
    if (mainParrainId === mainFilleulId) {
      return { success: false, reason: 'Auto-parrainage interdit' };
    }

    // 5. CALCUL EXTENSION +60 JOURS (2 MOIS) POUR LE PARRAIN SEUL (jamais le filleul)
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

    // 6. METTRE À JOUR SUPABASE (Table centrale referrals + parrainage UNIQUE par filleul_id principal)
    try {
      if (existingRefRowId) {
        await supabase
          .from('referrals')
          .update({
            status: 'paid',
            reward_given: true,
            reward_date: now.toISOString(),
            filleul_plan: filleulPlan,
          })
          .eq('id', existingRefRowId);
      } else {
        await supabase.from('referrals').upsert({
          id: 'ref_' + mainFilleulId,
          parrain_id: mainParrainId,
          filleul_id: mainFilleulId,
          status: 'paid',
          reward_given: true,
          parrain_code: cleanReferredBy,
          filleul_code: (filleul as any).referral_code,
          parrain_nom: parrain.proprietaire || parrain.nom_boutique || parrain.nom || 'Parrain',
          filleul_nom: filleul.nom_boutique || filleul.nom_personne || filleul.nom || 'Filleul',
          filleul_plan: filleulPlan,
          reward_date: now.toISOString(),
          created_at: now.toISOString(),
        }, { onConflict: 'id' });
      }

      // Synchronisation table parrainage : 1 SEULE ligne avec filleul_id = ID DU PATRON PRINCIPAL
      try {
        if (existingParrRowId) {
          await safeSupabaseWrite('parrainage', 'update', {
            parrain_id: mainParrainId,
            filleul_id: mainFilleulId,
            boutique_id: mainFilleulId,
            status: 'valide',
            mois_gagnes: 2,
            date_abo_1an: now.toISOString(),
          }, { column: 'id', value: existingParrRowId });
        } else {
          await safeSupabaseWrite('parrainage', 'upsert', {
            id: 'parr_' + mainFilleulId,
            parrain_id: mainParrainId,
            filleul_id: mainFilleulId,
            boutique_id: mainFilleulId,
            filleul_nom: filleul.nom_boutique || filleul.nom_personne || filleul.nom || 'Filleul',
            lien_code: cleanReferredBy,
            filleul_phone: '',
            status: 'valide',
            mois_gagnes: 2,
            date_abo_1an: now.toISOString(),
            date_inscription: now.toISOString(),
          });
        }
      } catch {}
    } catch (refErr) {
      console.warn('[Ambassadeur] Update referrals table:', refErr);
    }

    // 7. METTRE À JOUR PARRAIN SEUL (+60 JOURS) DANS BOUTIQUES, PROFILES, PATRONS
    try {
      const parrainPlanRaw = (parrain.plan || '').toLowerCase();
      // Si parrain est PRO ou POPULAIRE, il GARDE son plan (ne jamais transformer Populaire en Pro, ni prolonge en Pro)
      const preservedParrainPlan = parrainPlanRaw.includes('populaire') || parrainPlanRaw.includes('16500') || parrainPlanRaw.includes('prolonge')
        ? 'populaire'
        : (parrainPlanRaw.includes('pro') && !parrainPlanRaw.includes('prolonge'))
        ? (parrain.plan || 'pro')
        : parrainPlanRaw || 'essai';

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
        .eq('id', mainParrainId);
    } catch (e) {}

    try {
      await supabase
        .from('profiles')
        .update({
          subscription_end_date: parrainNewEndIso,
        })
        .eq('id', mainParrainId);
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
        .eq('id', mainParrainId);
    } catch (e) {}

    // 8. MARQUER LE FILLEUL COMME AYANT DÉJÀ DÉCLENCHÉ SON BONUS (SANS PROLONGER SA DATE DE FIN !)
    // Le filleul paye 11 mois au lieu de 12 — le bonus +60 jours va au PARRAIN SEUL.
    try {
      await supabase
        .from('boutiques')
        .update({
          has_paid_annuel: true,
          referral_bonus_given: true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', mainFilleulId);
    } catch (e) {}

    try {
      await supabase
        .from('patrons')
        .update({
          referral_bonus_given: true,
          has_paid_annuel: true,
        } as any)
        .eq('id', mainFilleulId);
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

    const rows: CentralReferralRow[] = (!error && Array.isArray(data)) ? [...data] : [];
    const seenIds = new Set(rows.map((r) => r.id));

    try {
      const { data: parrData } = await supabase
        .from('parrainage')
        .select('*')
        .order('date_inscription', { ascending: false });

      if (Array.isArray(parrData)) {
        for (const p of parrData) {
          if (!seenIds.has(p.id)) {
            rows.push({
              id: p.id,
              parrain_id: p.parrain_id,
              filleul_id: p.filleul_id || p.id,
              parrain_code: p.lien_code,
              filleul_nom: p.filleul_nom || 'Filleul',
              status: p.status === 'valide' ? 'paid' : 'pending',
              reward_given: p.status === 'valide',
              created_at: p.date_inscription || new Date().toISOString(),
              reward_date: p.date_abo_1an,
            });
            seenIds.add(p.id);
          }
        }
      }
    } catch {}

    return rows;
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
export async function getFilleulsForParrain(
  referralCode?: string | null,
  parrainId?: string | null
): Promise<FilleulInfo[]> {
  if (!referralCode && !parrainId) return [];
  const code = (referralCode || '').trim().toUpperCase();

  const results: FilleulInfo[] = [];
  const visitedIds = new Set<string>();

  // 1. Chercher dans la table "parrainage" (date_inscription, parrain_id, filleul_id, boutique_id)
  try {
    const cond = [
      parrainId ? `parrain_id.eq.${parrainId}` : null,
      code ? `lien_code.eq.${code}` : null,
    ].filter(Boolean).join(',');

    if (cond) {
      const { data: parrData, error: parrErr } = await supabase
        .from('parrainage')
        .select('*')
        .or(cond);

      if (!parrErr && Array.isArray(parrData)) {
        for (const p of parrData) {
          const fid = p.filleul_id || p.boutique_id || p.id;
          if (!fid || visitedIds.has(fid)) continue;
          // Ignorer anciennes auto-lignes erronées (id === 'parr_' + parrainId)
          if (parrainId && fid === parrainId) continue;
          visitedIds.add(fid);
          const isBonus = p.status === 'valide' || p.status === 'paid';
          results.push({
            id: fid,
            nom: p.filleul_nom || 'Commerçante',
            nom_boutique: p.filleul_nom || 'Boutique',
            telephone: p.filleul_phone || '',
            created_at: p.date_inscription || p.date_parrainage || p.created_at,
            plan: isBonus ? 'pro_annuel' : 'essai',
            statutText: isBonus ? 'Payé 1 AN (Bonus +60j donné ✅)' : 'Essai',
            isBonusAwarded: isBonus,
          });
        }
      }
    }
  } catch (e) {}

  // 2. Chercher dans la table centrale "referrals"
  if (code || parrainId) {
    try {
      const refCond = [
        code ? `parrain_code.eq.${code}` : null,
        parrainId ? `parrain_id.eq.${parrainId}` : null,
        code ? `parrain_id.eq.${code}` : null,
      ].filter(Boolean).join(',');

      const { data: refData, error: refErr } = await supabase
        .from('referrals')
        .select('*')
        .or(refCond);

      if (!refErr && Array.isArray(refData)) {
        for (const r of refData) {
          if (!r.filleul_id || visitedIds.has(r.filleul_id)) continue;
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
  }

  // 3. Chercher dans la table centrale "boutiques"
  if (code) {
    try {
      const { data: btqs, error: btqErr } = await supabase
        .from('boutiques')
        .select('*')
        .or(`referred_by_code.eq.${code},referred_by.eq.${code}`);

      if (!btqErr && Array.isArray(btqs)) {
        for (const b of btqs) {
          if (!visitedIds.has(b.id)) {
            visitedIds.add(b.id);
            results.push(classifyFilleul(b));
          }
        }
      }
    } catch (e) {}
  }

  // 4. Compléter avec "patrons" (referred_by)
  if (code) {
    try {
      const { data: patrons, error: patErr } = await supabase
        .from('patrons')
        .select('*')
        .eq('referred_by', code);

      if (!patErr && Array.isArray(patrons)) {
        for (const p of patrons) {
          if (!visitedIds.has(p.id)) {
            visitedIds.add(p.id);
            results.push(classifyFilleul(p));
          }
        }
      }
    } catch (e) {}
  }

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
