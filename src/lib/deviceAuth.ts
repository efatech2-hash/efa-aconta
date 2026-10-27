import { supabase } from './supabase';
import { db } from './db';
import { hashPin, verifyPin } from './security';
import type { Patron } from './types';
import { generateReferralCode } from './ambassadeur';

export interface EfaBoutiqueRecord {
  id: string;
  nom_boutique: string; // slug unique (ex: dodo-shop)
  nom_affichage: string; // nom complet (ex: Dodo Shop)
  nom_patron?: string;
  pin_patron_hash: string;
  pin_code?: string;
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
 */
export function boutiqueToPatron(b: EfaBoutiqueRecord, pinClear?: string): Patron {
  const pin = pinClear || b.pin_code || '';
  const finAbonnement = (b as any).fin_abonnement || (b as any).subscription_end_date || b.date_fin_essai;
  return {
    id: b.id,
    nom: b.nom_patron || b.nom_affichage,
    telephone: '',
    phone_country: '+228',
    phone_number: '',
    phone_full: '',
    nom_boutique: b.nom_affichage,
    pin_code: pin,
    code_pin: pin,
    pin_hash: b.pin_patron_hash,
    genre: 'femme',
    role: 'patron',
    abonnement_expire: finAbonnement || b.date_fin_essai,
    subscription_status: (b as any).statut === 'ACTIF' ? 'populaire' : (b.plan === 'essai' ? 'trial' : (b.plan as any)),
    trial_start_date: b.created_at,
    trial_end_date: b.date_fin_essai,
    subscription_end_date: finAbonnement || b.date_fin_essai,
    fin_abonnement: finAbonnement,
    forfait: (b as any).forfait || b.plan,
    statut: (b as any).statut,
    referral_code: b.referral_code || (b as any).code_parrain || undefined,
    referred_by: b.referred_by || null,
    referral_bonus_given: (b as any).referral_bonus_given || false,
    has_paid_annuel: (b as any).has_paid_annuel || false,
    referrals_count: (b as any).referrals_count || 0,
    bonus_days_earned: (b as any).bonus_days_earned || 0,
    auto_logout_after_action: true,
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
}: {
  nomBoutique: string;
  nomPatron: string;
  pin: string;
}): Promise<{ success: boolean; boutique?: EfaBoutiqueRecord; error?: string }> {
  try {
    const slug = slugifyBoutiqueName(nomBoutique);
    const pinHash = await hashPin(pin);
    const now = new Date();
    const trialEnd = new Date(now.getTime() + 21 * 24 * 60 * 60 * 1000); // 21 jours
    const boutiqueId = 'btq_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);

    // Capture du parrain depuis le lien d'invitation (?ref=CODE)
    const refBy = typeof window !== 'undefined' ? (localStorage.getItem('efa_aconta_ref') || null) : null;
    const referralCode = generateReferralCode();

    const boutiqueRecord: EfaBoutiqueRecord = {
      id: boutiqueId,
      nom_boutique: slug,
      nom_affichage: nomBoutique.trim(),
      nom_patron: nomPatron.trim() || 'Patron',
      pin_patron_hash: pinHash,
      pin_code: pin,
      plan: 'essai',
      date_fin_essai: trialEnd.toISOString(),
      referral_code: referralCode,
      referred_by: refBy ? refBy.trim().toUpperCase() : null,
      referral_bonus_given: false,
      has_paid_annuel: false,
      referrals_count: 0,
      bonus_days_earned: 0,
      created_at: now.toISOString(),
    };

    // 1. Sauvegarde dans Dexie (Local)
    const patronObj = boutiqueToPatron(boutiqueRecord, pin);
    await db.patrons.put(patronObj);

    // 2. Création de l'appareil dans efa_devices (Device #1)
    const currentDevId = getDeviceId();
    const currentDevName = getDeviceName();
    const deviceRecord: EfaDeviceRecord = {
      id: 'dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6),
      boutique_id: boutiqueId,
      device_id: currentDevId,
      device_name: currentDevName,
      last_seen: now.toISOString(),
      is_active: true,
      created_at: now.toISOString(),
    };

    // Sauvegarde appareil local Dexie
    await db.appareils.put({
      id: deviceRecord.id,
      patron_id: boutiqueId,
      device_id: currentDevId,
      device_name: currentDevName,
      last_active: now.toISOString(),
      is_active: true,
      created_at: now.toISOString(),
    });

    // 3. Synchronisation Cloud Supabase (efa_boutiques + efa_devices + patrons)
    try {
      // Insertion efa_boutiques
      await supabase.from('efa_boutiques').upsert(boutiqueRecord);
      // Insertion efa_devices
      await supabase.from('efa_devices').upsert(deviceRecord);
      // Miroir patrons pour synchronisation continue
      await supabase.from('patrons').upsert(patronObj);
    } catch (cloudErr) {
      console.warn('[DeviceAuth] Sync cloud reportée (offline first):', cloudErr);
    }

    // Sauvegarde variables session
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

    // 1. Recherche dans Supabase en priorité
    try {
      const { data: remoteBtq } = await supabase
        .from('efa_boutiques')
        .select('*')
        .or(`nom_boutique.eq.${searchSlug},nom_affichage.ilike.%${nomOrSlug.trim()}%`)
        .limit(1)
        .maybeSingle();

      if (remoteBtq) {
        boutique = remoteBtq;
      }
    } catch (e) {
      console.warn('[DeviceAuth] Erreur recherche Supabase efa_boutiques:', e);
    }

    // 2. Fallback recherche dans table patrons Supabase
    if (!boutique) {
      try {
        const { data: remotePatron } = await supabase
          .from('patrons')
          .select('*')
          .ilike('nom_boutique', `%${nomOrSlug.trim()}%`)
          .limit(1)
          .maybeSingle();

        if (remotePatron) {
          boutique = {
            id: remotePatron.id,
            nom_boutique: slugifyBoutiqueName(remotePatron.nom_boutique || nomOrSlug),
            nom_affichage: remotePatron.nom_boutique || nomOrSlug,
            nom_patron: remotePatron.nom || 'Patron',
            pin_patron_hash: remotePatron.pin_hash || '',
            pin_code: remotePatron.pin_code || remotePatron.code_pin || '',
            plan: remotePatron.subscription_status === 'pro' ? 'pro' : remotePatron.subscription_status === 'populaire' ? 'populaire' : 'essai',
            date_fin_essai: remotePatron.trial_end_date || remotePatron.subscription_end_date || new Date(Date.now() + 21 * 86400000).toISOString(),
            created_at: remotePatron.created_at || new Date().toISOString(),
          };
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
