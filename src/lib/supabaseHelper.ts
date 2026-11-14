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
      code_pin: source?.code_pin || source?.pin_code || '',
      photo_url: source?.photo_url || source?.photo_profil || null,
      photo_profil: source?.photo_profil || source?.photo_url || null,
      photo_devanture: source?.photo_devanture || null,
      adresse: source?.adresse || null,
      abonnement_expire:
        source?.abonnement_expire ||
        source?.subscription_end_date ||
        source?.trial_end_date ||
        new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString(),
      genre: source?.genre === 'homme' ? 'homme' : 'femme',
      role: 'patron',
      subscription_status: source?.subscription_status || 'trial',
      date_inscription: source?.date_inscription || source?.created_at || new Date().toISOString(),
      created_at: source?.created_at || new Date().toISOString(),
    };

    const { error: upsertErr } = await safeSupabaseWrite('patrons', 'upsert', patronRow);

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

/**
 * Exécute un upsert ou update Supabase en retirant automatiquement les éventuelles colonnes
 * absentes du cache schéma (PGRST204 / 42703) sans jamais avaler silencieusement les autres erreurs.
 */
export async function safeSupabaseWrite(
  tableName: string,
  operation: 'upsert' | 'update',
  payload: Record<string, any>,
  matchEq?: { column: string; value: string }
): Promise<{ data: any; error: any }> {
  const cleanPayload: Record<string, any> = { ...payload };
  for (let attempt = 0; attempt < 6; attempt++) {
    const query =
      operation === 'upsert'
        ? supabase.from(tableName).upsert(cleanPayload, { onConflict: 'id' })
        : supabase
            .from(tableName)
            .update(cleanPayload)
            .eq(matchEq?.column || 'id', matchEq?.value || cleanPayload.id);

    const res: any = await withTimeout(query, 5000);
    if (!res?.error) {
      return { data: res?.data ?? null, error: null };
    }

    const code = String(res.error?.code || '');
    const msg = String(res.error?.message || '');
    const isMissingCol =
      code === 'PGRST204' ||
      code === '42703' ||
      msg.includes('schema cache') ||
      msg.includes('column');

    if (!isMissingCol) {
      return { data: null, error: res.error };
    }

    // Extraire le nom de la colonne manquante dans le message Postgres / PostgREST
    const matchPgrst = msg.match(/'([a-zA-Z0-9_]+)'\s+column/);
    const matchPg = msg.match(/column\s+(?:[a-zA-Z0-9_]+\.)?"?([a-zA-Z0-9_]+)"?\s+does not exist/i);
    const badCol = matchPgrst?.[1] || matchPg?.[1];

    if (badCol && badCol in cleanPayload && Object.keys(cleanPayload).length > 1) {
      console.warn(`[safeSupabaseWrite] Colonne absente ignorée sur ${tableName}.${badCol}`);
      delete cleanPayload[badCol];
      continue;
    }

    return { data: null, error: res.error };
  }
  return { data: null, error: new Error(`Trop de tentatives écriture sur ${tableName}`) };
}

/**
 * Calcule le montant réellement payé sur une vente à crédit à déduire de la caisse
 * lors de la suppression de CETTE vente uniquement (jamais le crédit impayé).
 */
export function computeCreditSalePaidAmount(
  vente: { montant_total?: number; reste_a_payer?: number },
  matchedCredit?: { montant_paye?: number; montant_total?: number; montant_initial?: number; reste_a_payer?: number } | null
): number {
  if (matchedCredit) {
    if (typeof matchedCredit.montant_paye === 'number' && !isNaN(matchedCredit.montant_paye)) {
      return Math.max(0, matchedCredit.montant_paye);
    }
    const creditTotal = Number(matchedCredit.montant_total ?? matchedCredit.montant_initial ?? vente.montant_total) || 0;
    const creditReste = Number(matchedCredit.reste_a_payer) || 0;
    return Math.max(0, creditTotal - creditReste);
  }
  const venteReste = Number(vente.reste_a_payer) || 0;
  if (venteReste > 0) {
    return Math.max(0, (Number(vente.montant_total) || 0) - venteReste);
  }
  // Sans trace de crédit ni reste_a_payer > 0 sur une vente à crédit, ne rien retirer en trop par erreur
  return 0;
}

