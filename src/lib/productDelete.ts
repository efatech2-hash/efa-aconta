/**
 * SUPPRESSION PRODUIT SÉCURISÉE & NETTOYAGE STOCKAGE
 * EFA ACONTA - Projet Isolé
 *
 * Règle d'or :
 * 1. Supprimer l'image du bucket Supabase 'efa-aconta-produits' : `${user_id}/${produit_id}.webp`
 * 2. Supprimer l'enregistrement en base (aconta_produits / produits)
 * 3. Supprimer en local dans Dexie db.produits
 */

import { supabase } from './supabase';
import { db } from './db';
import { queueSyncItem } from './sync';
import { logAction } from './historique';

export const PRODUCT_STORAGE_BUCKET = 'efa-aconta-produits';

export interface DeleteProductOptions {
  userId: string; // patron_id ou current_user_id
  produitId: string;
  nomProduit?: string;
  stockQte?: number;
  photoUrl?: string;
}

export interface DeleteProductResult {
  success: boolean;
  storageDeleted: boolean;
  dbDeleted: boolean;
  error?: string;
}

/**
 * Supprime un produit en nettoyant d'abord son fichier image dans Supabase Storage,
 * puis en supprimant l'enregistrement dans la base distante et locale.
 */
export async function deleteProductWithStorageCleanup(
  options: DeleteProductOptions
): Promise<DeleteProductResult> {
  const { userId, produitId, nomProduit, stockQte } = options;
  const storageFilePath = `${userId}/${produitId}.webp`;

  let storageDeleted = false;
  let dbDeleted = false;

  // 1. SUPPRESSION DU FICHIER DANS SUPABASE STORAGE (BUCKET efa-aconta-produits)
  try {
    const { data, error } = await supabase.storage
      .from(PRODUCT_STORAGE_BUCKET)
      .remove([storageFilePath]);

    if (error) {
      console.warn(`[ProductDelete] Note suppression storage '${storageFilePath}':`, error.message);
    } else {
      storageDeleted = true;
      console.log(`[ProductDelete] Fichier image supprimé du bucket : ${storageFilePath}`);
    }
  } catch (storageErr) {
    console.warn('[ProductDelete] Erreur réseau lors de la suppression storage:', storageErr);
  }

  // 2. SUPPRESSION EN BASE SUPABASE
  // Tente aconta_produits en premier, puis produits
  try {
    const { error: acontaErr } = await supabase
      .from('aconta_produits')
      .delete()
      .eq('id', produitId);

    if (!acontaErr) {
      dbDeleted = true;
    } else {
      // Fallback table 'produits'
      const { error: prodErr } = await supabase
        .from('produits')
        .delete()
        .eq('id', produitId);

      if (!prodErr) {
        dbDeleted = true;
      }
    }
  } catch (dbErr) {
    console.warn('[ProductDelete] Erreur réseau suppression Supabase db:', dbErr);
  }

  // 3. SUPPRESSION DANS DEXIE LOCAL & FILE DE SYNCHRONISATION
  try {
    await db.produits.delete(produitId);
    await queueSyncItem('produits', 'delete', produitId, { status: 'deleted' });

    // Enregistrement dans l'historique des actions
    logAction({
      patron_id: userId,
      action_type: 'suppression',
      description: `Suppression définitive article ${nomProduit || produitId} (qté en stock: ${stockQte ?? 0})`,
    }).catch(console.error);

    return {
      success: true,
      storageDeleted,
      dbDeleted,
    };
  } catch (err: any) {
    console.error('[ProductDelete] Erreur suppression locale Dexie:', err);
    return {
      success: false,
      storageDeleted,
      dbDeleted,
      error: err?.message || 'Erreur inconnue lors de la suppression locale',
    };
  }
}
