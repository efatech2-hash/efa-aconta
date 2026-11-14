import { supabase } from './supabase';
import { db } from './db';
import { hashPin, verifyPin } from './security';
import type { Patron } from './types';
import { generateReferralCode } from './ambassadeur';
import { safeSupabaseWrite } from './supabaseHelper';
import { uploadProfilePhoto } from './productStorage';

export interface EfaBoutiqueRecord {
  id: string;
  nom_boutique: string; // slug unique (ex: dodo-shop)
  nom_affichage: string; // nom complet (ex: Dodo Shop)
  nom_patron?: string;
  pin_patron_hash: string;
  pin_code?: string;
  telephone?: string;
  whatsapp_number?: string;
  phone_country?: string;
  phone_number?: string;
  photo_url?: string;
  photo_profil?: string;
  patron_photo_url?: string;
  genre?: 'femme' | 'homme';
  plan: 'essai' | 'populaire' | 'pro';
  date_fin_essai: string;
  referral_code?: string;
  referred_by?: string | null;
  referral_bonus_given?: boolean;
  has_paid_annuel?: boolean;
  referrals_count?: number;
  bonus_days_earned?: number;
  created_at: string;
}

export interface EfaDeviceRecord {
  id: string;
  boutique_id: string;
  device_id: string;
  device_name: string;
  last_seen: string;
  is_active: boolean;
  created_at: string;
}

export const DEVICE_LIMITS: Record<string, number> = {
  essai: 1,
  trial: 1,
  free: 1,
  populaire: 3,
  pro: 5,
};

/**
 * Génère un slug propre pour le nom de boutique (ex: "Boutique d'Aïcha Lomé" -> "boutique-daicha-lome")
 */
export function slugifyBoutiqueName(nom: string): string {
  return nom
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Supprime accents
    .replace(/[^a-z0-9]+/g, '-') // Remplace caractères non-alphanumériques par des tirets
    .replace(/^-+|-+$/g, '') // Enlève tirets au début et à la fin
    || 'boutique-' + Date.now().toString(36);
}

/**
 * Récupère ou génère un ID unique persistant pour cet appareil
 */
export function getDeviceId(): string {
  if (typeof window === 'undefined') return 'server_device';
  let deviceId = localStorage.getItem('efa_device_id');
  if (!deviceId) {
    deviceId = 'dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 9);
    localStorage.setItem('efa_device_id', deviceId);
  }
  return deviceId;
}

/**
 * Détecte un nom d'appareil convivial (ex: "Android (Chrome)", "iPhone", "PC Windows")
 */
export function getDeviceName(): string {
  if (typeof navigator === 'undefined') return 'Appareil Web';
  const ua = navigator.userAgent;

  let os = 'Appareil';
  if (/Android/i.test(ua)) os = 'Android';
  else if (/iPhone/i.test(ua)) os = 'iPhone';
  else if (/iPad/i.test(ua)) os = 'iPad';
  else if (/Macintosh|Mac OS/i.test(ua)) os = 'Mac';
  else if (/Windows/i.test(ua)) os = 'PC Windows';
  else if (/Linux/i.test(ua)) os = 'Linux';

  let browser = '';
  if (/Chrome|CriOS/i.test(ua) && !/Edge|Edg/i.test(ua)) browser = 'Chrome';
  else if (/Safari/i.test(ua) && !/Chrome|CriOS/i.test(ua)) browser = 'Safari';
  else if (/Firefox|FxiOS/i.test(ua)) browser = 'Firefox';
  else if (/Edge|Edg/i.test(ua)) browser = 'Edge';

  return browser ? `${os} (${browser})` : os;
}

/**
 * Récupère l'ID de la boutique active sélectionnée
 * patron.id = ID de la boutique PRINCIPALE (btq_...)
 * boutique active de Boutique 2 = btq_sub_...
 * Donc boutique_id doit être = ID de la boutique active sélectionnée (btq_sub_...), PAS patron.id.
 */
export function getActiveBoutiqueId(patron?: { id?: string } | null): string {
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    const devStoreId = localStorage.getItem('deviceStoreId');
    if (devStoreId && devStoreId.trim()) return devStoreId.trim();
    const curBtqId = localStorage.getItem('currentBoutiqueId');
    if (curBtqId && curBtqId.trim()) return curBtqId.trim();
  }
  return patron?.id || '';
}

/**
 * Récupère l'ID de la boutique courante
 */
export function getCurrentBoutiqueId(): string | null {
  if (typeof window === 'undefined' && typeof localStorage === 'undefined') return null;
  // Si l'appareil est verrouillé sur une boutique spécifique (Pro)
  const deviceStoreId = typeof localStorage !== 'undefined' ? localStorage.getItem('deviceStoreId') : null;
  if (deviceStoreId) return deviceStoreId;
  return typeof localStorage !== 'undefined'
    ? (localStorage.getItem('currentBoutiqueId') || localStorage.getItem('entreprise_id'))
    : null;
}

