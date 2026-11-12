import { db } from './db';
import { supabase } from './supabase';
import { withTimeout } from './supabaseHelper';

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
        const table = supabase.from(item.table_name);
        let queryPromise: any;

        if (item.action === 'insert') {
          // RÈGLE 1 & 2 : Toujours .upsert(data, { onConflict: 'id' })
          queryPromise = table.upsert(item.data, { onConflict: 'id' });
        } else if (item.action === 'update') {
          queryPromise = table.update(item.data).eq('id', item.record_id);
        } else if (item.action === 'delete') {
          queryPromise = table.delete().eq('id', item.record_id);
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
          if (item.action === 'insert' && item.data) {
            try {
              await withTimeout(table.update(item.data).eq('id', item.record_id), 3000);
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
