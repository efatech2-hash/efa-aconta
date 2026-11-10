import { db } from './db';
import { supabase } from './supabase';
import { withTimeout } from './supabaseHelper';

export async function queueSyncItem(
  tableName: string,
  action: 'insert' | 'update' | 'delete',
  recordId: string,
  data: any
) {
  try {
    await db.syncQueue.add({
      table_name: tableName,
      action,
      record_id: recordId,
      data,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Erreur ajout syncQueue:', err);
  }
}

function isSuccessOrConflict(res: any): boolean {
  if (!res) return false;
  if (!res.error) return true; // 200, 201, 204 = Succès

  const err = res.error;
  const status = res.status || err.status;
  const code = err.code;
  const msg = typeof err.message === 'string' ? err.message.toLowerCase() : '';
  const details = typeof err.details === 'string' ? err.details.toLowerCase() : '';

  // 409 Conflict ou code 23505 (duplicate key) = la ligne est déjà en base, c'est un succès !
  if (
    status === 409 ||
    code === '23505' ||
    msg.includes('409') ||
    msg.includes('duplicate key') ||
    msg.includes('already exists') ||
    msg.includes('conflict') ||
    details.includes('already exists') ||
    details.includes('duplicate key')
  ) {
    return true;
  }

  return false;
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
    // Limite à 20 éléments par passe pour ne jamais saturer la connexion
    const allItems = await db.syncQueue.toArray();
    const queueItems = allItems.slice(0, 20);

    if (queueItems.length === 0) {
      return { syncedCount: 0, errors: 0 };
    }

    let syncedCount = 0;
    let errors = 0;

    for (const item of queueItems) {
      try {
        const table = supabase.from(item.table_name);
        let queryPromise: any;

        if (item.action === 'insert') {
          // RÈGLE 1 : Toujours .upsert(data, { onConflict: 'id' }) au lieu de .insert()
          queryPromise = table.upsert(item.data, { onConflict: 'id' });
        } else if (item.action === 'update') {
          queryPromise = table.update(item.data).eq('id', item.record_id);
        } else if (item.action === 'delete') {
          queryPromise = table.delete().eq('id', item.record_id);
        } else {
          if (item.id) await db.syncQueue.delete(item.id);
          continue;
        }

        // Timeout strict de 5 secondes par requête
        const res: any = await withTimeout(queryPromise, 5000);

        // RÈGLE 2 & 3 : Si 200 OU 409 -> Succès ! Supprimer de la file et marquer localement synced = true
        if (isSuccessOrConflict(res)) {
          if (item.id) {
            await db.syncQueue.delete(item.id);
            syncedCount++;
          }
          if (item.table_name === 'transactions' || item.table_name === 'ventes') {
            await db.ventes.update(item.record_id, { synced: true }).catch(() => {});
          } else if (item.table_name === 'credits') {
            await db.credits.update(item.record_id, { synced: true }).catch(() => {});
          } else if (item.table_name === 'depenses') {
            await db.depenses.update(item.record_id, { synced: true }).catch(() => {});
          } else if (item.table_name === 'produits') {
            await db.produits.update(item.record_id, { synced: true } as any).catch(() => {});
          } else if (item.table_name === 'historique_actions') {
            await db.historiqueActions.update(item.record_id, { synced: true } as any).catch(() => {});
          }
        } else {
          errors++;
          console.warn(`[Sync] Échec non-résolu sur ${item.table_name}:`, res?.error);
        }
      } catch (itemErr) {
        // En cas de timeout ou coupure réseau, on quitte la passe pour retenter plus tard
        errors++;
        console.warn(`[Sync] Timeout ou coupure sur ${item.table_name}:`, itemErr);
        break;
      }
    }

    return { syncedCount, errors };
  } finally {
    isProcessingSync = false;
  }
}