/**
 * Convertit un enregistrement boutique en objet Patron pour compatibilité complète
 * RÈGLE D'OR : Le vrai PRO est dans boutiques : plan (pro, pro_annuel, populaire) + status = active + subscription_end_date.
 * si plan != trial et status = active, affiche PRO.
 */
export function boutiqueToPatron(b: EfaBoutiqueRecord | any, pinClear?: string): Patron {
  const pin = pinClear || b.pin_code || b.code_pin || '';
  const finAbonnement = (b as any).subscription_end || (b as any).subscription_end_date || (b as any).fin_abonnement || b.date_fin_essai;
  const rawPlan = ((b as any).plan || (b as any).forfait || '').toLowerCase().trim();
  const rawStatus = ((b as any).status || (b as any).statut || '').toLowerCase().trim();
  const amt = Number((b as any).last_payment_amount) || 0;

  const isStatusActive = rawStatus === 'active' || rawStatus === 'actif' || rawStatus === '';
  const isPopulaire =
    rawPlan === 'populaire' ||
    rawPlan.includes('populaire') ||
    rawPlan.includes('16500') ||
    rawPlan.includes('prolonge');
  const isPro =
    !isPopulaire &&
    (rawPlan === 'pro' ||
      (rawPlan.includes('pro') && !rawPlan.includes('prolonge')) ||
      amt >= 50000 ||
      (b as any).isProActive === true);
  const effectiveStatus = isPro
    ? 'pro'
    : isPopulaire
    ? 'populaire'
    : rawPlan === 'essai'
    ? 'trial'
    : rawPlan || 'trial';

  const rawPatronId = (b as any).patron_id;
  const isSub = Boolean(
    (rawPatronId && rawPatronId !== b.id) ||
    (b as any).type === 'SUB' ||
    (typeof b.id === 'string' && b.id.startsWith('btq_sub_'))
  );
  const resolvedParentId = isSub
    ? (rawPatronId && rawPatronId !== b.id ? rawPatronId : ((b as any).parentId || (b as any).ownerId || null))
    : null;
  const resolvedOwnerId = resolvedParentId || b.id;

  return {
    id: b.id,
    nom: (b as any).proprietaire || b.nom_patron || b.nom_affichage || (b as any).nom || 'Patron',
    telephone: (b as any).telephone || (b as any).whatsapp_number || '',
    phone_country: (b as any).phone_country || '+228',
    phone_number: (b as any).phone_number || (b as any).telephone || '',
    phone_full: (b as any).phone_full || (b as any).whatsapp_number || (b as any).telephone || '',
    nom_boutique: b.nom_boutique || b.nom_affichage || (b as any).nom || 'Ma Boutique',
    photo_url: (b as any).patron_photo_url || undefined,
    photo_profil: (b as any).patron_photo_url || undefined,
    pin_code: pin,
    code_pin: pin,
    pin_hash: b.pin_patron_hash || (b as any).pin_hash,
    genre: (b as any).genre === 'homme' ? 'homme' : 'femme',
    role: 'patron',
    parentId: resolvedParentId,
    ownerId: resolvedOwnerId,
    patron_id: resolvedOwnerId,
    type: isSub ? 'SUB' : 'MAIN',
    abonnement_expire: finAbonnement,
    subscription_status: effectiveStatus,
    current_plan: isPro ? 'pro' : effectiveStatus,
    isProActive: isPro,
    trial_start_date: (b as any).date_inscription || b.created_at,
    trial_end_date: finAbonnement,
    subscription_end_date: finAbonnement,
    fin_abonnement: finAbonnement,
    forfait: isPro ? 'pro' : (b as any).forfait || b.plan,
    statut: isStatusActive ? 'ACTIF' : (b as any).statut,
    referral_code: (b as any).code_parrainage || b.referral_code || (b as any).code_parrain || undefined,
    code_parrainage: (b as any).code_parrainage || b.referral_code || (b as any).code_parrain || undefined,
    referred_by: b.referred_by || (b as any).referred_by_code || null,
    referral_bonus_given: (b as any).referral_bonus_given || false,
    has_paid_annuel: (b as any).has_paid_annuel || false,
    referrals_count: (b as any).referrals_count || 0,
    bonus_days_earned: (b as any).bonus_days_earned || 0,
    solde: Number((b as any).solde) || 0,
    auto_logout_after_action: true,
    date_inscription: (b as any).date_inscription || (!isSub ? b.created_at : undefined),
    created_at: b.created_at,
  };
}

/**
 * CRÉER UNE NOUVELLE BOUTIQUE (Zero Gmail / Zero Email)
 */
