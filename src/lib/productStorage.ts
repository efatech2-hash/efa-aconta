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
 * - D'ABORD uploader le vrai fichier avec : supabase.storage.from('efa-aconta-produits').upload(`${boutiqueId}/prod-${Date.now()}.webp`, file)
 * - Si l'upload échoue, afficher l'erreur avec alert() et lever une exception pour ne pas créer le produit
 * - Ne jamais envoyer une string base64 ou une URL blob dans .upload(). Si la photo est en base64, convertir d'abord en vrai Blob / File.
 * - ENSUITE seulement, récupérer le vrai lien avec getPublicUrl(). Ne pas construire l'URL à la main.
 */
export async function uploadProductImage(
  imageSource: File | Blob | string,
  boutiqueId: string,
  produitId?: string,
  plan: ProductPlan = 'gratuit'
): Promise<string> {
  let fileToUpload: File | Blob;

  if (typeof imageSource === 'string') {
    // Si c'est déjà une URL externe HTTP (ex: Unsplash) et pas un blob/data URL
    if (imageSource.startsWith('http://') || imageSource.startsWith('https://')) {
      if (!imageSource.includes('efa-aconta-produits')) {
        return imageSource;
      }
    }

    if (imageSource.startsWith('blob:')) {
      const res = await fetch(imageSource);
      fileToUpload = await res.blob();
    } else {
      // Conversion base64 en vrai Blob
      try {
        let b64 = imageSource;
        let mime = 'image/jpeg';
        if (imageSource.includes(',')) {
          const parts = imageSource.split(',');
          const mimeMatch = parts[0].match(/:(.*?);/);
          if (mimeMatch) mime = mimeMatch[1];
          b64 = parts[1];
        }
        const binary = atob(b64);
        const array = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          array[i] = binary.charCodeAt(i);
        }
        fileToUpload = new Blob([array], { type: mime });
      } catch (err) {
        const res = await fetch(imageSource);
        fileToUpload = await res.blob();
      }
    }
  } else {
    fileToUpload = imageSource;
  }

  // 1. Compression WebP
  let finalFile: File | Blob;
  try {
    const rawFile = fileToUpload instanceof File
      ? fileToUpload
      : new File([fileToUpload], `prod-${Date.now()}.jpg`, { type: fileToUpload.type || 'image/jpeg' });
    finalFile = await compressProductImage(rawFile, plan);
  } catch (compErr) {
    console.warn('[ProductStorage] Compression WebP échouée, utilisation du fichier original:', compErr);
    finalFile = fileToUpload;
  }

  // 2. Chemin strict demandé : `${boutiqueId}/prod-${Date.now()}.webp`
  const filePath = `${boutiqueId}/prod-${Date.now()}.webp`;

  // 3. D'ABORD uploader le vrai fichier dans le Storage
  const { data, error } = await supabase.storage
    .from(PRODUCT_STORAGE_BUCKET)
    .upload(filePath, finalFile, {
      contentType: 'image/webp',
      upsert: true,
    });

  if (error) {
    console.error('[ProductStorage] Échec upload Supabase Storage:', error);
    alert(`Erreur upload photo : ${error.message || 'Impossible d\'enregistrer l\'image'}`);
    throw new Error(`Upload image échoué: ${error.message}`);
  }

  // 4. ENSUITE seulement, récupérer le vrai lien avec getPublicUrl()
  const { data: pubData } = supabase.storage
    .from(PRODUCT_STORAGE_BUCKET)
    .getPublicUrl(filePath);

  if (!pubData?.publicUrl) {
    alert("Erreur: Impossible de récupérer le lien public de l'image");
    throw new Error("Lien public de l'image introuvable");
  }

  return pubData.publicUrl;
}
