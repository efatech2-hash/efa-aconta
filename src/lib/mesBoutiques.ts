import { db } from './db';
import { supabase } from './supabase';
import { queueSyncItem } from './sync';
import { isSubscriptionExpired } from './checkLimits';
import { verifyPin } from './security';
import type { Patron, Produit, Employe } from './types';
import { boutiqueToPatron } from './deviceAuth';

export const PRO_MAX_ARTICLES = 300;
export const PRO_MAX_EMPLOYEES = 10;
export const PRO_MAX_BOUTIQUES = 3;

/**
 * Vérifie si le patron a un abonnement Pro actif (6 mois ou 12 mois)
 */
export function isProActive(patron?: Patron | null): boolean {
  if (!patron) return false;
  if (isSubscriptionExpired(patron)) return false;

  const plan = (patron.subscription_status || patron.current_plan || '').toLowerCase();
  const forfait = (patron.forfait || '').toLowerCase();
  const statut = (patron.statut || '').toLowerCase();

  return (
    patron.isProActive === true ||
    patron.isSubOfPro === true ||
    plan === 'pro' ||
    plan.includes('pro') ||
    forfait.includes('pro') ||
    statut.includes('pro')
  );
}

/**
 * Vérifie si le patron ou l'une de ses boutiques est PRO (50.000 F 6 mois ou 90.000 F 1 an)
 * Règle d'or : si une boutique du patron est PRO, TOUTES ses boutiques sont PRO.
 */
export async function isPatronGloballyPro(patron?: Patron | null): Promise<boolean> {
  if (!patron) return false;
  if (isProActive(patron)) return true;

  try {
    const mainStoreId = getMainStoreId(patron);
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      const orFilter = `id.eq.${mainStoreId},patron_id.eq.${mainStoreId}${patron.telephone ? `,telephone.eq.${patron.telephone}` : ''}`;
      const { data: btqs } = await supabase
        .from('boutiques')
        .select('id, plan, status, last_payment_amount')
        .or(orFilter);

      if (btqs && btqs.length > 0) {
        const found = btqs.some((b) => {
          const p = (b.plan || '').toLowerCase();
          const amt = Number(b.last_payment_amount) || 0;
          return p === 'pro' || p.includes('pro') || amt >= 50000;
        });
        if (found) {
          patron.isProActive = true;
          return true;
        }
      }
    }
  } catch (err) {
    console.warn('[isPatronGloballyPro] Erreur:', err);
  }

  return false;
}

/**
 * Récupère l'ID de la boutique principale propriétaire
 */
export function getMainStoreId(patron: Patron): string {
  return patron.parentId || patron.ownerId || (patron as any).patron_id || patron.id;
}

/**
 * Récupère toutes les boutiques d'un propriétaire (Principale + Sous-boutiques)
 * Synchronisation 100% Supabase
 */
export async function getOwnerStores(ownerOrAnyStoreId: string): Promise<Patron[]> {
  try {
    let all = await db.patrons.toArray();
    // Si l'ID passé est une sous-boutique, on retrouve l'ID de la boutique principale (parent)
    const target = all.find((p) => p.id === ownerOrAnyStoreId);
    const mainStoreId = target?.parentId || target?.ownerId || (target as any)?.patron_id || ownerOrAnyStoreId;

    if (typeof navigator !== 'undefined' && navigator.onLine) {
      try {
        const { data: remoteBtqs } = await supabase
          .from('boutiques')
          .select('*')
          .or(`id.eq.${mainStoreId},patron_id.eq.${mainStoreId}`);

        if (remoteBtqs && remoteBtqs.length > 0) {
          for (const b of remoteBtqs) {
            const mapped = boutiqueToPatron(b);
            const isSub = b.id !== mainStoreId;
            mapped.type = isSub ? 'SUB' : 'MAIN';
            mapped.parentId = isSub ? mainStoreId : null;
            mapped.isProActive = b.plan === 'pro';
            mapped.maxBoutiques = PRO_MAX_BOUTIQUES;
            await db.patrons.put(mapped);
          }
          all = await db.patrons.toArray();
        }
      } catch (e) {
        console.warn('[MesBoutiques] Erreur fetch remote stores:', e);
      }
    }

    const stores = all.filter(
      (p) =>
        p.id === mainStoreId ||
        p.parentId === mainStoreId ||
        p.ownerId === mainStoreId ||
        (p as any).patron_id === mainStoreId
    );

    // Si la principale n'a pas type='MAIN', on le précise
    return stores.map((s) => ({
      ...s,
      type: s.id !== mainStoreId ? ('SUB' as const) : ('MAIN' as const),
      parentId: s.id !== mainStoreId ? mainStoreId : null,
      maxBoutiques: PRO_MAX_BOUTIQUES,
      isProActive: true,
    }));
  } catch (err) {
    console.warn('[MesBoutiques] Erreur lecture stores:', err);
    return [];
  }
}

