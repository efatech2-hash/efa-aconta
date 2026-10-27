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
    // Limite à 20 éléments par passe pour ne jamais saturer la connexion lente
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
          queryPromise = table.upsert([item.data]);
        } else if (item.action === 'update') {
          queryPromise = table.update(item.data).eq('id', item.record_id);
        } else if (item.action === 'delete') {
          queryPromise = table.delete().eq('id', item.record_id);
        } else {
          continue;
        }

        // Timeout strict de 5 secondes par requête
        const res: any = await withTimeout(queryPromise, 5000);

        if (res && res.error) {
          errors++;
        } else {
          // Succès : marquer l'élément comme synchronisé et supprimer de la file
          if (item.id) {
            await db.syncQueue.delete(item.id);
            syncedCount++;
          }
        }
      } catch (itemErr) {
        // En cas de timeout ou coupure réseau, on incrémente l'erreur et on quitte rapidement
        errors++;
        console.warn(`[Sync] Timeout ou erreur sur ${item.table_name}:`, itemErr);
        break; // Évite de bloquer 20 fois 5 secondes si le réseau est totalement KO
      }
    }

    return { syncedCount, errors };
  } finally {
    isProcessingSync = false;
  }
}
