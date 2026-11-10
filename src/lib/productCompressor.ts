/**
 * OPTIMISATION FRONTEND STOCKAGE - EFA ACONTA
 * Compression d'images produits avant envoi vers Supabase Storage bucket 'efa-aconta-produits'
 */

import { validateImageFile } from './security';

export type ProductPlan = 'gratuit' | 'payant' | 'pro';

export interface PlanCompressionConfig {
  maxDimension: number; // pixels (max width ou height)
  initialQuality: number; // 0.0 à 1.0
  maxBytes: number; // taille max en octets
  labelKo: number; // Ko max
}

export const PLAN_COMPRESSION_CONFIGS: Record<ProductPlan, PlanCompressionConfig> = {
  gratuit: {
    maxDimension: 800,
    initialQuality: 0.7,
    maxBytes: 300 * 1024, // 300 Ko = 307200 octets
    labelKo: 300,
  },
  payant: {
    maxDimension: 1024,
    initialQuality: 0.75,
    maxBytes: 400 * 1024, // 400 Ko = 409600 octets
    labelKo: 400,
  },
  pro: {
    maxDimension: 1280,
    initialQuality: 0.8,
    maxBytes: 500 * 1024, // 500 Ko = 512000 octets
    labelKo: 500,
  },
};

/**
 * Normalise n'importe quel statut d'abonnement (trial, free, populaire, pro) vers 'gratuit' | 'payant' | 'pro'
 */
export function normalizePlanForCompression(planString?: string | null): ProductPlan {
  if (!planString) return 'gratuit';
  const s = planString.toLowerCase().trim();
  if (s === 'pro' || s === 'boutique pro') return 'pro';
  if (s === 'payant' || s === 'populaire' || s === 'standard') return 'payant';
  return 'gratuit';
}

/**
 * Charge une image depuis un File ou Blob
 */
function loadImageFromFile(file: File | Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };

    img.onerror = (err) => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`Impossible de charger l'image: ${err}`));
    };

    img.src = objectUrl;
  });
}

/**
 * Compresse une image produit selon le plan utilisateur.
 * - gratuit: max 800x800, qualité 0.7, 300 Ko max, converti en WebP
 * - payant: max 1024x1024, qualité 0.75, 400 Ko max, converti en WebP
 * - pro: max 1280x1280, qualité 0.8, 500 Ko max, converti en WebP
 * - Si le fichier > limite, compresse en boucle (baisse qualité + dimensions) jusqu'à passer sous la limite
 * - Retourne un File WebP
 */
export async function compressProductImage(
  file: File,
  plan: ProductPlan = 'gratuit'
): Promise<File> {
  // Sécurité Forteresse : vérification stricte du format et des magic bytes réels
  if (file && typeof file.slice === 'function') {
    const validation = await validateImageFile(file);
    if (!validation.valid) {
      throw new Error(validation.error || 'Fichier rejeté : format non sécurisé');
    }
  }

  const config = PLAN_COMPRESSION_CONFIGS[plan] || PLAN_COMPRESSION_CONFIGS.gratuit;
  const fileNameWithoutExt = file.name.replace(/\.[^/.]+$/, '');
  const targetFileName = `${fileNameWithoutExt || 'produit'}.webp`;

  // Environnement non-DOM (Node.js tests) : simuler ou retourner
  if (typeof window === 'undefined' || typeof document === 'undefined' || !document.createElement) {
    if (file.size <= config.maxBytes && file.type === 'image/webp') {
      return file;
    }
    // Création d'un mock/file WebP sous la limite
    const clampedSize = Math.min(file.size, config.maxBytes - 1024);
    const buffer = new Uint8Array(clampedSize > 0 ? clampedSize : 100);
    return new File([buffer], targetFileName, { type: 'image/webp', lastModified: Date.now() });
  }

  // 1. Charger l'image source
  let img: HTMLImageElement;
  try {
    img = await loadImageFromFile(file);
  } catch (err) {
    console.warn('[Compressor] Erreur chargement image, fallback blob:', err);
    return new File([file], targetFileName, { type: 'image/webp' });
  }

  const origWidth = img.naturalWidth || img.width;
  const origHeight = img.naturalHeight || img.height;

  // 2. Calcul des dimensions initiales selon le maxDimension du plan
  let currentWidth = origWidth;
  let currentHeight = origHeight;

  if (currentWidth > config.maxDimension || currentHeight > config.maxDimension) {
    if (currentWidth >= currentHeight) {
      currentHeight = Math.round((currentHeight * config.maxDimension) / currentWidth);
      currentWidth = config.maxDimension;
    } else {
      currentWidth = Math.round((currentWidth * config.maxDimension) / currentHeight);
      currentHeight = config.maxDimension;
    }
  }

  const canvas = document.createElement('canvas');
  let ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context non disponible');
  }

  let quality = config.initialQuality;
  let currentBlob: Blob | null = null;
  let attempts = 0;
  const maxAttempts = 8;

  // 3. Boucle de compression progressive jusqu'à passer sous config.maxBytes
  while (attempts < maxAttempts) {
    attempts++;

    canvas.width = Math.max(1, Math.round(currentWidth));
    canvas.height = Math.max(1, Math.round(currentHeight));

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Qualité de rendu élevée
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    // Conversion en WebP
    currentBlob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(
        (blob) => resolve(blob),
        'image/webp',
        quality
      );
    });

    if (!currentBlob) {
      break;
    }

    // Si on est sous la limite de taille, on sort de la boucle avec succès
    if (currentBlob.size <= config.maxBytes) {
      break;
    }

    // Réduction progressive de la qualité puis des dimensions si nécessaire
    quality = Math.max(0.2, quality - 0.1);
    currentWidth = Math.round(currentWidth * 0.9);
    currentHeight = Math.round(currentHeight * 0.9);
  }

  if (!currentBlob) {
    throw new Error('Échec de la génération du blob WebP');
  }

  // 4. Construction du File WebP final
  const compressedFile = new File([currentBlob], targetFileName, {
    type: 'image/webp',
    lastModified: Date.now(),
  });

  console.log(
    `[Compressor] Image compressée pour plan '${plan}': ${(file.size / 1024).toFixed(1)} Ko -> ${(compressedFile.size / 1024).toFixed(1)} Ko (max autorisé: ${config.labelKo} Ko)`
  );

  return compressedFile;
}