/**
 * RÈGLE 3 PRODUITS :
 * Avant INSERT dans `produits`, vérifie que `patron_id` existe dans `patrons`,
 * sinon utilise/insère le patron actuel. Ne laisse JAMAIS l'erreur 23503 bloquer l'ajout d'un produit.
 * Miroir automatique vers `aconta_produits`.
 */
export async function upsertProduitSafely(
  produitRow: Record<string, any>,
  currentPatron?: Partial<Patron> | null
): Promise<{ error: any; resolvedPatronId: string }> {
  const activeId = currentPatron?.id || produitRow.boutique_id || produitRow.patron_id || '';
  const requestedPatronId = produitRow.patron_id || activeId;

  // 1. Vérifier/garantir que patron_id existe dans `patrons`
  let resolvedPatronId = await ensurePatronExistsInSupabase(requestedPatronId, currentPatron);
  if (!resolvedPatronId && activeId) {
    resolvedPatronId = await ensurePatronExistsInSupabase(activeId, currentPatron);
  }

  // Vérifier directement si resolvedPatronId existe bien en base `patrons`, sinon basculer sur activeId (patron actuel)
  if (typeof navigator !== 'undefined' && navigator.onLine && resolvedPatronId) {
    try {
      const { data: patCheck } = await withTimeout(
        supabase.from('patrons').select('id').eq('id', resolvedPatronId).maybeSingle(),
        3500
      );
      if (!patCheck?.id && activeId && activeId !== resolvedPatronId) {
        resolvedPatronId = await ensurePatronExistsInSupabase(activeId, currentPatron);
      }
    } catch {}
  }

  const finalPatronId = resolvedPatronId || activeId;
  const payload: Record<string, any> = {
    ...produitRow,
    patron_id: finalPatronId,
    boutique_id: produitRow.boutique_id || activeId || finalPatronId,
  };

  let res = await safeSupabaseWrite('produits', 'upsert', payload);

  // 2. Si erreur FK 23503 malgré tout, forcer l'upsert du patron actuel dans `patrons` et réessayer
  if (res.error && String(res.error?.code || '') === '23503') {
    clearPatronVerificationCache(finalPatronId);
    if (activeId) clearPatronVerificationCache(activeId);

    const fallbackPatronId = activeId || finalPatronId;
    await ensurePatronExistsInSupabase(fallbackPatronId, currentPatron);
    await safeSupabaseWrite('patrons', 'upsert', {
      id: fallbackPatronId,
      nom: currentPatron?.nom || 'Patron',
      nom_boutique: currentPatron?.nom_boutique || 'Ma Boutique',
      telephone: currentPatron?.telephone || '',
      code_pin: currentPatron?.code_pin || currentPatron?.pin_code || '',
      pin_code: currentPatron?.pin_code || currentPatron?.code_pin || '',
      abonnement_expire:
        currentPatron?.abonnement_expire ||
        currentPatron?.subscription_end_date ||
        new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString(),
    });

    res = await safeSupabaseWrite('produits', 'upsert', {
      ...payload,
      patron_id: fallbackPatronId,
    });
  }

  // 3. Miroir table `aconta_produits`
  try {
    await safeSupabaseWrite('aconta_produits', 'upsert', {
      id: payload.id,
      user_id: activeId || finalPatronId,
      patron_id: finalPatronId,
      boutique_id: payload.boutique_id,
      nom: payload.nom,
      categorie: payload.categorie || 'Général',
      prix_vente: Number(payload.prix_vente) || 0,
      prix_achat: Number(payload.prix_achat) || 0,
      stock_qte: Number(payload.stock_qte) || 0,
      seuil_alerte: Number(payload.seuil_alerte) ?? 5,
      photo_url: payload.photo_url || '',
      created_at: payload.created_at || new Date().toISOString(),
    });
  } catch {}

  return { error: res.error, resolvedPatronId: finalPatronId };
}