/**
 * RÈGLE D'OR : Calcule le total d'articles toutes boutiques réunies (<= 300)
 */
export async function getTotalArticleCount(ownerOrMainStoreId: string): Promise<number> {
  try {
    const stores = await getOwnerStores(ownerOrMainStoreId);
    const storeIds = Array.from(new Set([ownerOrMainStoreId, ...stores.map((s) => s.id)]));

    if (typeof navigator !== 'undefined' && navigator.onLine) {
      const orClause = `patron_id.eq.${ownerOrMainStoreId},${storeIds.map((id) => `boutique_id.eq.${id}`).join(',')}`;
      const { count, error } = await supabase
        .from('produits')
        .select('id', { count: 'exact', head: true })
        .or(orClause);

      if (!error && count !== null) {
        return count;
      }
    }

    const allProducts = await db.produits.toArray();
    const count = allProducts.filter((p) =>
      storeIds.includes(p.boutique_id || '') || storeIds.includes(p.patron_id)
    ).length;
    return count;
  } catch (err) {
    console.warn('[MesBoutiques] Erreur count articles:', err);
    return 0;
  }
}

/**
 * Vérifie si on peut ajouter un article pour Pro (<= 300 au total)
 */
export async function canAddArticlePro(
  ownerOrMainStoreId: string
): Promise<{ allowed: boolean; currentTotal: number; max: number; message?: string }> {
  const currentTotal = await getTotalArticleCount(ownerOrMainStoreId);
  const allowed = currentTotal < PRO_MAX_ARTICLES;

  return {
    allowed,
    currentTotal,
    max: PRO_MAX_ARTICLES,
    message: allowed
      ? undefined
      : `Limite Pro atteinte : ${PRO_MAX_ARTICLES} articles pour toutes tes boutiques réunies. Supprime un article ou passe en Premium.`,
  };
}

/**
 * Calcule le total d'employés toutes boutiques réunies (<= 10)
 */
export async function getTotalEmployeeCount(ownerOrMainStoreId: string): Promise<number> {
  try {
    const stores = await getOwnerStores(ownerOrMainStoreId);
    const storeIds = Array.from(new Set([ownerOrMainStoreId, ...stores.map((s) => s.id)]));

    if (typeof navigator !== 'undefined' && navigator.onLine) {
      const orClause = `patron_id.eq.${ownerOrMainStoreId},${storeIds.map((id) => `boutique_id.eq.${id}`).join(',')}`;
      const { count, error } = await supabase
        .from('employes')
        .select('id', { count: 'exact', head: true })
        .or(orClause);

      if (!error && count !== null) {
        return count;
      }
    }

    const allEmployes = await db.employes.toArray();
    const count = allEmployes.filter(
      (e) => (storeIds.includes(e.boutique_id || '') || storeIds.includes(e.patron_id)) && e.status !== 'deleted' && !e.is_deleted
    ).length;
    return count;
  } catch (err) {
    console.warn('[MesBoutiques] Erreur count employes:', err);
    return 0;
  }
}