export async function createBoutique({
  nomBoutique,
  nomPatron,
  pin,
  genre,
  whatsappNumber,
  telephone,
  phoneCountry,
  phoneNumber,
  photoUrl,
  email,
}: {
  nomBoutique: string;
  nomPatron: string;
  pin: string;
  genre?: 'femme' | 'homme';
  whatsappNumber?: string;
  telephone?: string;
  phoneCountry?: string;
  phoneNumber?: string;
  photoUrl?: string;
  email?: string;
}): Promise<{ success: boolean; boutique?: EfaBoutiqueRecord; error?: string }> {
  try {
    const slug = slugifyBoutiqueName(nomBoutique);
    const pinHash = await hashPin(pin);
    const now = new Date();
    const trialEnd = new Date(now.getTime() + 21 * 24 * 60 * 60 * 1000); // 21 jours
    const boutiqueId = 'btq_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);
    const finalGenre = genre === 'homme' ? 'homme' : 'femme';

    // Validation du numéro WhatsApp / téléphone (indicatif + numéro)
    const finalPhoneCountry = (phoneCountry || '+228').trim();
    const finalWhatsapp = (whatsappNumber || telephone || '').trim();
    const finalTelephone = (telephone || whatsappNumber || '').trim();
    const finalPhoneNumber = (phoneNumber || finalTelephone.replace(finalPhoneCountry, '')).replace(/\D/g, '');

    // Capture du parrain depuis l'URL (?ref=CODE) ou hash
    let refBy: string | null = null;
    if (typeof window !== 'undefined') {
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const qRef = urlParams.get('ref');
        if (qRef) refBy = qRef;
        if (!refBy && window.location.hash.includes('ref=')) {
          const hashIdx = window.location.hash.indexOf('?');
          if (hashIdx !== -1) {
            const hashParams = new URLSearchParams(window.location.hash.substring(hashIdx));
            refBy = hashParams.get('ref');
          }
        }
        if (!refBy && (window as any).__efa_ref_code) {
          refBy = (window as any).__efa_ref_code;
        }
        if (!refBy) {
          refBy = localStorage.getItem('efa_aconta_ref');
        }
      } catch (e) {}
    }
    const cleanReferredBy = refBy ? refBy.trim().toUpperCase() : null;
    const referralCode = generateReferralCode();

    const boutiqueRecord: EfaBoutiqueRecord = {
      id: boutiqueId,
      nom_boutique: slug,
      nom_affichage: nomBoutique.trim(),
      nom_patron: nomPatron.trim() || 'Patron',
      pin_patron_hash: pinHash,
      pin_code: pin,
      genre: finalGenre,
      telephone: finalTelephone,
      whatsapp_number: finalWhatsapp,
      phone_country: finalPhoneCountry,
      phone_number: finalPhoneNumber,
      plan: 'essai',
      date_fin_essai: trialEnd.toISOString(),
      referral_code: referralCode,
      referred_by: cleanReferredBy,
      referral_bonus_given: false,
      has_paid_annuel: false,
      referrals_count: 0,
      bonus_days_earned: 0,
      created_at: now.toISOString(),
    };

    const nowIso = now.toISOString();
    const trialEndIso = trialEnd.toISOString();

    console.log('[DeviceAuth CREATE] Inserting new boutique into BOTH boutiques & profiles:', {
      id: boutiqueId,
      nom_boutique: nomBoutique.trim(),
      proprietaire: nomPatron.trim() || 'Patron',
      patron_id: boutiqueId,
      genre: finalGenre,
      telephone: finalTelephone,
      whatsapp_number: finalWhatsapp,
      whatsapp: finalWhatsapp,
      referral_code: referralCode,
      referred_by_code: cleanReferredBy,
      referred_by: cleanReferredBy,
      subscription_end_date: trialEndIso,
      subscription_end: trialEndIso,
    });

    // 1. Enregistrement central OBLIGATOIRE direct dans Supabase table "boutiques"
    // Sauvegarde du genre dans boutiques.genre
    const centralBoutiqueData: Record<string, any> = {
      id: boutiqueId,
      nom_boutique: nomBoutique.trim(),
      nom: nomPatron.trim() || nomBoutique.trim(),
      proprietaire: nomPatron.trim() || 'Patron',
      patron_id: boutiqueId,
      email: email?.trim() || '',
      telephone: finalTelephone,
      whatsapp_number: finalWhatsapp,
      whatsapp: finalWhatsapp,
      genre: finalGenre,
      pin_code: pin,
      referral_code: referralCode,
      code_parrainage: referralCode,
      referred_by_code: cleanReferredBy,
      referred_by: cleanReferredBy,
      plan: 'essai',
      status: 'active',
      is_active: true,
      has_paid_annuel: false,
      subscription_end_date: trialEndIso,
      subscription_end: trialEndIso,
      last_payment_amount: 0,
      solde: 0,
      created_at: nowIso,
      updated_at: nowIso,
    };

    // INSERT OBLIGATOIRE dans Supabase table boutiques (avec fallback colonnes optionnelles)
    const { error: insertErr } = await safeSupabaseWrite('boutiques', 'upsert', centralBoutiqueData);

    if (insertErr) {
      console.error('[DeviceAuth CREATE] ERREUR INSERT BOUTIQUES OBLIGATOIRE:', insertErr);
      return {
        success: false,
        error: `Échec de l'enregistrement dans la base centrale : ${insertErr.message || 'Erreur réseau/Supabase'}. Impossible de créer le compte sans connexion à Supabase.`,
      };
    }

    console.log('[DeviceAuth CREATE] SUCCÈS INSERT OBLIGATOIRE BOUTIQUES:', boutiqueId);

    // 1b. Upload photo patron (méthode identique employé : bucket efa-photos + UPDATE patrons SET photo_profil + relecture)
    let uploadedPatronPhoto: string | undefined = undefined;
    if (photoUrl && photoUrl.trim()) {
      try {
        const rawPhoto = photoUrl.trim();
        uploadedPatronPhoto =
          rawPhoto.startsWith('data:') || rawPhoto.startsWith('blob:')
            ? await uploadProfilePhoto(rawPhoto, boutiqueId, 'patron')
            : rawPhoto;
      } catch (photoErr) {
        console.warn('[DeviceAuth CREATE] Note upload photo patron:', photoErr);
        uploadedPatronPhoto = photoUrl.trim();
      }
    }

    // 1c. Upsert propre de la ligne dans la table "patrons" avec genre, indicatif+numéro, photo_profil, code_parrainage + referred_by
    const cleanPatronRow: Record<string, any> = {
      id: boutiqueId,
      nom: nomPatron.trim() || 'Patron',
      telephone: finalTelephone,
      phone_country: finalPhoneCountry,
      phone_number: finalPhoneNumber,
      phone_full: finalWhatsapp,
      nom_boutique: nomBoutique.trim(),
      pin_hash: pinHash,
      pin_code: pin,
      code_pin: pin,
      photo_profil: uploadedPatronPhoto || null,
      photo_url: uploadedPatronPhoto || null,
      genre: finalGenre,
      role: 'patron',
      code_parrainage: referralCode,
      referral_code: referralCode,
      referred_by: cleanReferredBy,
      abonnement_expire: trialEndIso,
      subscription_status: 'trial',
      trial_start_date: nowIso,
      trial_end_date: trialEndIso,
      subscription_end_date: trialEndIso,
      date_inscription: nowIso,
      created_at: nowIso,
    };

    try {
      const { error: pUpsertErr } = await safeSupabaseWrite('patrons', 'upsert', cleanPatronRow);
      if (pUpsertErr) {
        console.warn('[DeviceAuth CREATE] Note upsert patrons:', pUpsertErr.message || pUpsertErr);
      }

      if (uploadedPatronPhoto) {
        await safeSupabaseWrite(
          'patrons',
          'update',
          {
            photo_profil: uploadedPatronPhoto,
            photo_url: uploadedPatronPhoto,
          },
          { column: 'id', value: boutiqueId }
        );

        try {
          const { data: rereadPat } = await supabase
            .from('patrons')
            .select('photo_profil, photo_url, genre')
            .eq('id', boutiqueId)
            .maybeSingle();
          if (rereadPat) {
            uploadedPatronPhoto = rereadPat.photo_profil || rereadPat.photo_url || uploadedPatronPhoto;
          }
        } catch {}
      }
    } catch (pEx) {
      console.warn('[DeviceAuth CREATE] Exception upsert patrons:', pEx);
    }

    if (uploadedPatronPhoto) {
      boutiqueRecord.patron_photo_url = uploadedPatronPhoto;
      boutiqueRecord.photo_profil = uploadedPatronPhoto;
      boutiqueRecord.photo_url = uploadedPatronPhoto;
    }

    const patronObj = boutiqueToPatron(boutiqueRecord, pin);
    patronObj.photo_url = uploadedPatronPhoto;
    patronObj.photo_profil = uploadedPatronPhoto;
    patronObj.genre = finalGenre;
    patronObj.code_parrainage = referralCode;
    patronObj.referral_code = referralCode;
    patronObj.referred_by = cleanReferredBy;

    // 2. Enregistrement table "profiles" (même id, même referral_code, même subscription_end_date, même whatsapp_number)
    try {
      const profileData: Record<string, any> = {
        id: boutiqueId,
        user_id: boutiqueId,
        nom: nomPatron.trim() || 'Patron',
        nom_boutique: nomBoutique.trim(),
        telephone: finalTelephone,
        whatsapp_number: finalWhatsapp,
        referral_code: referralCode,
        referred_by_code: cleanReferredBy,
        subscription_end_date: trialEndIso,
        created_at: nowIso,
      };
      const { error: profileErr } = await safeSupabaseWrite('profiles', 'upsert', profileData);
      if (profileErr) {
        console.error('[DeviceAuth CREATE] ERREUR INSERT PROFILES:', profileErr);
      }
    } catch (profileErr) {
      console.error('[DeviceAuth CREATE] EXCEPTION PROFILES:', profileErr);
    }

    // 3. Suivi parrainage : 1 SEULE ligne dans "parrainage" (+ "referrals") à l'inscription du filleul
    if (cleanReferredBy) {
      try {
        let parrainId: string | null = null;
        let parrainNom = 'Parrain EFA';

        // Chercher d'abord dans patrons (code_parrainage / referral_code)
        try {
          const { data: pByCode } = await supabase
            .from('patrons')
            .select('id, nom, nom_boutique')
            .eq('code_parrainage', cleanReferredBy)
            .maybeSingle();
          if (pByCode) {
            parrainId = pByCode.id;
            parrainNom = pByCode.nom || pByCode.nom_boutique || 'Parrain EFA';
          }
        } catch {}

        if (!parrainId) {
          try {
            const { data: pByRef } = await supabase
              .from('patrons')
              .select('id, nom, nom_boutique')
              .eq('referral_code', cleanReferredBy)
              .maybeSingle();
            if (pByRef) {
              parrainId = pByRef.id;
              parrainNom = pByRef.nom || pByRef.nom_boutique || 'Parrain EFA';
            }
          } catch {}
        }

        if (!parrainId) {
          try {
            const { data: parrainBtq } = await supabase
              .from('boutiques')
              .select('id, proprietaire, nom_boutique, patron_id')
              .or(`referral_code.eq.${cleanReferredBy},code_parrainage.eq.${cleanReferredBy}`)
              .limit(1)
              .maybeSingle();
            if (parrainBtq) {
              parrainId = parrainBtq.patron_id || parrainBtq.id;
              parrainNom = parrainBtq.proprietaire || parrainBtq.nom_boutique || 'Parrain EFA';
            }
          } catch {}
        }

        const resolvedParrainId = parrainId || cleanReferredBy;
        const singleRefId = 'parr_' + boutiqueId;

        if (resolvedParrainId !== boutiqueId) {
          try {
            const referralEntry = {
              id: singleRefId,
              parrain_id: resolvedParrainId,
              filleul_id: boutiqueId,
              status: 'pending',
              reward_given: false,
              parrain_code: cleanReferredBy,
              filleul_code: referralCode,
              parrain_nom: parrainNom,
              filleul_nom: nomBoutique.trim(),
              filleul_plan: 'essai',
              created_at: nowIso,
            };
            await safeSupabaseWrite('referrals', 'upsert', referralEntry);
          } catch {}

          // INSERT UNIQUE (1 seule ligne par patron filleul principal) dans table `parrainage`
          const { data: existingSignupParr } = await supabase
            .from('parrainage')
            .select('id')
            .eq('filleul_id', boutiqueId)
            .limit(1)
            .maybeSingle();

          if (!existingSignupParr) {
            const parrainageRow = {
              id: singleRefId,
              parrain_id: resolvedParrainId,
              filleul_id: boutiqueId,
              boutique_id: boutiqueId,
              lien_code: cleanReferredBy,
              filleul_nom: nomBoutique.trim(),
              filleul_phone: finalTelephone,
              status: 'attente',
              mois_gagnes: 0,
              date_inscription: nowIso,
            };

            const { error: parrErr } = await safeSupabaseWrite('parrainage', 'upsert', parrainageRow);
            if (parrErr) {
              console.warn('[DeviceAuth CREATE] Note insert parrainage:', parrErr.message || parrErr);
            }
          }
        }
      } catch (refErr) {
        console.warn('[DeviceAuth] Erreur insert parrainage inscription:', refErr);
      }
    }

    // 4. Appareil local & Dexie
    try {
      const currentDevId = getDeviceId();
      const currentDevName = getDeviceName();
      const deviceRecord: EfaDeviceRecord = {
        id: 'dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6),
        boutique_id: boutiqueId,
        device_id: currentDevId,
        device_name: currentDevName,
        last_seen: nowIso,
        is_active: true,
        created_at: nowIso,
      };
      await supabase.from('efa_devices').upsert(deviceRecord);

      await db.appareils.put({
        id: deviceRecord.id,
        patron_id: boutiqueId,
        device_id: currentDevId,
        device_name: currentDevName,
        last_active: nowIso,
        is_active: true,
        created_at: nowIso,
      });
      await db.patrons.put(patronObj);
    } catch (cloudErr) {
      console.warn('[DeviceAuth] Sync miroir cloud reportée:', cloudErr);
    }

    // 3. Variables session pour l'onglet courant
    localStorage.setItem('currentBoutiqueId', boutiqueId);
    localStorage.setItem('currentBoutiqueSlug', slug);
    localStorage.setItem('currentBoutiqueName', nomBoutique.trim());
    localStorage.setItem('entreprise_id', boutiqueId);
    localStorage.setItem('efa_active_user_id', boutiqueId);
    localStorage.setItem('efa_aconta_locked', 'false');

    return { success: true, boutique: boutiqueRecord };
  } catch (err: any) {
    console.error('[DeviceAuth] Erreur création boutique:', err);
    return { success: false, error: err?.message || 'Erreur lors de la création de la boutique' };
  }
}

