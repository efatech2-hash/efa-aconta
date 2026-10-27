import React, { useState, useEffect } from 'react';
import { Camera, Image as ImageIcon, Check, Store, ShieldCheck, Phone, User, KeyRound, Eye, EyeOff } from 'lucide-react';
import { hashPin } from '../lib/security';
import { db } from '../lib/db';
import { queueSyncItem } from '../lib/sync';
import { speakFrench } from '../lib/speech';
import type { Patron, Genre } from '../lib/types';
import { getAccord } from '../lib/accord';
import { COUNTRY_CODES, validatePhoneNumber } from '../lib/countryCodes';
import {
  takePhotoFromCamera,
  pickPhotoFromGallery,
  pickPhotoInApp,
  persistFormState,
  restoreFormState,
  clearFormState,
} from '../lib/camera';

interface OnboardingScreenProps {
  onComplete: (patron: Patron) => void;
  referralCode?: string;
}

export const OnboardingScreen: React.FC<OnboardingScreenProps> = ({ onComplete, referralCode }) => {
  const [nom, setNom] = useState('');
  const [phoneCountry, setPhoneCountry] = useState('+228');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [nomBoutique, setNomBoutique] = useState('Ma Boutique');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [showConfirmPin, setShowConfirmPin] = useState(false);
  const [genre, setGenre] = useState<Genre>('femme'); // Correction 4: Genre obligatoire
  const [photoUrl, setPhotoUrl] = useState<string | undefined>(undefined); // Correction 3: Optionnel
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Correction 10: Récupération parrainage depuis URL ou localStorage
  const [parrainRef, setParrainRef] = useState<string | null>(null);

  useEffect(() => {
    const storedRef = localStorage.getItem('efa_invite_code') || referralCode;
    if (storedRef) {
      setParrainRef(storedRef);
    }
  }, [referralCode]);

  // Restauration du brouillon d'inscription si l'OS Android avait suspendu la vue
  useEffect(() => {
    const draft = restoreFormState<{
      nom?: string;
      phoneCountry?: string;
      phoneNumber?: string;
      nomBoutique?: string;
      pin?: string;
      confirmPin?: string;
      genre?: Genre;
      photoUrl?: string;
    }>('onboarding_patron');

    if (draft) {
      if (draft.nom) setNom(draft.nom);
      if (draft.phoneCountry) setPhoneCountry(draft.phoneCountry);
      if (draft.phoneNumber) setPhoneNumber(draft.phoneNumber);
      if (draft.nomBoutique) setNomBoutique(draft.nomBoutique);
      if (draft.pin) setPin(draft.pin);
      if (draft.confirmPin) setConfirmPin(draft.confirmPin);
      if (draft.genre) setGenre(draft.genre);
      if (draft.photoUrl) setPhotoUrl(draft.photoUrl);
    }
  }, []);

  // Capture / Sélection photo in-app Capacitor sans rechargement destructif
  const handleCamera = async () => {
    const currentForm = {
      nom,
      phoneCountry,
      phoneNumber,
      nomBoutique,
      pin,
      confirmPin,
      genre,
      photoUrl,
    };
    const photo = await takePhotoFromCamera({
      formKey: 'onboarding_patron',
      formData: currentForm,
    });
    if (photo) {
      setPhotoUrl(photo);
    }
  };

  const handleGallery = async () => {
    const currentForm = {
      nom,
      phoneCountry,
      phoneNumber,
      nomBoutique,
      pin,
      confirmPin,
      genre,
      photoUrl,
    };
    const photo = await pickPhotoFromGallery({
      formKey: 'onboarding_patron',
      formData: currentForm,
    });
    if (photo) {
      setPhotoUrl(photo);
    }
  };

  const handlePickPhoto = handleCamera;

  const accord = getAccord(genre);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nom.trim()) {
      setError("Tape ton nom s'il te plaît");
      return;
    }
    if (!phoneNumber.trim()) {
      setError('Tape ton numéro WhatsApp');
      return;
    }
    if (!validatePhoneNumber(phoneNumber, phoneCountry)) {
      setError(`Numéro invalide pour le pays sélectionné (${phoneCountry}). Format 8 à 10 chiffres requis.`);
      return;
    }
    if (pin.length !== 4 || !/^\d{4}$/.test(pin)) {
      setError('Le code PIN doit comporter exactement 4 chiffres');
      return;
    }
    if (pin !== confirmPin) {
      setError('Les codes PIN ne correspondent pas');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Sécurité : pin_hash avec bcryptjs.hash(pin, 10)
      const pin_hash = await hashPin(pin);
      const patronId = 'patron-' + Date.now();

      // MODIF 2: Essai gratuit de 21 jours
      const now = new Date();
      const trialEndDate = new Date(now.getTime() + 21 * 24 * 60 * 60 * 1000);

      const cleanDigits = phoneNumber.replace(/[\s\-\.]/g, '');
      const phoneFull = phoneCountry === 'Autre' ? cleanDigits : `${phoneCountry}${cleanDigits}`;

      const idDigits = patronId.replace(/\D/g, '') || Date.now();
      const newPatron: Patron = {
        id: patronId,
        nom: nom.trim(),
        email: `patron${idDigits}@gmail.com`,
        telephone: `${phoneCountry} ${cleanDigits}`,
        phone_country: phoneCountry,
        phone_number: cleanDigits,
        phone_full: phoneFull,
        nom_boutique: nomBoutique.trim() || 'Ma Boutique',
        pin_hash,
        pin_code: pin,
        photo_url: photoUrl,
        genre,
        role: 'patron',
        abonnement_expire: trialEndDate.toISOString(),
        trial_start_date: now.toISOString(),
        trial_end_date: trialEndDate.toISOString(),
        subscription_status: 'trial',
        subscription_end_date: trialEndDate.toISOString(),
        auto_logout_after_action: true,
        created_at: now.toISOString(),
      };

      // Sauvegarde dans Dexie
      await db.patrons.put(newPatron);
      // Synchronisation vers Supabase
      await queueSyncItem('patrons', 'insert', patronId, newPatron);

      // Correction 10 : Génération du lien de parrainage avec slug
      const cleanNomSlug = nom.toLowerCase().replace(/[^a-z0-9]/g, '');
      const uniqueSlug = `efa-${cleanNomSlug || 'boutique'}-${Math.floor(Math.random() * 8999 + 1000)}`;
      await db.parrainage.put({
        id: 'parr-init-' + Date.now(),
        parrain_id: patronId,
        filleul_nom: 'Exemple Filleule',
        lien_code: uniqueSlug,
        filleul_phone: '+228 90 00 00 00',
        status: 'attente',
        mois_gagnes: 0,
        clics: 0,
        conversions: 0,
        date_inscription: new Date().toISOString(),
      });

      // Si inscrit via parrain, incrémenter conversion
      if (parrainRef) {
        console.log(`[Parrainage] Inscrit via code invitation: ${parrainRef}`);
      }

      speakFrench(`Bienvenue ${accord.titrePatron} ${newPatron.nom} dans ta caisse EFA ACONTA !`);
      clearFormState('onboarding_patron');
      onComplete(newPatron);
    } catch (err: any) {
      console.error('Erreur inscription:', err);
      setError('Une erreur est survenue, réessaie.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8F9FA] flex flex-col items-center justify-center p-4 sm:p-6 select-none">
      <div className="w-full max-w-lg bg-white rounded-3xl p-6 sm:p-8 shadow-2xl border-2 border-gray-100">
        {/* Brand header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#6C5CE7]/10 text-[#6C5CE7] font-black text-sm mb-2">
            GESTION COMMERCE VOCALE & TACTILE
          </div>
          <h1 className="text-3xl sm:text-4xl font-black text-gray-900">
            EFA ACONTA V5
          </h1>
          <p className="text-base font-bold text-gray-500 mt-1">
            Création du compte {accord.titrePatron}
          </p>

          {parrainRef && (
            <div className="mt-2 inline-block px-3 py-1 bg-amber-100 text-amber-800 rounded-full text-xs font-black">
              🎁 Code invitation activé : {parrainRef} (+1 mois offert)
            </div>
          )}
        </div>

        {error && (
          <div className="mb-4 p-4 rounded-2xl bg-red-100 text-red-700 font-bold text-base text-center border border-red-300">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* CORRECTION 4 : GENRE OBLIGATOIRE (2 BOUTONS RADIO GÉANTS) */}
          <div>
            <label className="block text-base font-black text-gray-800 mb-2">
              Tu es : (sélectionne ton genre) *
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setGenre('femme')}
                className={`min-h-[70px] rounded-2xl p-3 border-4 flex items-center justify-center gap-3 transition-all ${
                  genre === 'femme'
                    ? 'border-[#6C5CE7] bg-purple-50 text-[#6C5CE7] font-black shadow-md ring-2 ring-purple-300'
                    : 'border-gray-200 bg-gray-50 text-gray-600 font-bold'
                }`}
              >
                <span className="text-3xl">👩</span>
                <span className="text-xl">FEMME</span>
              </button>

              <button
                type="button"
                onClick={() => setGenre('homme')}
                className={`min-h-[70px] rounded-2xl p-3 border-4 flex items-center justify-center gap-3 transition-all ${
                  genre === 'homme'
                    ? 'border-[#6C5CE7] bg-purple-50 text-[#6C5CE7] font-black shadow-md ring-2 ring-purple-300'
                    : 'border-gray-200 bg-gray-50 text-gray-600 font-bold'
                }`}
              >
                <span className="text-3xl">👨</span>
                <span className="text-xl">HOMME</span>
              </button>
            </div>
          </div>

          {/* CORRECTION 3 : PHOTO OPTIONNELLE AVEC AVATAR INITIALE */}
          <div className="flex flex-col items-center justify-center py-2">
            <div className="relative mb-2">
              {photoUrl ? (
                <img
                  src={photoUrl}
                  alt="Avatar"
                  className="w-24 h-24 rounded-full object-cover border-4 border-[#6C5CE7] shadow-lg"
                />
              ) : (
                <div className="w-24 h-24 rounded-full bg-gradient-to-tr from-[#6C5CE7] to-indigo-400 text-white flex items-center justify-center text-3xl font-black shadow-lg border-4 border-white">
                  {nom.trim() ? nom.trim().charAt(0).toUpperCase() : genre === 'femme' ? '👩' : '👨'}
                </div>
              )}
            </div>

            <span className="text-xs font-bold text-gray-500 mb-2">
              Photo ou Selfie <span className="font-extrabold text-gray-400">(optionnel)</span>
            </span>

            <div className="flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={handleCamera}
                className="px-4 py-2.5 rounded-2xl bg-teal-600 hover:bg-teal-700 active:scale-95 text-white text-xs font-black flex items-center gap-1.5 cursor-pointer shadow-sm transition touch-manipulation min-h-[44px] border border-teal-500/20"
              >
                <Camera className="w-4 h-4 stroke-[2.5]" />
                <span>Caméra</span>
              </button>

              <button
                type="button"
                onClick={handleGallery}
                className="px-4 py-2.5 rounded-2xl bg-[#6C5CE7] hover:bg-[#5b4bc4] active:scale-95 text-white text-xs font-black flex items-center gap-1.5 cursor-pointer shadow-sm transition touch-manipulation min-h-[44px] border border-indigo-500/20"
              >
                <ImageIcon className="w-4 h-4 stroke-[2.5]" />
                <span>Galerie</span>
              </button>

              {photoUrl && (
                <button
                  type="button"
                  onClick={() => setPhotoUrl(undefined)}
                  className="px-3 py-2 rounded-xl bg-red-50 hover:bg-red-100 text-red-600 text-xs font-bold transition active:scale-95 cursor-pointer border border-red-200 min-h-[44px]"
                >
                  Supprimer
                </button>
              )}
            </div>
          </div>

          {/* Ton nom */}
          <div>
            <label className="block text-base font-black text-gray-800 mb-1 flex items-center gap-2">
              <User className="w-5 h-5 text-[#6C5CE7]" />
              Ton Nom :
            </label>
            <input
              type="text"
              required
              placeholder="Ex : Maman Aïcha, Koffi..."
              value={nom}
              onChange={(e) => setNom(e.target.value)}
              className="w-full text-xl font-bold p-4 rounded-2xl border-2 border-gray-300 focus:border-[#6C5CE7] focus:outline-none bg-gray-50 text-gray-900"
            />
          </div>

          {/* Numéro WhatsApp avec indicatif international */}
          <div>
            <label className="block text-base font-black text-gray-800 mb-1 flex items-center gap-2">
              <Phone className="w-5 h-5 text-emerald-600" />
              Numéro WhatsApp :
            </label>
            <div className="grid grid-cols-12 gap-2">
              <select
                value={phoneCountry}
                onChange={(e) => setPhoneCountry(e.target.value)}
                className="col-span-5 sm:col-span-5 text-sm sm:text-base font-bold p-4 rounded-2xl border-2 border-gray-300 focus:border-[#6C5CE7] focus:outline-none bg-gray-50 text-gray-900 cursor-pointer"
              >
                {COUNTRY_CODES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.flag} {c.code} ({c.country})
                  </option>
                ))}
              </select>
              <input
                type="tel"
                required
                placeholder="Ex : 90 12 34 56"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                className="col-span-7 sm:col-span-7 w-full text-lg sm:text-xl font-bold p-4 rounded-2xl border-2 border-gray-300 focus:border-[#6C5CE7] focus:outline-none bg-gray-50 text-gray-900"
              />
            </div>
            <p className="text-xs font-bold text-gray-400 mt-1">
              Indicatif {phoneCountry} par défaut • Format 8-10 chiffres
            </p>
          </div>

          {/* Nom boutique */}
          <div>
            <label className="block text-base font-black text-gray-800 mb-1 flex items-center gap-2">
              <Store className="w-5 h-5 text-[#E17055]" />
              Nom de ta boutique :
            </label>
            <input
              type="text"
              placeholder="Ex : Boutique Élégance, Mode & Beauté..."
              value={nomBoutique}
              onChange={(e) => setNomBoutique(e.target.value)}
              className="w-full text-xl font-bold p-4 rounded-2xl border-2 border-gray-300 focus:border-[#6C5CE7] focus:outline-none bg-gray-50 text-gray-900"
            />
          </div>

          {/* Double champ PIN (Création + Confirmation) */}
          <div className="space-y-4">
            <div>
              <label className="block text-base font-black text-gray-800 mb-1 flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <KeyRound className="w-5 h-5 text-amber-500" />
                  Code PIN (4 chiffres) :
                </span>
                <span className="text-xs font-bold text-gray-400">Secret</span>
              </label>
              <div className="relative">
                <input
                  type={showPin ? 'text' : 'password'}
                  inputMode="numeric"
                  maxLength={4}
                  pattern="\d{4}"
                  required
                  placeholder="••••"
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  className="w-full text-2xl font-black text-center tracking-widest p-4 pr-12 rounded-2xl border-2 border-gray-300 focus:border-[#6C5CE7] focus:outline-none bg-gray-50 text-gray-900"
                />
                <button
                  type="button"
                  onClick={() => setShowPin(!showPin)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-gray-400 hover:text-gray-700 transition"
                  aria-label={showPin ? 'Masquer' : 'Afficher'}
                >
                  {showPin ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-base font-black text-gray-800 mb-1 flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <KeyRound className="w-5 h-5 text-indigo-500" />
                  Confirmez Code PIN :
                </span>
                {confirmPin && pin && (
                  <span className={`text-xs font-bold ${pin === confirmPin ? 'text-emerald-600' : 'text-rose-500'}`}>
                    {pin === confirmPin ? '✓ Identique' : '✗ Ne correspond pas'}
                  </span>
                )}
              </label>
              <div className="relative">
                <input
                  type={showConfirmPin ? 'text' : 'password'}
                  inputMode="numeric"
                  maxLength={4}
                  pattern="\d{4}"
                  required
                  placeholder="••••"
                  value={confirmPin}
                  onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  className={`w-full text-2xl font-black text-center tracking-widest p-4 pr-12 rounded-2xl border-2 ${
                    confirmPin && pin !== confirmPin ? 'border-rose-400 bg-rose-50/30' : 'border-gray-300'
                  } focus:border-[#6C5CE7] focus:outline-none bg-gray-50 text-gray-900`}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPin(!showConfirmPin)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-gray-400 hover:text-gray-700 transition"
                  aria-label={showConfirmPin ? 'Masquer' : 'Afficher'}
                >
                  {showConfirmPin ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>
          </div>

          {/* BOUTON S'INSCRIRE VERT GÉANT 80PX MIN */}
          <button
            type="submit"
            disabled={isLoading}
            className="w-full min-h-[85px] py-4 px-6 rounded-2xl bg-[#00B894] hover:bg-emerald-600 active:scale-95 text-white font-black text-2xl sm:text-3xl flex items-center justify-center gap-3 shadow-xl shadow-emerald-500/30 transition border-2 border-emerald-500 mt-6"
          >
            <Check className="w-9 h-9 stroke-[3]" />
            <span>{isLoading ? 'ENREGISTREMENT...' : "S'INSCRIRE"}</span>
          </button>
        </form>

        <div className="mt-4 flex items-center justify-center gap-2 text-xs font-bold text-gray-400 text-center">
          <ShieldCheck className="w-4 h-4 text-[#00B894]" />
          <span>Sécurité bancaire bcrypt 10 • 100% PWA Hors ligne</span>
        </div>
      </div>
    </div>
  );
};