/**
 * Vérifie si on peut ajouter un employé pour Pro (<= 10 au total)
 */
export async function canAddEmployeePro(
  ownerOrMainStoreId: string
): Promise<{ allowed: boolean; currentTotal: number; max: number; message?: string }> {
  const currentTotal = await getTotalEmployeeCount(ownerOrMainStoreId);
  const allowed = currentTotal < PRO_MAX_EMPLOYEES;

  return {
    allowed,
    currentTotal,
    max: PRO_MAX_EMPLOYEES,
    message: allowed
      ? undefined
      : `Limite Pro atteinte : ${PRO_MAX_EMPLOYEES} employés pour toutes tes boutiques réunies.`,
  };
}

/**
 * CRÉATION D'UNE SOUS-BOUTIQUE (Pro uniquement, max 3)
 */
export async function createSubBoutique({
  mainPatron,
  nom,
}: {
  mainPatron: Patron;
  nom?: string;
}): Promise<{ success: boolean; boutique?: Patron; error?: string }> {
  try {
    const mainStoreId = getMainStoreId(mainPatron);
    const currentStores = await getOwnerStores(mainStoreId);

    if (currentStores.length >= PRO_MAX_BOUTIQUES) {
      return {
        success: false,
        error: `Limite de ${PRO_MAX_BOUTIQUES} boutiques atteinte pour votre forfait Pro.`,
      };
    }

    const nextIndex = currentStores.length + 1;
    const finalNom = (nom || `Boutique ${nextIndex}`).trim();

    const subId =
      'btq_sub_' +
      Date.now().toString(36) +
      '_' +
      Math.random().toString(36).substring(2, 6);

    const nowIso = new Date().toISOString();
    const subSubEnd = mainPatron.subscription_end_date || mainPatron.fin_abonnement || (mainPatron as any).subscription_end || nowIso;
    const isAnnual = Boolean((mainPatron as any).has_paid_annuel);

    // 1. Synchronisation obligatoire avec Supabase table 'boutiques' (Règle d'or: bloque si échec)
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      const { error: insertErr } = await supabase.from('boutiques').insert({
        id: subId,
        nom_boutique: finalNom,
        nom: finalNom,
        proprietaire: mainPatron.nom || 'Patron',
        patron_id: mainStoreId, // Regroupement sous le même patron_id
        email: mainPatron.email || '',
        telephone: mainPatron.telephone || '',
        whatsapp_number: (mainPatron as any).whatsapp_number || mainPatron.telephone || '',
        whatsapp: (mainPatron as any).whatsapp || (mainPatron as any).whatsapp_number || mainPatron.telephone || '',
        pin_code: mainPatron.pin_code || mainPatron.code_pin || '',
        referral_code: (mainPatron as any).referral_code || null,
        referred_by_code: (mainPatron as any).referred_by_code || (mainPatron as any).referred_by || null,
        referred_by: (mainPatron as any).referred_by || (mainPatron as any).referred_by_code || null,
        plan: 'pro', // Hérite strictement du plan PRO
        status: 'active',
        is_active: true,
        has_paid_annuel: isAnnual, // Hérite du statut annuel
        subscription_end_date: subSubEnd, // Même date d'expiration
        subscription_end: subSubEnd, // Même date d'expiration
        last_payment_amount: 0,
        created_at: nowIso,
        updated_at: nowIso,
      });

      if (insertErr) {
        console.error('[MesBoutiques] Erreur Supabase création sous-boutique:', insertErr);
        return {
          success: false,
          error: `Échec création sur Supabase: ${insertErr.message}`,
        };
      }

      try {
        await supabase.from('patrons').insert({
          id: subId,
          nom: mainPatron.nom,
          nom_boutique: finalNom,
          pin_hash: mainPatron.pin_hash,
          pin_code: mainPatron.pin_code || mainPatron.code_pin,
          code_pin: mainPatron.pin_code || mainPatron.code_pin,
          telephone: mainPatron.telephone || '',
          subscription_status: 'pro',
          is_active: true,
          created_at: nowIso,
        } as any);
      } catch {}
    }

    const subPatron: Patron = {
      ...mainPatron,
      id: subId,
      nom_boutique: finalNom,
      parentId: mainStoreId,
      ownerId: mainStoreId,
      type: 'SUB',
      subscription_status: 'pro',
      current_plan: 'pro',
      isProActive: true,
      has_paid_annuel: isAnnual,
      subscription_end_date: subSubEnd,
      abonnement_expire: subSubEnd,
      maxBoutiques: PRO_MAX_BOUTIQUES,
      created_at: nowIso,
    };

    // 2. Sauvegarde locale dans Dexie seulement après succès
    await db.patrons.put(subPatron);
    await queueSyncItem('patrons', 'insert', subId, subPatron);

    return { success: true, boutique: subPatron };
  } catch (err: any) {
    console.error('[MesBoutiques] Erreur createSubBoutique:', err);
    return { success: false, error: err?.message || 'Erreur lors de la création' };
  }
}