/**
 * CONNEXION BOUTIQUE EXISTANTE (J'AI DÉJÀ UN COMPTE)
 * Vérifie le PIN et la limite multi-appareils
 */
export async function loginBoutique({
  nomOrSlug,
  pin,
}: {
  nomOrSlug: string;
  pin: string;
}): Promise<{
  success: boolean;
  boutique?: EfaBoutiqueRecord;
  error?: string;
  limitReached?: boolean;
  limitDetails?: {
    plan: string;
    activeCount: number;
    maxAllowed: number;
    activeDevices: EfaDeviceRecord[];
  };
}> {
  try {
    const searchSlug = slugifyBoutiqueName(nomOrSlug);
    let boutique: EfaBoutiqueRecord | null = null;

    // 1. Recherche dans table centrale Supabase "boutiques" en priorité
    try {
      const { data: centralBtq } = await supabase
        .from('boutiques')
        .select('*')
        .or(`id.eq.${nomOrSlug.trim()},nom_boutique.ilike.%${nomOrSlug.trim()}%,nom.ilike.%${nomOrSlug.trim()}%,proprietaire.ilike.%${nomOrSlug.trim()}%,telephone.eq.${nomOrSlug.trim()}`)
        .limit(1)
        .maybeSingle();

      if (centralBtq) {
        let remotePatMeta: any = null;
        try {
          const { data: rp } = await supabase
            .from('patrons')
            .select('nom, genre, photo_profil, photo_url, date_inscription, phone_country, phone_number, phone_full')
            .eq('id', (centralBtq as any).patron_id || centralBtq.id)
            .maybeSingle();
          remotePatMeta = rp;
        } catch {}

        const rawPlan = ((centralBtq as any).plan || (centralBtq as any).forfait || '').toLowerCase().trim();
        const rawStatus = ((centralBtq as any).status || (centralBtq as any).statut || '').toLowerCase().trim();
        const subEndDate = (centralBtq as any).subscription_end_date || (centralBtq as any).subscription_end || (centralBtq as any).fin_abonnement || centralBtq.date_fin_essai;

        const isStatusActive = rawStatus === 'active' || rawStatus === 'actif' || rawStatus === '';
        const isPopulaire =
          rawPlan === 'populaire' ||
          rawPlan.includes('populaire') ||
          rawPlan.includes('16500') ||
          rawPlan.includes('prolonge');
        const isPro =
          !isPopulaire &&
          (rawPlan === 'pro' ||
            (rawPlan.includes('pro') && !rawPlan.includes('prolonge')) ||
            Number((centralBtq as any).last_payment_amount) >= 50000);
        const resolvedGenre: 'homme' | 'femme' =
          remotePatMeta?.genre === 'homme' || (centralBtq as any).genre === 'homme' ? 'homme' : 'femme';

        boutique = {
          id: centralBtq.id,
          nom_boutique: slugifyBoutiqueName(centralBtq.nom_boutique),
          nom_affichage: centralBtq.nom_boutique,
          nom_patron: remotePatMeta?.nom || centralBtq.proprietaire || centralBtq.nom || 'Patron',
          pin_patron_hash: centralBtq.pin_code ? await hashPin(centralBtq.pin_code) : '',
          pin_code: centralBtq.pin_code || '',
          genre: resolvedGenre,
          patron_photo_url: remotePatMeta?.photo_profil || remotePatMeta?.photo_url || undefined,
          telephone: (centralBtq as any).telephone || (centralBtq as any).whatsapp_number || '',
          whatsapp_number: (centralBtq as any).whatsapp_number || (centralBtq as any).telephone || '',
          phone_country: remotePatMeta?.phone_country || '+228',
          phone_number: remotePatMeta?.phone_number || '',
          plan: isPro ? 'pro' : isPopulaire ? 'populaire' : 'essai',
          date_fin_essai: subEndDate || new Date(Date.now() + 365 * 86400000).toISOString(),
          date_inscription: remotePatMeta?.date_inscription || centralBtq.created_at,
          created_at: centralBtq.created_at || new Date().toISOString(),
          status: isStatusActive ? 'active' : (centralBtq.status || 'active'),
          subscription_end: subEndDate,
          subscription_end_date: subEndDate,
          isProActive: isPro,
        } as any;
      }
    } catch (e) {
      console.warn('[DeviceAuth] Erreur recherche Supabase boutiques:', e);
    }

    // 2. Fallback recherche dans table patrons Supabase
    if (!boutique) {
      try {
        const { data: remotePatron } = await supabase
          .from('patrons')
          .select('*')
          .or(`id.eq.${nomOrSlug.trim()},nom_boutique.ilike.%${nomOrSlug.trim()}%,nom.ilike.%${nomOrSlug.trim()}%,telephone.eq.${nomOrSlug.trim()}`)
          .limit(1)
          .maybeSingle();

        if (remotePatron) {
          let bInfo: any = null;
          try {
            const { data: bReal } = await supabase
              .from('boutiques')
              .select('*')
              .or(`id.eq.${remotePatron.id}${remotePatron.telephone ? `,telephone.eq.${remotePatron.telephone}` : ''}`)
              .limit(1)
              .maybeSingle();
            bInfo = bReal;
          } catch {}

          const rawPlan = ((bInfo?.plan || (remotePatron as any).plan || '').toLowerCase().trim());
          const rawStatus = ((bInfo?.status || bInfo?.statut || '').toLowerCase().trim());
          const subEndDate = bInfo?.subscription_end_date || bInfo?.subscription_end || remotePatron.trial_end_date || remotePatron.subscription_end_date;
          const isStatusActive = rawStatus === 'active' || rawStatus === 'actif' || rawStatus === '';
          const isPopulaire =
            rawPlan === 'populaire' ||
            rawPlan.includes('populaire') ||
            rawPlan.includes('16500') ||
            rawPlan.includes('prolonge');
          const isPro =
            !isPopulaire &&
            (rawPlan === 'pro' ||
              (rawPlan.includes('pro') && !rawPlan.includes('prolonge')) ||
              Number(bInfo?.last_payment_amount) >= 50000);

          boutique = {
            id: remotePatron.id,
            nom_boutique: slugifyBoutiqueName(remotePatron.nom_boutique || nomOrSlug),
            nom_affichage: remotePatron.nom_boutique || nomOrSlug,
            nom_patron: remotePatron.nom || 'Patron',
            pin_patron_hash: remotePatron.pin_hash || '',
            pin_code: remotePatron.pin_code || remotePatron.code_pin || '',
            genre: remotePatron.genre === 'homme' ? 'homme' : 'femme',
            patron_photo_url: remotePatron.photo_profil || remotePatron.photo_url || undefined,
            telephone: remotePatron.telephone || '',
            whatsapp_number: remotePatron.phone_full || remotePatron.telephone || '',
            phone_country: remotePatron.phone_country || '+228',
            phone_number: remotePatron.phone_number || '',
            plan: isPro ? 'pro' : isPopulaire ? 'populaire' : 'essai',
            date_fin_essai: subEndDate || new Date(Date.now() + 365 * 86400000).toISOString(),
            date_inscription: remotePatron.date_inscription || remotePatron.created_at,
            created_at: remotePatron.created_at || new Date().toISOString(),
            status: isStatusActive ? 'active' : 'active',
            subscription_end: subEndDate,
            subscription_end_date: subEndDate,
            isProActive: isPro,
          } as any;
        }
      } catch (e) {
        // ignore
      }
    }

    // 3. Fallback recherche locale dans Dexie
    if (!boutique) {
      const localPatrons = await db.patrons.toArray();
      const match = localPatrons.find(
        (p) =>
          slugifyBoutiqueName(p.nom_boutique) === searchSlug ||
          p.nom_boutique.toLowerCase().includes(nomOrSlug.trim().toLowerCase())
      );
      if (match) {
        boutique = {
          id: match.id,
          nom_boutique: slugifyBoutiqueName(match.nom_boutique),
          nom_affichage: match.nom_boutique,
          nom_patron: match.nom,
          pin_patron_hash: match.pin_hash,
          pin_code: match.pin_code || match.code_pin,
          plan: match.subscription_status === 'pro' ? 'pro' : match.subscription_status === 'populaire' ? 'populaire' : 'essai',
          date_fin_essai: match.trial_end_date || new Date(Date.now() + 21 * 86400000).toISOString(),
          created_at: match.created_at,
        };
      }
    }

    if (!boutique) {
      return {
        success: false,
        error: `Boutique "${nomOrSlug}" introuvable. Vérifiez l'orthographe du nom de boutique.`,
      };
    }

    // 4. Vérification du Code PIN (Bcrypt ou comparaison directe)
    let isPinValid = false;
    if (boutique.pin_patron_hash) {
      isPinValid = await verifyPin(pin, boutique.pin_patron_hash);
    }
    if (!isPinValid && boutique.pin_code) {
      isPinValid = boutique.pin_code === pin;
    }

    if (!isPinValid) {
      return {
        success: false,
        error: 'Code PIN incorrect pour cette boutique. Réessayez.',
      };
    }

    // 5. Vérification multi-appareils selon le plan (essai: 1, populaire: 3, pro: 5)
    const currentDeviceId = getDeviceId();
    const currentDeviceName = getDeviceName();
    const planKey = boutique.plan || 'essai';
    const maxAllowed = DEVICE_LIMITS[planKey] || 1;

    let activeDevices: EfaDeviceRecord[] = [];
    try {
      const { data: devicesData } = await supabase
        .from('efa_devices')
        .select('*')
        .eq('boutique_id', boutique.id)
        .eq('is_active', true);

      if (devicesData) {
        activeDevices = devicesData;
      }
    } catch (e) {
      console.warn('[DeviceAuth] Erreur lecture efa_devices:', e);
    }

    // Si aucun retour Supabase, on vérifie dans Dexie local
    if (activeDevices.length === 0) {
      const localDevs = await db.appareils
        .where('patron_id')
        .equals(boutique.id)
        .toArray();
      activeDevices = localDevs
        .filter((d) => d.is_active !== false)
        .map((d) => ({
          id: d.id,
          boutique_id: d.patron_id,
          device_id: d.device_id,
          device_name: d.device_name || 'Appareil',
          last_seen: d.last_active,
          is_active: true,
          created_at: d.created_at || d.last_active,
        }));
    }

    // Cet appareil est-il déjà enregistré et actif ?
    const alreadyRegistered = activeDevices.find((d) => d.device_id === currentDeviceId);

    if (!alreadyRegistered) {
      // Nouvel appareil : vérifions la limite
      if (activeDevices.length >= maxAllowed) {
        return {
          success: false,
          limitReached: true,
          error: `Limite atteinte : Plan ${planKey === 'essai' ? 'Essai' : planKey} = ${maxAllowed} appareil(s).`,
          limitDetails: {
            plan: planKey,
            activeCount: activeDevices.length,
            maxAllowed,
            activeDevices,
          },
          boutique,
        };
      }

      // Limite non atteinte : on enregistre ce nouvel appareil
      const newDeviceRecord: EfaDeviceRecord = {
        id: 'dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6),
        boutique_id: boutique.id,
        device_id: currentDeviceId,
        device_name: currentDeviceName,
        last_seen: new Date().toISOString(),
        is_active: true,
        created_at: new Date().toISOString(),
      };

      try {
        await supabase.from('efa_devices').insert(newDeviceRecord);
      } catch (e) {}

      await db.appareils.put({
        id: newDeviceRecord.id,
        patron_id: boutique.id,
        device_id: currentDeviceId,
        device_name: currentDeviceName,
        last_active: newDeviceRecord.last_seen,
        is_active: true,
        created_at: newDeviceRecord.created_at,
      });
    } else {
      // Appareil déjà actif : on met à jour la date de dernière activité
      const nowIso = new Date().toISOString();
      try {
        await supabase
          .from('efa_devices')
          .update({ last_seen: nowIso })
          .eq('boutique_id', boutique.id)
          .eq('device_id', currentDeviceId);
      } catch (e) {}
    }

    // 6. Succès : Configuration de la session locale pour cette boutique
    const patronObj = boutiqueToPatron(boutique, pin);
    await db.patrons.put(patronObj);

    localStorage.setItem('currentBoutiqueId', boutique.id);
    localStorage.setItem('currentBoutiqueSlug', boutique.nom_boutique);
    localStorage.setItem('currentBoutiqueName', boutique.nom_affichage);
    localStorage.setItem('entreprise_id', boutique.id);
    localStorage.setItem('efa_active_user_id', boutique.id);
    localStorage.setItem('efa_aconta_locked', 'false');

    return { success: true, boutique };
  } catch (err: any) {
    console.error('[DeviceAuth] Erreur login boutique:', err);
    return { success: false, error: err?.message || 'Erreur lors de la connexion' };
  }
}

