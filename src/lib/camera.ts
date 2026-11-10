import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { supabase } from './supabase';
import { defineCustomElements } from '@ionic/pwa-elements/loader';

// Initialisation des éléments PWA Capacitor (pwa-camera-modal, pwa-action-sheet)
if (typeof window !== 'undefined') {
  try {
    defineCustomElements(window);
  } catch (e) {
    console.warn('[EFA Camera] defineCustomElements init note:', e);
  }
}

/**
 * ANTI-BUG CRITIQUE EFA ACONTA:
 * Variable isPickingPhoto = false
 * Avant chaque getPhoto: isPickingPhoto = true; localStorage.setItem('efa_draft', JSON.stringify(form)); localStorage.setItem('efa_route', location.hash)
 * Dans ton listener appStateChange et ton timer de verrouillage PIN: if (isPickingPhoto) return; NE PAS afficher LockOverlay.
 * Après getPhoto réussi ou annulé: isPickingPhoto = false; restaure le draft.
 * Affiche la photo direct en preview <img src={dataUrl}> sans upload direct, upload en arrière-plan vers Supabase Storage.
 */

export let isPickingPhoto = false;

export function setIsPickingPhoto(val: boolean): void {
  isPickingPhoto = val;
  try {
    if (val) {
      localStorage.setItem('efa_is_picking_photo', 'true');
    } else {
      localStorage.removeItem('efa_is_picking_photo');
    }
  } catch (e) {
    // ignore
  }
}

export function getIsPickingPhoto(): boolean {
  if (isPickingPhoto) return true;
  try {
    return localStorage.getItem('efa_is_picking_photo') === 'true';
  } catch (e) {
    return false;
  }
}

/**
 * Persistance du formulaire dans localStorage et sessionStorage avant toute capture photo.
 */
export function persistFormState<T extends Record<string, any>>(key: string, data: T): void {
  try {
    const payload = JSON.stringify({
      data,
      timestamp: Date.now(),
    });
    localStorage.setItem(`efa_form_draft_${key}`, payload);
    sessionStorage.setItem(`efa_form_draft_${key}`, payload);
    localStorage.setItem('efa_draft', JSON.stringify(data));
    localStorage.setItem('efa_route', window.location.hash || window.location.pathname);
  } catch (err) {
    console.warn(`[EFA Camera] Impossible de persister le formulaire ${key}:`, err);
  }
}

/**
 * Restaure l'état du formulaire depuis le stockage session/local.
 */