export interface AtomicStockResult {
  success: boolean;
  newStock?: number;
  availableStock?: number;
  error?: string;
  offlineQueued?: boolean;
}

/**
 * Décrémente atomiquement le stock d'un produit lors d'une vente.
 * 1) Utilise en priorité le RPC SQL `decrement_product_stock` (verrouillage atomique Postgres WHERE stock_qte >= qty).
 * 2) En fallback si le RPC n'est pas encore déployé, exécute un Compare-And-Swap optimiste
 *    (.update({ stock_qte: fresh - qty }).eq('id', id).eq('stock_qte', fresh).select('id, stock_qte'))
 *    jusqu'à 4 tentatives pour empêcher deux vendeurs simultanés de vendre le dernier article en double.
 * 3) Scopé strictement à la boutique active (boutique_id).
 */
export async function atomicDecrementProductStock(params: {
  productId: string;
  boutiqueId: string;
  qty: number;
  productName?: string;
  client?: any;
}): Promise<AtomicStockResult> {
  const { productId, boutiqueId, qty, productName } = params;
  const client = params.client || supabase;
  const needed = Math.max(0, Math.floor(Number(qty) || 0));

  if (!productId || needed <= 0) {
    return { success: false, error: 'Quantité de vente invalide.' };
  }

  const label = productName ? `"${productName}"` : 'ce produit';
  const isOnline =
    typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean'
      ? navigator.onLine
      : true;

  if (isOnline && client) {
    // Tentative 1 : RPC atomique Postgres (decrement_product_stock)
    try {
      if (typeof client.rpc === 'function') {
        const rpcRes: any = await withTimeout(
          client.rpc('decrement_product_stock', {
            p_product_id: productId,
            p_boutique_id: boutiqueId,
            p_qty: needed,
          }),
          4500
        );

        if (!rpcRes?.error && rpcRes?.data) {
          const payload = typeof rpcRes.data === 'string' ? JSON.parse(rpcRes.data) : rpcRes.data;
          if (payload?.success === true && typeof payload.new_stock === 'number') {
            try {
              await db.produits.update(productId, { stock_qte: payload.new_stock });
            } catch {}
            return { success: true, newStock: payload.new_stock };
          }
          if (payload?.success === false) {
            const avail = typeof payload.available_stock === 'number' ? payload.available_stock : 0;
            if (typeof payload.available_stock === 'number') {
              try {
                await db.produits.update(productId, { stock_qte: avail });
              } catch {}
            }
            return {
              success: false,
              availableStock: avail,
              error: `Stock insuffisant pour ${label} (${avail} restant${avail > 1 ? 's' : ''}, ${needed} demandé${needed > 1 ? 's' : ''}).`,
            };
          }
        }
      }
    } catch {
      // RPC absent ou timeout -> passage au Compare-And-Swap optimiste
    }

    // Tentative 2 : Compare-And-Swap optimiste multi-tentatives via PostgREST
    const maxAttempts = 4;
    let shouldFallbackOffline = false;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const readRes: any = await withTimeout(
          client
            .from('produits')
            .select('id, stock_qte, boutique_id, patron_id')
            .eq('id', productId)
            .maybeSingle(),
          4000
        );

        if (readRes?.error || !readRes?.data) {
          shouldFallbackOffline = true;
          break;
        }

        const remoteProd = readRes.data;
        const freshStock = Math.max(0, Number(remoteProd.stock_qte) || 0);

        if (freshStock < needed) {
          try {
            await db.produits.update(productId, { stock_qte: freshStock });
          } catch {}
          return {
            success: false,
            availableStock: freshStock,
            error: `Stock insuffisant pour ${label} (${freshStock} restant${freshStock > 1 ? 's' : ''}, ${needed} demandé${needed > 1 ? 's' : ''}).`,
          };
        }

        const targetStock = freshStock - needed;
        let updateQuery = client
          .from('produits')
          .update({ stock_qte: targetStock })
          .eq('id', productId)
          .eq('stock_qte', freshStock);

        if (boutiqueId && remoteProd.boutique_id) {
          updateQuery = updateQuery.eq('boutique_id', boutiqueId);
        }

        const updateRes: any = await withTimeout(updateQuery.select('id, stock_qte'), 4000);

        if (!updateRes?.error && Array.isArray(updateRes?.data) && updateRes.data.length > 0) {
          const confirmedStock = Number(updateRes.data[0]?.stock_qte ?? targetStock);
          // Miroir aconta_produits sans bloquer
          try {
            await withTimeout(
              client.from('aconta_produits').update({ stock_qte: confirmedStock }).eq('id', productId),
              3000
            );
          } catch {}
          try {
            await db.produits.update(productId, { stock_qte: confirmedStock });
          } catch {}
          return { success: true, newStock: confirmedStock };
        }

        // 0 lignes modifiées = un autre vendeur vient de modifier stock_qte en même temps -> on réessaie avec la valeur fraîche
      } catch {
        shouldFallbackOffline = true;
        break;
      }
    }

    if (!shouldFallbackOffline) {
      return {
        success: false,
        error: `Conflit de stock concurrent pour ${label}. Veuillez réessayer.`,
      };
    }
  }

  // Fallback hors-ligne (ou indisponibilité réseau) transactionnel sur la base locale Dexie
  try {
    return await db.transaction('rw', db.produits, async () => {
      const localProd = await db.produits.get(productId);
      const localStock = Math.max(0, Number(localProd?.stock_qte) || 0);
      if (localProd && localStock < needed) {
        return {
          success: false,
          availableStock: localStock,
          error: `Stock insuffisant pour ${label} (${localStock} restant${localStock > 1 ? 's' : ''}).`,
        };
      }
      const newLocalStock = Math.max(0, localStock - needed);
      if (localProd) {
        await db.produits.update(productId, { stock_qte: newLocalStock });
      }
      return { success: true, newStock: newLocalStock, offlineQueued: true };
    });
  } catch (err: any) {
    return { success: false, error: err?.message || 'Erreur lors de la vérification du stock.' };
  }
}

