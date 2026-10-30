/**
 * GESTION DU STOCKAGE SUPABASE & QUOTAS PRODUITS
 * Projet Isolé EFA ACONTA
 *
 * Bucket unique : 'efa-aconta-produits'
 * Quotas :
 * - gratuit: 7 produits
 * - payant: 100 produits
 * - pro: 300 produits
 */

import { supabase } from './supabase';
import { db } from './db';
import { compressProductImage, type ProductPlan, normalizePlanForCompression } from './productCompressor';

export const PRODUCT_STORAGE_BUCKET = 'efa-aconta-produits';

export const PLAN_LIMITS: Record<ProductPlan, number> = {
  gratuit: 7,
  payant: 100,
  pro: 300,
};

export interface QuotaCheckResult {
  allowed: boolean;
  currentCount: number;
  maxLimit: number;
  percentage: number;
  message?: string;
}

/**
 * Vérifie le quota de produits AVANT upload.
 * SELECT COUNT(*) FROM aconta_produits WHERE user_id = current_user_id
 */
export async function checkProductQuota(
  userId: string,
  plan: ProductPlan = 'gratuit'
): Promise<QuotaCheckResult> {
  let count = 0;

  // 1. Vérification distante Supabase aconta_produits
  try {
    const { count: acontaCount, error: acontaErr } = await supabase
      .from('aconta_produits')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    if (!acontaErr && typeof acontaCount === 'number') {
      count = acontaCount;
    } else {
      // Fallback table 'produits'
      const { count: prodCount, error: prodErr } = await supabase
        .from('produits')
        .select('*', { count: 'exact', head: true })
        .eq('patron_id', userId);

      if (!prodErr && typeof prodCount === 'number') {
        count = prodCount;
      } else {
        // Fallback local Dexie
        count = await db.produits.where('patron_id').equals(userId).count();
      }
    }
  } catch (err) {
    // Si hors ligne, vérifier la base locale Dexie
    try {
      count = await db.produits.where('patron_id').equals(userId).count();
    } catch {
      count = 0;
    }
  }

  // Prise en compte du stock local Dexie (Offline-First)
  try {
    const localCount = await db.produits.where('patron_id').equals(userId).count();
    count = Math.max(count, localCount);
  } catch {}

  const maxLimit = PLAN_LIMITS[plan] || 7;
  const percentage = Math.min(100, Math.round((count / maxLimit) * 100));

  if (plan === 'gratuit' && count >= 7) {
    return {
      allowed: false,
      currentCount: count,
      maxLimit: 7,
      percentage,
      message: 'Limite atteinte (7 produits). Passez au plan Payant pour 100 produits',
    };
  }

  if (plan === 'payant' && count >= 100) {
    return {
      allowed: false,
      currentCount: count,
      maxLimit: 100,
      percentage,
      message: 'Limite 100 atteinte. Passez Pro pour 300',
    };
  }

  if (plan === 'pro' && count >= 300) {
    return {
      allowed: false,
      currentCount: count,
      maxLimit: 300,
      percentage,
      message: 'Limite 300 atteinte',
    };
  }

  return {
    allowed: true,
    currentCount: count,
    maxLimit,
    percentage,
  };
}

/**
 * Assure que le bucket 'efa-aconta-produits' existe (1 MB max, webp/jpeg/png)
 */
export async function ensureProductBucket(): Promise<void> {
  try {
    const { data: buckets } = await supabase.storage.listBuckets();
    const exists = buckets?.some((b) => b.name === PRODUCT_STORAGE_BUCKET);
    if (!exists) {
      await supabase.storage.createBucket(PRODUCT_STORAGE_BUCKET, {
        public: true,
        fileSizeLimit: 1048576, // 1 MB max par fichier
        allowedMimeTypes: ['image/webp', 'image/jpeg', 'image/png'],
      });
    }
  } catch (err) {
    // Si non autorisé ou inexistant dans cet environnement, ignorer silencieusement
    console.warn('[Storage] Note bucket check:', err);
  }
}

/**
 * Upload d'une image produit dans Supabase Storage :
 * - Compression obligatoire en WebP selon le plan via compressProductImage()
 * - Upload dans le bucket 'efa-aconta-produits'
 * - Chemin strict : `${user_id}/${produit_id}.webp`
 * - Renvoie l'URL publique de l'image
 */
export async function uploadProductImage(
  imageSource: File | Blob | string,
  userId: string,
  produitId: string,
  plan: ProductPlan = 'gratuit'
): Promise<string> {
  let fileToUpload: File;

  if (typeof imageSource === 'string') {
    if (imageSource.startsWith('data:') || imageSource.startsWith('blob:')) {
      const res = await fetch(imageSource);
      const blob = await res.blob();
      fileToUpload = new File([blob], `${produitId}.jpg`, { type: blob.type || 'image/jpeg' });
    } else {
      // URL externe (ex: unsplash ou pollination), si déjà une URL distante
      return imageSource;
    }
  } else if (imageSource instanceof File) {
    fileToUpload = imageSource;
  } else {
    fileToUpload = new File([imageSource], `${produitId}.jpg`, { type: imageSource.type || 'image/jpeg' });
  }

  // 1. Compression obligatoire en WebP selon le plan
  const compressedWebP = await compressProductImage(fileToUpload, plan);

  // 2. Chemin strict demandé : `${user_id}/${produit_id}.webp`
  const filePath = `${userId}/${produitId}.webp`;

  // 3. Upload vers Supabase Storage bucket 'efa-aconta-produits'
  try {
    const { data, error } = await supabase.storage
      .from(PRODUCT_STORAGE_BUCKET)
      .upload(filePath, compressedWebP, {
        contentType: 'image/webp',
        upsert: true,
      });

    if (error) {
      console.warn('[ProductStorage] Erreur upload Supabase storage, tentative createBucket:', error.message);
      // Tentative de secours création bucket si erreur
      await ensureProductBucket();
      const retry = await supabase.storage
        .from(PRODUCT_STORAGE_BUCKET)
        .upload(filePath, compressedWebP, {
          contentType: 'image/webp',
          upsert: true,
        });
      if (retry.error) {
        console.warn('[ProductStorage] Deuxième tentative échouée:', retry.error.message);
      }
    }

    const { data: pubData } = supabase.storage
      .from(PRODUCT_STORAGE_BUCKET)
      .getPublicUrl(filePath);

    return pubData?.publicUrl || '';
  } catch (uploadErr) {
    console.warn('[ProductStorage] Erreur réseau lors de l\'upload:', uploadErr);
    return '';
  }
}