/**
 * SUPPRESSION D'UNE SOUS-BOUTIQUE
 */
export async function deleteSubBoutique(
  subStoreId: string,
  mainStoreId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    if (subStoreId === mainStoreId) {
      return { success: false, error: 'Impossible de supprimer la boutique principale.' };
    }

    // Supprimer de Dexie
    await db.patrons.delete(subStoreId);
    await db.produits.where('patron_id').equals(subStoreId).delete();
    await db.employes.where('patron_id').equals(subStoreId).delete();
    await db.ventes.where('patron_id').equals(subStoreId).delete();
    await db.depenses.where('patron_id').equals(subStoreId).delete();
    await db.credits.where('patron_id').equals(subStoreId).delete();

    // Si l'appareil était verrouillé sur cette boutique, on déverrouille
    const devId = typeof window !== 'undefined' ? localStorage.getItem('deviceStoreId') : null;
    if (devId === subStoreId) {
      clearDeviceStore();
    }

    try {
      if (typeof navigator !== 'undefined' && navigator.onLine) {
        await supabase.from('boutiques').delete().eq('id', subStoreId);
        await supabase.from('patrons').delete().eq('id', subStoreId);
      }
    } catch {}

    await queueSyncItem('patrons', 'delete', subStoreId, {});

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Erreur suppression' };
  }
}

/**
 * GESTION DU VERROUILLAGE D'APPAREIL (LocalStorage)
 */
export function getDeviceStoreInfo(): {
  storeId: string | null;
  storeName: string | null;
  isLocked: boolean;
} {
  if (typeof window === 'undefined' && typeof localStorage === 'undefined') {
    return { storeId: null, storeName: null, isLocked: false };
  }
  const storeId = typeof localStorage !== 'undefined' ? localStorage.getItem('deviceStoreId') : null;
  const storeName = typeof localStorage !== 'undefined' ? localStorage.getItem('deviceStoreName') : null;
  return {
    storeId,
    storeName,
    isLocked: Boolean(storeId),
  };
}

export function setDeviceStore(storeId: string, storeName: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem('deviceStoreId', storeId);
  localStorage.setItem('deviceStoreName', storeName);
}

export function clearDeviceStore(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem('deviceStoreId');
  localStorage.removeItem('deviceStoreName');
}

/**
 * Vérification du code PIN patron pour déverrouiller ou changer de boutique
 */
export async function verifyPatronPin(enteredPin: string, patron: Patron): Promise<boolean> {
  const cleanPin = enteredPin.trim();
  const clearPin = (patron.pin_code || patron.code_pin || '').trim();

  if (clearPin && cleanPin === clearPin) return true;
  if (patron.pin_hash) {
    const ok = await verifyPin(cleanPin, patron.pin_hash);
    if (ok) return true;
  }
  return false;
}