/**
 * Restaure une quantité de stock (rollback si un autre article du panier échoue à la réservation atomique).
 */
export async function restoreProductStock(params: {
  productId: string;
  boutiqueId: string;
  qty: number;
  client?: any;
}): Promise<void> {
  const { productId, boutiqueId, qty } = params;
  const client = params.client || supabase;
  const addQty = Math.max(0, Math.floor(Number(qty) || 0));
  if (!productId || addQty <= 0) return;

  try {
    const localProd = await db.produits.get(productId);
    let restoredStock = (Number(localProd?.stock_qte) || 0) + addQty;

    if (typeof navigator === 'undefined' || navigator.onLine) {
      const { data: remoteProd } = await client
        .from('produits')
        .select('stock_qte, boutique_id')
        .eq('id', productId)
        .maybeSingle();
      if (remoteProd && typeof remoteProd.stock_qte === 'number') {
        restoredStock = remoteProd.stock_qte + addQty;
        let upd = client.from('produits').update({ stock_qte: restoredStock }).eq('id', productId);
        if (boutiqueId && remoteProd.boutique_id) {
          upd = upd.eq('boutique_id', boutiqueId);
        }
        await upd;
        try {
          await client.from('aconta_produits').update({ stock_qte: restoredStock }).eq('id', productId);
        } catch {}
      }
    }

    if (localProd) {
      await db.produits.update(productId, { stock_qte: restoredStock });
    }
  } catch {}
}
