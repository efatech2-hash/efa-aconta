import { db } from './db';
import { supabase } from './supabase';
import {
  withTimeout,
  ensurePatronExistsInSupabase,
  clearPatronVerificationCache,
  buildCreditSupabasePayload,
  buildDepenseSupabasePayload,
} from './supabaseHelper';

// Map pour compter le nombre d'échecs par enregistrement (anti-blocage)
const itemFailCounts = new Map<string, number>();

export async function queueSyncItem(
  tableName: string,
  action: 'insert' | 'update' | 'delete',
  recordId: string,
  data: any
) {
  try {
    // Déduplication dès l'ajout : si déjà dans la file avec le même id, mettre à jour
    const existing = await db.syncQueue
      .filter((q) => q.table_name === tableName && q.record_id === recordId)
      .first();

    if (existing && existing.id) {
      await db.syncQueue.update(existing.id, {
        action,
        data,
        created_at: new Date().toISOString(),
      });
    } else {
      await db.syncQueue.add({
        table_name: tableName,
        action,
        record_id: recordId,
        data,
        created_at: new Date().toISOString(),
      });
    }
  } catch (err) {
    console.error('Erreur ajout syncQueue:', err);
  }
}

/**
 * Vide complètement la file de synchronisation bloquée
 */
export async function clearSyncQueue(): Promise<number> {
  try {
    const count = await db.syncQueue.count();
    await db.syncQueue.clear();
    itemFailCounts.clear();
    console.log(`[Sync] File sync vidée (${count} éléments supprimés)`);
    return count;
  } catch (err) {
    console.error('[Sync] Erreur vidage syncQueue:', err);
    return 0;
  }
}

// Exposer globalement pour déblocage rapide dans la console
if (typeof window !== 'undefined') {
  (window as any).clearSyncQueue = clearSyncQueue;
}

function isConflictError(resOrErr: any): boolean {
  if (!resOrErr) return false;
  const err = resOrErr.error || resOrErr;
  const status = resOrErr.status || err?.status;
  const code = err?.code;
  const msg = typeof err?.message === 'string' ? err.message.toLowerCase() : '';
  const details = typeof err?.details === 'string' ? err.details.toLowerCase() : '';

  return (
    status === 409 ||
    code === '23505' ||
    msg.includes('409') ||
    msg.includes('duplicate key') ||
    msg.includes('already exists') ||
    msg.includes('conflict') ||
    details.includes('already exists') ||
    details.includes('duplicate key')
  );
}

function isSuccess(res: any): boolean {
  if (!res) return false;
  return !res.error;
}

async function markLocalSynced(tableName: string, recordId: string) {
  try {
    if (tableName === 'transactions' || tableName === 'ventes') {
      await db.ventes.update(recordId, { synced: true }).catch(() => {});
    } else if (tableName === 'credits') {
      await db.credits.update(recordId, { synced: true }).catch(() => {});
    } else if (tableName === 'depenses') {
      await db.depenses.update(recordId, { synced: true }).catch(() => {});
    } else if (tableName === 'produits') {
      await db.produits.update(recordId, { synced: true } as any).catch(() => {});
    } else if (tableName === 'historique_actions') {
      await db.historiqueActions.update(recordId, { synced: true } as any).catch(() => {});
    }
  } catch {}
}

// Guard anti-boucle pour la synchronisation
let isProcessingSync = false;