export function restoreFormState<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(`efa_form_draft_${key}`) || localStorage.getItem(`efa_form_draft_${key}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.data && Date.now() - (parsed.timestamp || 0) < 24 * 60 * 60 * 1000) {
        return parsed.data as T;
      }
    }
    const genericRaw = localStorage.getItem('efa_draft');
    if (genericRaw) {
      const genericParsed = JSON.parse(genericRaw);
      if (genericParsed) return genericParsed as T;
    }
  } catch (err) {
    console.warn(`[EFA Camera] Impossible de restaurer le formulaire ${key}:`, err);
  }
  return null;
}

/**
 * Nettoie le brouillon du formulaire une fois validé avec succès.
 */
export function clearFormState(key: string): void {
  try {
    localStorage.removeItem(`efa_form_draft_${key}`);
    sessionStorage.removeItem(`efa_form_draft_${key}`);
    localStorage.removeItem('efa_draft');
    localStorage.removeItem('efa_route');
  } catch (err) {
    console.warn(`[EFA Camera] Impossible de nettoyer le formulaire ${key}:`, err);
  }
}

/**
 * Upload en arrière-plan vers Supabase Storage sans bloquer la preview locale immédiate.
 */
export async function uploadToSupabaseStorageInBackground(
  dataUrl: string,
  prefix = 'photos'
): Promise<string | null> {
  if (!dataUrl || !dataUrl.startsWith('data:')) {
    return dataUrl;
  }
  try {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    const extension = dataUrl.includes('image/png') ? 'png' : 'jpg';
    const filePath = `${prefix}/${Date.now()}_${Math.random().toString(36).substring(7)}.${extension}`;

    const { withTimeout } = await import('./supabaseHelper');
    const uploadPromise = supabase.storage.from('photos').upload(filePath, blob, {
      contentType: blob.type || 'image/jpeg',
      upsert: true,
    });
    const { error }: any = await withTimeout(uploadPromise, 5000);
    if (error) {
      console.warn('[EFA Storage] Note: upload background Supabase (fallback base64 actif):', error.message);
      return null;
    }
    const { data: pubData } = supabase.storage.from('photos').getPublicUrl(filePath);
    return pubData?.publicUrl || null;
  } catch (err) {
    console.warn('[EFA Storage] Background upload timeout/skipped (photo locale OK):', err);
    return null;
  }
}

export interface PickPhotoOptions {
  formKey?: string;
  formData?: Record<string, any>;
  quality?: number;
}

/**
 * Fallback Web transparent au cas où la caméra matérielle ou les composants PWA web échouent
 */
function pickPhotoViaFileInput(mode: 'camera' | 'photos'): Promise<string | null> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve(null);
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (mode === 'camera') {
      input.setAttribute('capture', 'environment');
    }
    input.style.position = 'fixed';
    input.style.opacity = '0';
    input.style.left = '-9999px';
    document.body.appendChild(input);

    let settled = false;
    const finish = (val: string | null) => {
      if (!settled) {
        settled = true;
        if (input.parentNode) {
          input.parentNode.removeChild(input);
        }
        resolve(val);
      }
    };

    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        finish(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => finish(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => finish(null);
      reader.readAsDataURL(file);
    };

    window.addEventListener(
      'focus',
      () => {
        setTimeout(() => {
          if (!settled && (!input.files || input.files.length === 0)) {
            finish(null);
          }
        }, 1500);
      },
      { once: true }
    );

    input.click();
  });
}

/**
 * LOGIQUE BOUTON 1 : 📷 Caméra
 * Camera.getPhoto({ resultType: CameraResultType.DataUrl, source: CameraSource.Camera, saveToGallery:false, quality:80, allowEditing:true, correctOrientation:true })
 */
export async function takePhotoFromCamera(options?: PickPhotoOptions): Promise<string | null> {
  setIsPickingPhoto(true);
  const form = options?.formData || {};
  try {
    localStorage.setItem('efa_draft', JSON.stringify(form));
    localStorage.setItem('efa_route', window.location.hash || window.location.pathname);
  } catch (e) {}

  if (options?.formKey && options?.formData) {
    persistFormState(options.formKey, options.formData);
  }

  let dataUrl: string | null = null;

  try {
    const photo = await Camera.getPhoto({
      resultType: CameraResultType.DataUrl,
      source: CameraSource.Camera,
      saveToGallery: false,
      quality: options?.quality || 80,
      allowEditing: true,
      correctOrientation: true,
    });

    dataUrl = photo.dataUrl || null;
    if (!dataUrl && photo.base64String) {
      dataUrl = `data:image/${photo.format || 'jpeg'};base64,${photo.base64String}`;
    }
  } catch (err: any) {
    const msg = err?.message || String(err);
    const isCancelled = msg.includes('cancelled') || msg.includes('annulé') || msg.includes('User cancelled');
    if (!isCancelled) {
      console.warn('[EFA Camera] Tentative de secours web pour caméra:', msg);
      // Tenter le fallback HTML input capture web
      dataUrl = await pickPhotoViaFileInput('camera');
    }
  }

  try {
    if (dataUrl) {
      try {
        const fileName = `cam_${Date.now()}.jpg`;
        const base64Data = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
        await Filesystem.writeFile({
          path: fileName,
          data: base64Data,
          directory: Directory.Data,
          recursive: true,
        });
      } catch (fsErr) {
        // En mode web/sandbox
      }

      // Upload en arrière-plan vers Supabase Storage sans bloquer
      uploadToSupabaseStorageInBackground(dataUrl).catch(() => {});

      if (options?.formKey && options?.formData) {
        persistFormState(options.formKey, {
          ...options.formData,
          photo_url: dataUrl,
          photoUrl: dataUrl,
        });
      }

      return dataUrl;
    }
    return null;
  } finally {
    setIsPickingPhoto(false);
  }
}

/**
 * LOGIQUE BOUTON 2 : 🖼️ Galerie
 * Camera.getPhoto({ resultType: CameraResultType.DataUrl, source: CameraSource.Photos, quality:80, allowEditing:true })
 */
export async function pickPhotoFromGallery(options?: PickPhotoOptions): Promise<string | null> {
  setIsPickingPhoto(true);
  const form = options?.formData || {};
  try {
    localStorage.setItem('efa_draft', JSON.stringify(form));
    localStorage.setItem('efa_route', window.location.hash || window.location.pathname);
  } catch (e) {}

  if (options?.formKey && options?.formData) {
    persistFormState(options.formKey, options.formData);
  }

  let dataUrl: string | null = null;

  try {
    const photo = await Camera.getPhoto({
      resultType: CameraResultType.DataUrl,
      source: CameraSource.Photos,
      quality: options?.quality || 80,
      allowEditing: true,
    });

    dataUrl = photo.dataUrl || null;
    if (!dataUrl && photo.base64String) {
      dataUrl = `data:image/${photo.format || 'jpeg'};base64,${photo.base64String}`;
    }
  } catch (err: any) {
    const msg = err?.message || String(err);
    const isCancelled = msg.includes('cancelled') || msg.includes('annulé') || msg.includes('User cancelled');
    if (!isCancelled) {
      console.warn('[EFA Camera] Tentative de secours web pour galerie:', msg);
      // Tenter le fallback HTML file picker
      dataUrl = await pickPhotoViaFileInput('photos');
    }
  }

  try {
    if (dataUrl) {
      try {
        const fileName = `gal_${Date.now()}.jpg`;
        const base64Data = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
        await Filesystem.writeFile({
          path: fileName,
          data: base64Data,
          directory: Directory.Data,
          recursive: true,
        });
      } catch (fsErr) {
        // En mode web/sandbox
      }

      // Upload en arrière-plan vers Supabase Storage sans bloquer
      uploadToSupabaseStorageInBackground(dataUrl).catch(() => {});

      if (options?.formKey && options?.formData) {
        persistFormState(options.formKey, {
          ...options.formData,
          photo_url: dataUrl,
          photoUrl: dataUrl,
        });
      }

      return dataUrl;
    }
    return null;
  } finally {
    setIsPickingPhoto(false);
  }
}

/**
 * Fonction polyvalente compatible
 */
export async function pickPhotoInApp(
  options?: PickPhotoOptions & { source?: CameraSource }
): Promise<string | null> {
  if (options?.source === CameraSource.Camera) {
    return takePhotoFromCamera(options);
  }
  if (options?.source === CameraSource.Photos) {
    return pickPhotoFromGallery(options);
  }
  // Par défaut Camera
  return takePhotoFromCamera(options);
}
