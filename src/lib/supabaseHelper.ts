import { supabase } from './supabase';
import { db } from './db';
import type { Patron } from './types';

export class TimeoutError extends Error {
  constructor(message = 'Pas de connexion (Délai 5s dépassé)') {
    super(message);
    this.name = 'TimeoutError';
  }
}

/**
 * Enveloppe n'importe quelle promesse Supabase avec un timeout strict (par défaut 5 secondes).
 * Essentiel pour les réseaux mobiles à faible débit (Togo / Togocel / Yas).
 */
export function withTimeout<T = any>(
  promise: PromiseLike<T> | Promise<T> | any,
  ms = 5000,
  errorMsg = 'Pas de connexion (Délai 5s dépassé)'
): Promise<T> {
  let timer: any;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new TimeoutError(errorMsg));
    }, ms);
  });

  return Promise.race([Promise.resolve(promise), timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * Exécute une requête Supabase de manière sécurisée avec timeout de 5 secondes,
 * retournant un fallback immédiat en cas d'erreur ou d'expiration.
 */
export async function safeQuery<T = any>(
  queryPromise: any,
  ms = 5000,
  fallback: T | null = null
): Promise<{ data: T | null; error: any; timedOut?: boolean }> {
  try {
    const res = (await withTimeout(queryPromise, ms)) as { data: T | null; error: any };
    return res;
  } catch (err: any) {
    const isTimeout =
      err?.name === 'TimeoutError' ||
      String(err?.message || err).includes('5s') ||
      String(err?.message || err).includes('connexion');
    return { data: fallback, error: err, timedOut: isTimeout };
  }
}

// Caches mémoire de session pour éviter des requêtes répétitives vers patrons / boutiques
const resolvedMainPatronCache = new Map<string, string>();
const verifiedPatronsCache = new Set<string>();

export function clearPatronVerificationCache(patronId?: string) {
  if (patronId) {
    verifiedPatronsCache.delete(patronId);
  } else {
    verifiedPatronsCache.clear();
  }
}

/**
 * Retourne de manière synchrone l'ID du patron principal (boutique 1) si connu.
 */
export function getMainPatronIdSync(patronOrId?: Partial<Patron> | string | null): string {
  if (!patronOrId) return '';
  if (typeof patronOrId === 'string') {
    return resolvedMainPatronCache.get(patronOrId) || patronOrId;
  }
  const id = patronOrId.id || '';
  const candidate =
    (patronOrId.parentId && patronOrId.parentId !== id ? patronOrId.parentId : '') ||
    (patronOrId.ownerId && patronOrId.ownerId !== id ? patronOrId.ownerId : '') ||
    (patronOrId.patron_id && patronOrId.patron_id !== id ? patronOrId.patron_id : '') ||
    (id ? resolvedMainPatronCache.get(id) : '') ||
    patronOrId.parentId ||
    patronOrId.ownerId ||
    patronOrId.patron_id ||
    id;
  return String(candidate || '').trim();
}

/**
 * Résout de manière fiable le patron_id principal (Boutique 1) même si on est sur Boutique 2 ou 3 (btq_sub_...).
 */
export async function resolveMainPatronId(
  patronOrId?: Partial<Patron> | string | null
): Promise<string> {
  if (!patronOrId) return '';

  const initialId = typeof patronOrId === 'string' ? patronOrId : (patronOrId.id || '');
  let candidate = getMainPatronIdSync(patronOrId);

  if (candidate && !candidate.startsWith('btq_sub_')) {
    if (initialId) resolvedMainPatronCache.set(initialId, candidate);
    return candidate;
  }

  // Chercher dans Dexie si le record local connaît le parentId / patron_id principal
  if (candidate) {
    try {
      const local = await db.patrons.get(candidate);
      const localMain =
        (local?.parentId && local.parentId !== candidate ? local.parentId : '') ||
        (local?.ownerId && local.ownerId !== candidate ? local.ownerId : '') ||
        ((local as any)?.patron_id && (local as any).patron_id !== candidate ? (local as any).patron_id : '');
      if (localMain && !localMain.startsWith('btq_sub_')) {
        resolvedMainPatronCache.set(candidate, localMain);
        if (initialId) resolvedMainPatronCache.set(initialId, localMain);
        return localMain;
      }
    } catch {}
  }

  // Si toujours une sous-boutique et en ligne, lire boutiques.patron_id dans Supabase
  if (candidate && candidate.startsWith('btq_sub_') && typeof navigator !== 'undefined' && navigator.onLine) {
    try {
      const { data }: any = await withTimeout(
        supabase.from('boutiques').select('patron_id').eq('id', candidate).maybeSingle(),
        3500
      );
      if (data?.patron_id && data.patron_id !== candidate) {
        resolvedMainPatronCache.set(candidate, data.patron_id);
        if (initialId) resolvedMainPatronCache.set(initialId, data.patron_id);
        return data.patron_id;
      }
    } catch {}
  }

  return candidate;
}

/**
 * RÈGLE 2 : Avant d'insérer dans credits, depenses, historique_actions (et ventes/transactions),
 * vérifie que le patron_id existe dans `patrons`. Sinon, fait un `.upsert()` dans `patrons` d'abord
 * pour éviter l'erreur 23503 violates foreign key patrons.
 */
export async function ensurePatronExistsInSupabase(
  patronOrId: Partial<Patron> | string,
  patronHint?: Partial<Patron> | null
): Promise<string> {
  const mainPatronId = await resolveMainPatronId(patronOrId);
  if (!mainPatronId) return '';

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return mainPatronId;
  }

  if (verifiedPatronsCache.has(mainPatronId)) {
    return mainPatronId;
  }

  try {
    // 1. Vérifier si le patron_id existe déjà dans la table `patrons`
    const { data: existing, error: selectErr }: any = await withTimeout(
      supabase.from('patrons').select('id').eq('id', mainPatronId).maybeSingle(),
      4000
    );

    if (!selectErr && existing?.id) {
      verifiedPatronsCache.add(mainPatronId);
      return mainPatronId;
    }

    // 2. Sinon, récupérer les infos du patron principal (Dexie -> boutiques -> patronHint) et upsert dans `patrons`
    let source: any = null;
    try {
      source = await db.patrons.get(mainPatronId);
    } catch {}

    if (!source) {
      try {
        const { data: btqData }: any = await withTimeout(
          supabase.from('boutiques').select('*').eq('id', mainPatronId).maybeSingle(),
          4000
        );
        if (btqData) source = btqData;
      } catch {}
    }

    if (!source) {
      source = patronHint || (typeof patronOrId === 'object' ? patronOrId : null);
    }

    const patronRow: Record<string, any> = {
      id: mainPatronId,
      nom: source?.nom || source?.proprietaire || 'Patron',
      telephone: source?.telephone || '',
      nom_boutique: source?.nom_boutique || 'Ma Boutique',
      pin_hash: source?.pin_hash || '',
      pin_code: source?.pin_code || source?.code_pin || '',
      genre: source?.genre === 'homme' ? 'homme' : 'femme',
      role: 'patron',
      subscription_status: source?.subscription_status || 'trial',
      created_at: source?.created_at || new Date().toISOString(),
    };

    const { error: upsertErr }: any = await withTimeout(
      supabase.from('patrons').upsert(patronRow, { onConflict: 'id' }),
      4000
    );

    if (upsertErr) {
      // Fallback minimal si une colonne optionnelle manquait sur l'instance
      const { error: minErr }: any = await withTimeout(
        supabase.from('patrons').upsert({ id: mainPatronId, nom: patronRow.nom }, { onConflict: 'id' }),
        4000
      );
      if (!minErr) {
        verifiedPatronsCache.add(mainPatronId);
      }
    } else {
      verifiedPatronsCache.add(mainPatronId);
    }
  } catch (err) {
    console.warn('[ensurePatronExistsInSupabase] Note vérification patron:', err);
  }

  return mainPatronId;
}

/**
 * RÈGLE 5 : Colonnes exactes table `credits` dans Supabase :
 * montant_total, montant_paye, reste_a_payer, dernier_paiement (PAS montant, PAS created_at)
 */
export function buildCreditSupabasePayload(input: {
  id: string;
  patron_id: string;
  boutique_id: string;
  client_nom: string;
  montant_total: number;
  montant_paye: number;
  reste_a_payer: number;
  dernier_paiement?: string;
}) {
  return {
    id: input.id,
    patron_id: input.patron_id,
    boutique_id: input.boutique_id,
    client_nom: input.client_nom || 'Sans nom',
    montant_total: Number(input.montant_total) || 0,
    montant_paye: Number(input.montant_paye) || 0,
    reste_a_payer: Number(input.reste_a_payer) || 0,
    dernier_paiement: input.dernier_paiement || new Date().toISOString(),
  };
}

/**
 * RÈGLE 5 : Colonnes exactes table `depenses` dans Supabase :
 * montant, date (PAS created_at)
 */
export function buildDepenseSupabasePayload(input: {
  id: string;
  patron_id: string;
  boutique_id: string;
  type: string;
  montant: number;
  description?: string;
  cree_par?: string;
  date?: string;
}) {
  return {
    id: input.id,
    patron_id: input.patron_id,
    boutique_id: input.boutique_id,
    type: input.type || 'autre',
    montant: Number(input.montant) || 0,
    description: input.description || '',
    cree_par: input.cree_par || 'Patron',
    date: input.date || new Date().toISOString(),
    synced: true,
  };
}