export async function processSyncQueue(): Promise<{ syncedCount: number; errors: number }> {
  // Guard anti-boucle
  if (isProcessingSync) {
    return { syncedCount: 0, errors: 0 };
  }

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { syncedCount: 0, errors: 0 };
  }

  isProcessingSync = true;

  try {
    const allItems = await db.syncQueue.toArray();
    if (allItems.length === 0) {
      return { syncedCount: 0, errors: 0 };
    }

    // 1. Déduplication de la file avant envoi : 1 seul envoi par table_name + record_id
    const seenMap = new Map<string, any>();
    const toDeleteIds: number[] = [];

    for (const item of allItems) {
      const key = `${item.table_name}:${item.record_id}`;
      if (seenMap.has(key)) {
        // Enlever le doublon plus ancien
        if (item.id) toDeleteIds.push(item.id);
      } else {
        seenMap.set(key, item);
      }
    }

    // Nettoyer les doublons accumulés dans IndexedDB
    if (toDeleteIds.length > 0) {
      for (const id of toDeleteIds) {
        await db.syncQueue.delete(id).catch(() => {});
      }
    }

    const uniqueItems = Array.from(seenMap.values()).slice(0, 20);

    let syncedCount = 0;
    let errors = 0;

    for (const item of uniqueItems) {
      const itemKey = `${item.table_name}:${item.record_id}`;
      const previousFails = itemFailCounts.get(itemKey) || 0;

      // Règle : si un item a échoué 2 fois (notamment avec 409), le retirer de la file et marquer synchronisé
      if (previousFails >= 2) {
        console.warn(`[Sync Abandon 2 Échecs] Retrait de la file pour éviter blocage:`, item.table_name, item.record_id);
        if (item.id) await db.syncQueue.delete(item.id).catch(() => {});
        await markLocalSynced(item.table_name, item.record_id);
        itemFailCounts.delete(itemKey);
        syncedCount++;
        continue;
      }

      try {
        // RÈGLE 2 : Avant d'insérer dans credits, depenses, historique_actions, ventes, transactions,
        // vérifier que le patron_id existe dans `patrons` (sinon upsert dans `patrons` d'abord).
        let payloadData = item.data ? { ...item.data } : {};
        const tablesNeedingPatron = new Set([
          'credits',
          'depenses',
          'historique_actions',
          'ventes',
          'transactions',
        ]);

        if (item.action !== 'delete' && tablesNeedingPatron.has(item.table_name)) {
          const rawPatronOrBoutique = payloadData.patron_id || payloadData.boutique_id;
          if (rawPatronOrBoutique) {
            const resolvedMainPatronId = await ensurePatronExistsInSupabase(rawPatronOrBoutique);
            if (resolvedMainPatronId) {
              payloadData.patron_id = resolvedMainPatronId;
            }
          }
          if (!payloadData.boutique_id && payloadData.patron_id) {
            payloadData.boutique_id = payloadData.patron_id;
          }

          // RÈGLE 5 : Respect strict des vrais noms de colonnes par table
          if (item.table_name === 'credits') {
            const totalVal = Number(payloadData.montant_total ?? payloadData.montant_initial ?? payloadData.reste_a_payer) || 0;
            const resteVal = Number(payloadData.reste_a_payer) || 0;
            const payeVal = Number(payloadData.montant_paye ?? Math.max(0, totalVal - resteVal)) || 0;
            payloadData = buildCreditSupabasePayload({
              id: payloadData.id || item.record_id,
              patron_id: payloadData.patron_id || payloadData.boutique_id || '',
              boutique_id: payloadData.boutique_id || payloadData.patron_id || '',
              client_nom: payloadData.client_nom || 'Sans nom',
              montant_total: totalVal,
              montant_paye: payeVal,
              reste_a_payer: resteVal,
              dernier_paiement: payloadData.dernier_paiement,
            });
          } else if (item.table_name === 'depenses') {
            payloadData = buildDepenseSupabasePayload({
              id: payloadData.id || item.record_id,
              patron_id: payloadData.patron_id || payloadData.boutique_id || '',
              boutique_id: payloadData.boutique_id || payloadData.patron_id || '',
              type: payloadData.type || 'autre',
              montant: Number(payloadData.montant) || 0,
              description: payloadData.description || '',
              cree_par: payloadData.cree_par || 'Patron',
              date: payloadData.date,
            });
          } else if (item.table_name === 'historique_actions') {
            payloadData = {
              id: payloadData.id || item.record_id,
              user_id: payloadData.user_id || payloadData.patron_id,
              patron_id: payloadData.patron_id || payloadData.boutique_id || '',
              boutique_id: payloadData.boutique_id || payloadData.patron_id || '',
              employe_id: payloadData.employe_id ?? null,
              employe_nom: payloadData.employe_nom ?? null,
              action_type: payloadData.action_type || 'vente',
              description: payloadData.description || '',
              montant: payloadData.montant ?? null,
              created_at: payloadData.created_at || new Date().toISOString(),
            };
          }
        }

        const table = supabase.from(item.table_name);
        let queryPromise: any;

        if (item.action === 'insert' || (item.action === 'update' && item.table_name === 'credits')) {
          // RÈGLE 4 : Toujours .upsert(data, { onConflict: 'id' })
          queryPromise = table.upsert(payloadData, { onConflict: 'id' });
        } else if (item.action === 'update') {
          queryPromise = table.update(payloadData).eq('id', item.record_id);
        } else if (item.action === 'delete') {
          let delQuery = table.delete().eq('id', item.record_id);
          if (payloadData?.boutique_id && (item.table_name === 'credits' || item.table_name === 'ventes' || item.table_name === 'depenses')) {
            delQuery = delQuery.eq('boutique_id', payloadData.boutique_id);
          }
          queryPromise = delQuery;
        } else {
          if (item.id) await db.syncQueue.delete(item.id);
          continue;
        }

        const res: any = await withTimeout(queryPromise, 5000);

        // Vérification de conflit 409 ou doublon
        if (isConflictError(res)) {
          // Log explicite pour debug
          console.log('[Sync 409 Déjà présent]', item.table_name, item.record_id);
          // Si 409 / code 23505 : la ligne existe déjà en base, tenter update ou ignorer le doublon
          if (item.action === 'insert' && payloadData) {
            try {
              await withTimeout(table.update(payloadData).eq('id', item.record_id), 3000);
            } catch {}
          }
          // Retirer l'item de la file et marquer localement comme synchronisé
          if (item.id) await db.syncQueue.delete(item.id).catch(() => {});
          await markLocalSynced(item.table_name, item.record_id);
          itemFailCounts.delete(itemKey);
          syncedCount++;
        } else if (isSuccess(res)) {
          if (item.id) await db.syncQueue.delete(item.id).catch(() => {});
          await markLocalSynced(item.table_name, item.record_id);
          itemFailCounts.delete(itemKey);
          syncedCount++;
        } else {
          // Si erreur FK 23503, invalider le cache de vérification patron pour la prochaine tentative
          if (res?.error?.code === '23503' && payloadData?.patron_id) {
            clearPatronVerificationCache(payloadData.patron_id);
          }
          // Échec réel
          const fails = previousFails + 1;
          itemFailCounts.set(itemKey, fails);
          errors++;
          console.warn(`[Sync] Échec (${fails}/2) sur ${item.table_name} [${item.record_id}]:`, res?.error);

          if (fails >= 2) {
            console.warn(`[Sync Max Tentatives] Retrait après 2 échecs:`, item.table_name, item.record_id);
            if (item.id) await db.syncQueue.delete(item.id).catch(() => {});
            await markLocalSynced(item.table_name, item.record_id);
            itemFailCounts.delete(itemKey);
          }
        }
      } catch (itemErr: any) {
        if (isConflictError(itemErr)) {
          console.log('[Sync 409 Déjà présent]', item.table_name, item.record_id);
          if (item.id) await db.syncQueue.delete(item.id).catch(() => {});
          await markLocalSynced(item.table_name, item.record_id);
          itemFailCounts.delete(itemKey);
          syncedCount++;
        } else {
          const fails = previousFails + 1;
          itemFailCounts.set(itemKey, fails);
          errors++;
          console.warn(`[Sync Timeout/Erreur] (${fails}/2) sur ${item.table_name} [${item.record_id}]:`, itemErr?.message || itemErr);

          if (fails >= 2) {
            console.warn(`[Sync Max Tentatives Timeout] Retrait après 2 échecs:`, item.table_name, item.record_id);
            if (item.id) await db.syncQueue.delete(item.id).catch(() => {});
            await markLocalSynced(item.table_name, item.record_id);
            itemFailCounts.delete(itemKey);
          }
          break;
        }
      }
    }

    return { syncedCount, errors };
  } finally {
    isProcessingSync = false;
  }
}