/**
 * Récupère la liste des appareils actifs pour la boutique courante
 */
export async function getBoutiqueDevices(boutiqueId: string): Promise<EfaDeviceRecord[]> {
  try {
    const { data, error } = await supabase
      .from('efa_devices')
      .select('*')
      .eq('boutique_id', boutiqueId)
      .eq('is_active', true)
      .order('last_seen', { ascending: false });

    if (!error && data && data.length > 0) {
      return data;
    }
  } catch (e) {
    console.warn('[DeviceAuth] Erreur lecture efa_devices:', e);
  }

  // Fallback Dexie local
  const local = await db.appareils.where('patron_id').equals(boutiqueId).toArray();
  return local
    .filter((d) => d.is_active !== false)
    .map((d) => ({
      id: d.id,
      boutique_id: d.patron_id,
      device_id: d.device_id,
      device_name: d.device_name || 'Appareil',
      last_seen: d.last_active,
      is_active: true,
      created_at: d.created_at || d.last_active,
    }));
}

/**
 * Déconnecte un appareil de la boutique (libère un slot)
 */
export async function disconnectDevice(
  boutiqueId: string,
  deviceIdToDisconnect: string
): Promise<{ success: boolean; isCurrentDevice: boolean }> {
  const currentDeviceId = getDeviceId();
  const isCurrentDevice = deviceIdToDisconnect === currentDeviceId;

  try {
    await supabase
      .from('efa_devices')
      .update({ is_active: false })
      .eq('boutique_id', boutiqueId)
      .eq('device_id', deviceIdToDisconnect);
  } catch (e) {
    console.warn('[DeviceAuth] Erreur suppression appareil cloud:', e);
  }

  try {
    const local = await db.appareils
      .where('patron_id')
      .equals(boutiqueId)
      .filter((d) => d.device_id === deviceIdToDisconnect)
      .first();

    if (local) {
      await db.appareils.update(local.id, { is_active: false });
    }
  } catch (e) {}

  if (isCurrentDevice) {
    localStorage.removeItem('currentBoutiqueId');
    localStorage.removeItem('entreprise_id');
    localStorage.removeItem('efa_active_user_id');
    localStorage.setItem('efa_aconta_locked', 'true');
  }

  return { success: true, isCurrentDevice };
}
