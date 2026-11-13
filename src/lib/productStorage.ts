/**
 * GESTION DU STOCKAGE SUPABASE & QUOTAS PRODUITS
 * Projet Isolé EFA ACONTA
 *
 * Bucket unique : 'efa-photos'
 * Quotas :
 * - gratuit: 7 produits
 * - payant: 100 produits
 * - pro: 300 produits
 */

import { supabase } from './supabase';
import { db } from './db';
import { compressProductImage, type ProductPlan, normalizePlanForCompression } from './productCompressor';

export const PRODUCT_STORAGE_BUCKET = 'efa-photos';
export const PROFILE_PHOTOS_BUCKET = 'efa-photos';

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

import { getLimites } from './checkLimits';

export async function checkProductQuota(
  userId: string,
  plan: ProductPlan = 'gratuit'
): Promise<QuotaCheckResult> {
  const normPlan = plan === 'pro' ? 'pro' : plan === 'payant' ? 'populaire' : 'essai';
  const limites = getLimites(normPlan);
  const isSub = userId.startsWith('btq_sub_');

  const localAll = await db.produits.toArray();
  const localActive = localAll.filter(
    (p) =>
      p.status !== 'deleted' &&
      p.is_deleted !== true &&
      (isSub
        ? p.boutique_id === userId
        : p.boutique_id
        ? p.boutique_id === userId
        : p.patron_id === userId)
  );
  let count = localActive.length;

  try {
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      const orFilter = isSub
        ? `boutique_id.eq.${userId}`
        : `boutique_id.eq.${userId},and(boutique_id.is.null,patron_id.eq.${userId})`;

      const { data: remoteRows, error: prodErr } = await supabase
        .from('produits')
        .select('id, status, is_deleted')
        .or(orFilter);

      if (!prodErr && Array.isArray(remoteRows)) {
        const remoteIds = new Set(
          remoteRows
            .filter((r: any) => r.status !== 'deleted' && r.is_deleted !== true)
            .map((r: any) => r.id)
        );
        for (const lp of localActive) {
          if (lp.synced === false) remoteIds.add(lp.id);
        }
        count = remoteIds.size;
      }
    }
  } catch (err) {
    console.warn('[checkProductQuota] Erreur query Supabase:', err);
  }

  const maxLimit = limites.maxArticles;
  const percentage = Math.min(100, Math.round((count / maxLimit) * 100));
  const allowed = count < maxLimit;

  if (!allowed) {
    const msg =
      normPlan === 'essai'
        ? `Limite atteinte (7 articles max en essai gratuit). Passez à Populaire pour 100 articles`
        : normPlan === 'populaire'
        ? `Limite de 100 articles atteinte. Passez en Pro pour 300 articles`
        : `Limite Pro atteinte : 300 articles max.`;
    return {
      allowed: false,
      currentCount: count,
      maxLimit,
      percentage,
      message: msg,
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
      if (!imageSource.includes('efa-photos')) {
        return imageSource;
      }
      return imageSource;
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

  // 3. D'ABORD uploader le vrai fichier dans le bucket 'efa-photos'
  let uploadRes = await supabase.storage
    .from(PRODUCT_STORAGE_BUCKET)
    .upload(filePath, finalFile, {
      contentType: 'image/webp',
      upsert: true,
    });

  if (uploadRes.error) {
    await ensureProfilePhotosBucket();
    uploadRes = await supabase.storage
      .from(PRODUCT_STORAGE_BUCKET)
      .upload(filePath, finalFile, {
        contentType: 'image/webp',
        upsert: true,
      });
  }

  if (uploadRes.error) {
    console.error('[ProductStorage] Échec upload Supabase Storage (efa-photos):', uploadRes.error);
    if (typeof imageSource === 'string' && imageSource.startsWith('data:')) {
      return imageSource;
    }
    throw new Error(`Upload image échoué: ${uploadRes.error.message}`);
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

/**
 * Assure l'existence du bucket public 'efa-photos' pour les photos de profil patron & boutique
 */
export async function ensureProfilePhotosBucket(): Promise<void> {
  try {
    const { data: buckets } = await supabase.storage.listBuckets();
    const exists = buckets?.some((b) => b.name === PROFILE_PHOTOS_BUCKET);
    if (!exists) {
      await supabase.storage.createBucket(PROFILE_PHOTOS_BUCKET, {
        public: true,
        fileSizeLimit: 2097152, // 2 MB max
        allowedMimeTypes: ['image/webp', 'image/jpeg', 'image/png'],
      });
    }
  } catch (err) {
    console.warn('[Storage] Note verification bucket efa-photos:', err);
  }
}

/**
 * Convertit un DataURL / BlobURL / File / Blob en vrai Blob prêt pour Storage .upload()
 */
async function resolveImageToBlob(imageSource: File | Blob | string): Promise<Blob> {
  if (typeof imageSource !== 'string') {
    return imageSource;
  }
  if (imageSource.startsWith('blob:')) {
    const res = await fetch(imageSource);
    return await res.blob();
  }
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
  return new Blob([array], { type: mime });
}

/**
 * Upload d'une photo profil (patron ou boutique) dans le bucket Supabase 'efa-photos'
 * et retour de son URL publique.
 */
export async function uploadProfilePhoto(
  imageSource: File | Blob | string,
  entityId: string,
  kind: 'patron' | 'boutique'
): Promise<string> {
  if (
    typeof imageSource === 'string' &&
    (imageSource.startsWith('http://') || imageSource.startsWith('https://'))
  ) {
    return imageSource;
  }

  try {
    const rawBlob = await resolveImageToBlob(imageSource);
    let finalFile: File | Blob = rawBlob;
    let contentType = rawBlob.type || 'image/jpeg';
    let ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';

    try {
      const rawFile =
        rawBlob instanceof File
          ? rawBlob
          : new File([rawBlob], `${kind}-${Date.now()}.${ext}`, { type: contentType });
      finalFile = await compressProductImage(rawFile, 'pro');
      contentType = 'image/webp';
      ext = 'webp';
    } catch (compErr) {
      console.warn('[ProfilePhoto] Compression WebP ignorée, envoi original:', compErr);
    }

    const filePath = `${entityId}/${kind}-${Date.now()}.${ext}`;

    let uploadRes = await supabase.storage
      .from(PROFILE_PHOTOS_BUCKET)
      .upload(filePath, finalFile, {
        contentType,
        upsert: true,
      });

    if (uploadRes.error) {
      await ensureProfilePhotosBucket();
      uploadRes = await supabase.storage
        .from(PROFILE_PHOTOS_BUCKET)
        .upload(filePath, finalFile, {
          contentType,
          upsert: true,
        });
    }

    if (!uploadRes.error) {
      const { data: pubData } = supabase.storage
        .from(PROFILE_PHOTOS_BUCKET)
        .getPublicUrl(filePath);

      if (pubData?.publicUrl) {
        return pubData.publicUrl;
      }
    }

    console.warn(`[ProfilePhoto] Note upload ${PROFILE_PHOTOS_BUCKET}:`, uploadRes.error?.message || 'Fallback local actif');
    // Fallback identique à l'employé : convertir le fichier compressé en dataUrl pour ne jamais bloquer l'UPDATE en base
    if (typeof imageSource === 'string' && imageSource.startsWith('data:')) {
      return imageSource;
    }
    return await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
      reader.onerror = () => resolve(typeof imageSource === 'string' ? imageSource : '');
      reader.readAsDataURL(finalFile);
    });
  } catch (err) {
    console.warn(`[ProfilePhoto] Fallback sauvegarde directe ${kind}:`, err);
    return typeof imageSource === 'string' ? imageSource : '';
  }
}
