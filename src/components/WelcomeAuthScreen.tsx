import React, { useState, useEffect } from 'react';
import { Store, KeyRound, User, ArrowLeft, Check, ShieldCheck, Sparkles, Smartphone, Eye, EyeOff, Camera, Image as ImageIcon, Download, ExternalLink } from 'lucide-react';
import { createBoutique, loginBoutique, slugifyBoutiqueName, type EfaBoutiqueRecord } from '../lib/deviceAuth';
import { DeviceLimitModal } from './DeviceLimitModal';
import type { Patron } from '../lib/types';
import { boutiqueToPatron } from '../lib/deviceAuth';
import { COUNTRY_CODES, formatPhoneWithCountryCode, validatePhoneNumber } from '../lib/countryCodes';
import {
  takePhotoFromCamera,
  pickPhotoFromGallery,
  restoreFormState,
  clearFormState,
} from '../lib/camera';
import { PLAY_STORE_URL, usePWAInstall } from '../lib/usePWAInstall';
import { PWAInstallButton, PWAInstallGuideModal } from './PWAInstallButton';

interface WelcomeAuthScreenProps {
  onSuccess: (patron: Patron) => void;
  onOpenSubscriptionModal?: (plan?: 'populaire' | 'pro', reason?: string) => void;
}

export const WelcomeAuthScreen: React.FC<WelcomeAuthScreenProps> = ({
  onSuccess,
  onOpenSubscriptionModal,
}) => {
  const [view, setView] = useState<'landing' | 'create' | 'login'>('landing');

  // Formulaire Création
  const [createNomBoutique, setCreateNomBoutique] = useState('');
  const [createNomPatron, setCreateNomPatron] = useState('');
  const [createGenre, setCreateGenre] = useState<'femme' | 'homme'>('femme');
  const [createPhotoUrl, setCreatePhotoUrl] = useState<string | undefined>(undefined);
  const [createPhoneCountry, setCreatePhoneCountry] = useState('+228');
  const [createWhatsapp, setCreateWhatsapp] = useState('');
  const [createPin, setCreatePin] = useState('');
  const [createConfirmPin, setCreateConfirmPin] = useState('');
  const [showCreatePin, setShowCreatePin] = useState(false);

  // Formulaire Connexion
  const [loginNomBoutique, setLoginNomBoutique] = useState('');
  const [loginPin, setLoginPin] = useState('');
  const [showLoginPin, setShowLoginPin] = useState(false);

  // État UI
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showInstallGuideModal, setShowInstallGuideModal] = useState(false);

  const handleWebAppInstallClick = async () => {
    if (isInstalled) {
      setShowInstallGuideModal(true);
      return;
    }
    if (isInstallable) {
      const result = await install();
      if (result === 'unavailable') {
        setShowInstallGuideModal(true);
      }
      return;
    }
    setShowInstallGuideModal(true);
  };

  // État Modal Limite Multi-Appareils
  const [limitModalData, setLimitModalData] = useState<{
    isOpen: boolean;
    plan: string;
    activeCount: number;
    maxAllowed: number;
    activeDevices: any[];
    boutique?: EfaBoutiqueRecord;
  }>({
    isOpen: false,
    plan: 'essai',
    activeCount: 1,
    maxAllowed: 1,
    activeDevices: [],
  });

  useEffect(() => {
    const draft = restoreFormState<{
      view?: 'landing' | 'create' | 'login';
      createNomBoutique?: string;
      createNomPatron?: string;
      createGenre?: 'femme' | 'homme';
      createPhotoUrl?: string;
      createPhoneCountry?: string;
      createWhatsapp?: string;
      createPin?: string;
      createConfirmPin?: string;
    }>('signup_patron');
    if (draft) {
      if (draft.view) setView(draft.view);
      if (draft.createNomBoutique) setCreateNomBoutique(draft.createNomBoutique);
      if (draft.createNomPatron) setCreateNomPatron(draft.createNomPatron);
      if (draft.createGenre) setCreateGenre(draft.createGenre);
      if (draft.createPhotoUrl) setCreatePhotoUrl(draft.createPhotoUrl);
      if (draft.createPhoneCountry) setCreatePhoneCountry(draft.createPhoneCountry);
      if (draft.createWhatsapp) setCreateWhatsapp(draft.createWhatsapp);
      if (draft.createPin) setCreatePin(draft.createPin);
      if (draft.createConfirmPin) setCreateConfirmPin(draft.createConfirmPin);
    }
  }, []);

  const buildDraftData = () => ({
    view: 'create' as const,
    createNomBoutique,
    createNomPatron,
    createGenre,
    createPhotoUrl,
    createPhoneCountry,
    createWhatsapp,
    createPin,
    createConfirmPin,
  });

  // Duplique méthode photo employé : Prendre photo + Télécharger
  const handleCreateCamera = async () => {
    const photo = await takePhotoFromCamera({
      formKey: 'signup_patron',
      formData: buildDraftData(),
    });
    if (photo) {
      setCreatePhotoUrl(photo);
    }
  };

  const handleCreateGallery = async () => {
    const photo = await pickPhotoFromGallery({
      formKey: 'signup_patron',
      formData: buildDraftData(),
    });
    if (photo) {
      setCreatePhotoUrl(photo);
    }
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!createNomBoutique.trim()) {
      setErrorMsg('Veuillez indiquer le nom de votre boutique.');
      return;
    }
    const { full: fullWhatsapp, localDigits, country } = formatPhoneWithCountryCode(
      createWhatsapp,
      createPhoneCountry
    );
    if (!createWhatsapp.trim() || !validatePhoneNumber(createWhatsapp, createPhoneCountry)) {
      setErrorMsg(
        `Le numéro WhatsApp est obligatoire et invalide pour l'indicatif ${createPhoneCountry} (minimum 8 chiffres requis).`
      );
      return;
    }
    if (createPin.length !== 4) {
      setErrorMsg('Le code PIN patron doit comporter exactement 4 chiffres (comme Mobile Money).');
      return;
    }
    if (createPin !== createConfirmPin) {
      setErrorMsg('Les deux codes PIN ne correspondent pas.');
      return;
    }

    setIsLoading(true);
    try {
      const res = await createBoutique({
        nomBoutique: createNomBoutique.trim(),
        nomPatron: createNomPatron.trim(),
        genre: createGenre,
        photoUrl: createPhotoUrl,
        phoneCountry: country,
        phoneNumber: localDigits,
        whatsappNumber: fullWhatsapp,
        telephone: fullWhatsapp,
        pin: createPin,
      });

      if (!res.success || !res.boutique) {
        setErrorMsg(res.error || 'Erreur lors de la création de la boutique.');
        setIsLoading(false);
        return;
      }

      clearFormState('signup_patron');
      const patronObj = boutiqueToPatron(res.boutique, createPin);
      if (res.boutique.patron_photo_url || createPhotoUrl) {
        const finalPhoto = res.boutique.patron_photo_url || createPhotoUrl;
        patronObj.photo_url = finalPhoto;
        patronObj.photo_profil = finalPhoto;
      }
      patronObj.genre = createGenre;
      patronObj.phone_country = country;
      patronObj.phone_number = localDigits;
      patronObj.phone_full = fullWhatsapp;
      patronObj.telephone = fullWhatsapp;
      onSuccess(patronObj);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Erreur inattendue.');
      setIsLoading(false);
    }
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!loginNomBoutique.trim()) {
      setErrorMsg('Veuillez indiquer le nom de votre boutique.');
      return;
    }
    if (loginPin.length !== 4) {
      setErrorMsg('Le code PIN doit comporter 4 chiffres.');
      return;
    }

    setIsLoading(true);
    try {
      const res = await loginBoutique({
        nomOrSlug: loginNomBoutique.trim(),
        pin: loginPin,
      });

      if (res.limitReached && res.limitDetails) {
        setIsLoading(false);
        setLimitModalData({
          isOpen: true,
          plan: res.limitDetails.plan,
          activeCount: res.limitDetails.activeCount,
          maxAllowed: res.limitDetails.maxAllowed,
          activeDevices: res.limitDetails.activeDevices,
          boutique: res.boutique,
        });
        return;
      }

      if (!res.success || !res.boutique) {
        setErrorMsg(res.error || 'Identifiants incorrects.');
        setIsLoading(false);
        return;
      }

      const patronObj = boutiqueToPatron(res.boutique, loginPin);
      onSuccess(patronObj);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Erreur de connexion.');
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] w-full overflow-x-hidden overflow-y-auto bg-gradient-to-br from-[#EEF2FF] via-[#F8FAFC] to-[#F3E8FF] flex flex-col justify-center items-center px-3 py-4 sm:px-6 sm:py-8 select-none">
      {/* BARRE HAUTE PWA (Desktop + Mobile, masquée si déjà installée) */}
      {!isInstalled && (isInstallable || isIOS) && (
        <div className="w-full max-w-md lg:max-w-4xl flex items-center justify-end mb-2.5 sm:mb-3">
          <PWAInstallButton compactOnMobile={false} />
        </div>
      )}

      <div className="w-full max-w-md lg:max-w-4xl bg-white rounded-3xl shadow-xl border-2 border-gray-100 overflow-hidden grid grid-cols-1 lg:grid-cols-12">
        {/* PANNEAU GAUCHE DESKTOP */}
        <div className="hidden lg:flex lg:col-span-5 bg-gradient-to-br from-[#1E3A8A] via-[#1D4ED8] to-[#4338CA] text-white p-8 xl:p-10 flex-col justify-between relative overflow-hidden">
          <div className="space-y-6 relative z-10">
            <div className="flex items-center gap-3.5">
              <img
                src="/logo.png"
                alt="EFA ACONTA"
                className="w-16 h-16 rounded-2xl object-contain bg-white/15 p-1.5 drop-shadow-xl shrink-0"
              />
              <div>
                <h1 className="text-2xl xl:text-3xl font-black tracking-tight leading-tight">
                  EFA ACONTA
                </h1>
                <p className="text-xs font-bold text-blue-100">
                  Caisse Vocale & Tactile
                </p>
              </div>
            </div>

            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-400/20 border border-emerald-300/40 text-[11px] font-black text-emerald-100">
              <ShieldCheck className="w-4 h-4 shrink-0" />
              <span>ZÉRO GMAIL • ZÉRO EMAIL REQUIS</span>
            </div>

            <div className="space-y-3 pt-2">
              <div className="p-3.5 rounded-2xl bg-white/10 border border-white/15 backdrop-blur-xs">
                <p className="text-sm font-black flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-amber-300 shrink-0" />
                  <span>Gestion complète de boutique</span>
                </p>
                <p className="text-xs text-blue-100 mt-1 font-medium leading-relaxed">
                  Ventes rapides, stock, crédits clients, dépenses et multi-boutiques synchronisés en temps réel.
                </p>
              </div>

              <div className="p-3.5 rounded-2xl bg-white/10 border border-white/15 backdrop-blur-xs">
                <p className="text-sm font-black flex items-center gap-2">
                  <Smartphone className="w-4 h-4 text-emerald-300 shrink-0" />
                  <span>100% Hors-ligne & Cloud</span>
                </p>
                <p className="text-xs text-blue-100 mt-1 font-medium leading-relaxed">
                  Travaillez même sans internet et retrouvez vos données sur tous vos appareils.
                </p>
              </div>
            </div>
          </div>

          <div className="pt-6 border-t border-white/15 relative z-10">
            <p className="text-xs text-blue-100 font-semibold leading-relaxed">
              Connexion simple et sécurisée avec le nom de votre boutique et votre code PIN à 4 chiffres.
            </p>
          </div>
        </div>

        {/* PANNEAU DROIT FORMULAIRE (MOBILE + DESKTOP) */}
        <div className="lg:col-span-7 p-4 min-[380px]:p-5 sm:p-8 lg:p-10 space-y-5 min-w-0 flex flex-col justify-center">
          {/* HEADER COMPACT MOBILE (< lg) */}
          <div className="lg:hidden text-center space-y-2">
            <img
              src="/logo.png"
              alt="EFA ACONTA"
              className="w-16 h-16 min-[380px]:w-20 min-[380px]:h-20 rounded-full mx-auto object-contain drop-shadow-xl transform active:scale-95 transition"
            />
            <h1 className="text-2xl sm:text-3xl font-black text-gray-900 tracking-tight leading-tight">
              EFA ACONTA
            </h1>
            <p className="text-xs sm:text-sm font-semibold text-gray-500">
              Caisse Vocale & Tactile • 100% Sécurisée
            </p>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-[11px] font-black text-emerald-700">
              <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
              <span>ZÉRO GMAIL • ZÉRO EMAIL REQUIS</span>
            </div>
          </div>

          {/* HEADER DESKTOP (>= lg) */}
          <div className="hidden lg:flex items-center justify-between pb-3 border-b border-gray-100">
            <div>
              <h2 className="text-xl font-black text-gray-900 tracking-tight">
                {view === 'landing'
                  ? 'Bienvenue sur votre caisse'
                  : view === 'create'
                  ? 'Créer votre boutique'
                  : 'Accéder à votre caisse'}
              </h2>
              <p className="text-xs font-semibold text-gray-500">
                {view === 'landing'
                  ? 'Choisissez une option pour démarrer'
                  : view === 'create'
                  ? '21 jours d’essai gratuit dès l’inscription'
                  : 'Entrez votre boutique et votre PIN à 4 chiffres'}
              </p>
            </div>
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-[10px] font-black text-emerald-700 shrink-0">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>100% SÉCURISÉ</span>
            </span>
          </div>

          {errorMsg && (
            <div className="p-3.5 sm:p-4 rounded-2xl bg-rose-50 border-2 border-rose-300 text-rose-800 text-xs sm:text-sm font-black text-center animate-in fade-in break-words">
              {errorMsg}
            </div>
          )}

          {/* 1. VUE LANDING : 2 BOUTONS */}
          {view === 'landing' && (
            <div className="space-y-3.5 sm:space-y-4 pt-1">
              <button
                type="button"
                onClick={() => {
                  setErrorMsg(null);
                  setView('create');
                }}
                className="w-full min-h-[60px] sm:min-h-[68px] py-3.5 sm:py-4 px-5 sm:px-6 rounded-2xl bg-[#6C5CE7] hover:bg-[#5b4bc4] active:scale-[0.98] text-white font-black text-base min-[380px]:text-lg sm:text-xl shadow-xl shadow-[#6C5CE7]/25 transition flex items-center justify-center gap-3 cursor-pointer touch-manipulation"
              >
                <Store className="w-5 h-5 sm:w-6 sm:h-6 stroke-[2.5] shrink-0" />
                <span>CRÉER MA BOUTIQUE</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setErrorMsg(null);
                  setView('login');
                }}
                className="w-full min-h-[60px] sm:min-h-[68px] py-3.5 sm:py-4 px-5 sm:px-6 rounded-2xl bg-white hover:bg-gray-50 active:scale-[0.98] text-gray-900 font-black text-base min-[380px]:text-lg sm:text-xl border-2 border-gray-300 shadow-md transition flex items-center justify-center gap-3 cursor-pointer touch-manipulation"
              >
                <KeyRound className="w-5 h-5 sm:w-6 sm:h-6 text-[#6C5CE7] stroke-[2.5] shrink-0" />
                <span>J'AI DÉJÀ UN COMPTE</span>
              </button>

              <div className="pt-1 text-center">
                <p className="text-[11px] sm:text-xs text-gray-400 font-semibold leading-relaxed">
                  Connectez-vous avec seulement le nom de votre boutique et votre code PIN à 4 chiffres.
                </p>
              </div>

              {/* SECTION TÉLÉCHARGER L'APPLICATION EFA ACONTA */}
              <div className="mt-3 pt-4 border-t border-gray-100 space-y-2.5">
                <div className="text-center">
                  <p className="text-xs sm:text-sm font-black text-slate-900">
                    Télécharger l'application EFA Aconta
                  </p>
                  <p className="text-[11px] text-slate-500 font-semibold mt-0.5">
                    Utilisez EFA Aconta comme une application rapide sur mobile et ordinateur
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <a
                    href={PLAY_STORE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full min-h-[46px] px-3.5 py-2.5 rounded-2xl bg-slate-900 hover:bg-slate-800 active:scale-[0.98] text-white font-black text-xs sm:text-sm shadow-sm transition flex items-center justify-center gap-2 cursor-pointer touch-manipulation"
                  >
                    <ExternalLink className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>Télécharger sur Google Play</span>
                  </a>

                  <button
                    type="button"
                    onClick={handleWebAppInstallClick}
                    className="w-full min-h-[46px] px-3.5 py-2.5 rounded-2xl bg-[#EEF2FF] hover:bg-indigo-100 active:scale-[0.98] text-[#1E3A8A] border-2 border-indigo-200 font-black text-xs sm:text-sm transition flex items-center justify-center gap-2 cursor-pointer touch-manipulation"
                  >
                    <Download className="w-4 h-4 text-[#1E3A8A] shrink-0" />
                    <span>Installer l'application Web</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 2. VUE CRÉATION DE BOUTIQUE */}
          {view === 'create' && (
            <form onSubmit={handleCreateSubmit} className="space-y-3.5 sm:space-y-4 animate-in fade-in">
              <div className="flex items-center justify-between pb-2 border-b border-gray-100">
                <button
                  type="button"
                  onClick={() => {
                    setErrorMsg(null);
                    setView('landing');
                  }}
                  className="text-xs font-black text-gray-500 hover:text-gray-900 flex items-center gap-1 cursor-pointer py-1 px-1 -ml-1 touch-manipulation"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>Retour</span>
                </button>
                <span className="text-xs font-black text-[#6C5CE7] uppercase tracking-wider">
                  Nouvelle Boutique
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div className="min-w-0">
                  <label className="block text-xs font-black text-gray-700 uppercase tracking-wide mb-1">
                    Nom de la boutique : *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ex : Dodo Shop, Aïcha Wax..."
                    value={createNomBoutique}
                    onChange={(e) => setCreateNomBoutique(e.target.value)}
                    className="w-full min-h-[48px] px-3.5 py-3 rounded-2xl border-2 border-gray-200 text-base font-bold focus:border-[#6C5CE7] outline-none text-gray-900 bg-gray-50/50"
                  />
                  {createNomBoutique && (
                    <p className="text-[11px] text-gray-400 mt-1 font-semibold truncate">
                      ID : <span className="font-mono text-[#6C5CE7] font-bold">{slugifyBoutiqueName(createNomBoutique)}</span>
                    </p>
                  )}
                </div>

                <div className="min-w-0">
                  <label className="block text-xs font-black text-gray-700 uppercase tracking-wide mb-1">
                    Ton prénom ({createGenre === 'homme' ? 'Patron' : 'Patronne'}) :
                  </label>
                  <input
                    type="text"
                    placeholder={createGenre === 'homme' ? 'Ex : Koffi, Kodjo...' : 'Ex : Aïcha, Akou...'}
                    value={createNomPatron}
                    onChange={(e) => setCreateNomPatron(e.target.value)}
                    className="w-full min-h-[48px] px-3.5 py-3 rounded-2xl border-2 border-gray-200 text-base font-bold focus:border-[#6C5CE7] outline-none text-gray-900 bg-gray-50/50"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-black text-gray-700 uppercase tracking-wide mb-1">
                  Genre : *
                </label>
                <div className="grid grid-cols-1 min-[340px]:grid-cols-2 gap-2.5 sm:gap-3">
                  <button
                    type="button"
                    onClick={() => setCreateGenre('homme')}
                    className={`min-h-[48px] p-3 rounded-2xl border-2 font-black text-xs sm:text-sm flex items-center justify-center gap-2 transition cursor-pointer touch-manipulation ${
                      createGenre === 'homme'
                        ? 'bg-blue-100 border-blue-600 text-blue-900 shadow-sm'
                        : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    <span className="text-xl">👨</span>
                    <span>Homme (Patron)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreateGenre('femme')}
                    className={`min-h-[48px] p-3 rounded-2xl border-2 font-black text-xs sm:text-sm flex items-center justify-center gap-2 transition cursor-pointer touch-manipulation ${
                      createGenre === 'femme'
                        ? 'bg-purple-100 border-[#6C5CE7] text-[#6C5CE7] shadow-sm'
                        : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    <span className="text-xl">👩</span>
                    <span>Femme (Patronne)</span>
                  </button>
                </div>
              </div>

              {/* PHOTO PATRON (Télécharger + Prendre photo, méthode identique employé) */}
              <div className="flex flex-col min-[380px]:flex-row items-center gap-3 py-2.5 px-3 rounded-2xl bg-gray-50/80 border border-gray-200">
                <div className="w-14 h-14 rounded-full bg-white flex items-center justify-center overflow-hidden border-2 border-[#6C5CE7]/40 shrink-0 shadow-xs">
                  {createPhotoUrl ? (
                    <img src={createPhotoUrl} alt="Photo patron" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-2xl">{createGenre === 'homme' ? '👨' : '👩'}</span>
                  )}
                </div>
                <div className="flex-1 min-w-0 w-full text-center min-[380px]:text-left">
                  <span className="block text-xs font-black text-gray-700 mb-1.5">
                    Photo patron (optionnel) :
                  </span>
                  <div className="flex flex-wrap items-center justify-center min-[380px]:justify-start gap-2">
                    <button
                      type="button"
                      onClick={handleCreateGallery}
                      className="px-3 py-2 rounded-xl bg-[#6C5CE7] hover:bg-[#5b4bc4] active:scale-95 text-xs font-black text-white cursor-pointer flex items-center gap-1.5 shadow-xs transition touch-manipulation"
                    >
                      <ImageIcon className="w-3.5 h-3.5 stroke-[2.5]" />
                      <span>Télécharger</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleCreateCamera}
                      className="px-3 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 active:scale-95 text-xs font-black text-white cursor-pointer flex items-center gap-1.5 shadow-xs transition touch-manipulation"
                    >
                      <Camera className="w-3.5 h-3.5 stroke-[2.5]" />
                      <span>Prendre photo</span>
                    </button>
                    {createPhotoUrl && (
                      <button
                        type="button"
                        onClick={() => setCreatePhotoUrl(undefined)}
                        className="px-2.5 py-2 rounded-xl bg-red-50 hover:bg-red-100 text-red-600 text-xs font-bold transition active:scale-95 cursor-pointer border border-red-200 touch-manipulation"
                      >
                        Retirer
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-black text-gray-700 uppercase tracking-wide mb-1 flex items-center justify-between gap-2">
                  <span>Numéro WhatsApp : *</span>
                  <span className="text-[10px] text-emerald-600 font-bold lowercase">assistance & caisse</span>
                </label>
                <div className="flex flex-col min-[380px]:flex-row items-stretch gap-2">
                  <select
                    value={createPhoneCountry}
                    onChange={(e) => setCreatePhoneCountry(e.target.value)}
                    aria-label="Indicatif pays WhatsApp"
                    className="w-full min-[380px]:w-[140px] sm:w-[165px] min-h-[48px] shrink-0 px-3 py-2.5 rounded-2xl border-2 border-gray-200 text-base sm:text-sm font-bold focus:border-[#6C5CE7] outline-none text-gray-900 bg-gray-50/50 cursor-pointer"
                  >
                    {COUNTRY_CODES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.flag} {c.code} ({c.country})
                      </option>
                    ))}
                  </select>
                  <input
                    type="tel"
                    inputMode="tel"
                    required
                    placeholder="90 00 00 00"
                    value={createWhatsapp}
                    onChange={(e) => setCreateWhatsapp(e.target.value)}
                    className="flex-1 min-w-0 min-h-[48px] px-3.5 py-3 rounded-2xl border-2 border-gray-200 text-base font-bold focus:border-[#6C5CE7] outline-none text-gray-900 bg-gray-50/50"
                  />
                </div>
                <p className="text-[11px] text-gray-400 mt-1 font-semibold">
                  Indicatif {createPhoneCountry} sélectionné • 8 chiffres minimum (ex : 90 00 00 00)
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div className="min-w-0">
                  <label className="block text-xs font-black text-gray-700 uppercase tracking-wide mb-1">
                    Code PIN Patron (4 chiffres) : *
                  </label>
                  <div className="relative">
                    <input
                      type={showCreatePin ? 'text' : 'password'}
                      inputMode="numeric"
                      maxLength={4}
                      required
                      placeholder="••••"
                      value={createPin}
                      onChange={(e) => setCreatePin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                      className="w-full min-h-[52px] px-4 py-3 pr-11 rounded-2xl border-2 border-gray-200 text-center text-2xl tracking-[0.35em] font-black focus:border-[#6C5CE7] outline-none text-gray-900 bg-gray-50/50"
                    />
                    <button
                      type="button"
                      onClick={() => setShowCreatePin(!showCreatePin)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 p-1 cursor-pointer"
                    >
                      {showCreatePin ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                </div>

                <div className="min-w-0">
                  <label className="block text-xs font-black text-gray-700 uppercase tracking-wide mb-1">
                    Confirmer le code PIN : *
                  </label>
                  <input
                    type={showCreatePin ? 'text' : 'password'}
                    inputMode="numeric"
                    maxLength={4}
                    required
                    placeholder="••••"
                    value={createConfirmPin}
                    onChange={(e) => setCreateConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    className="w-full min-h-[52px] px-4 py-3 rounded-2xl border-2 border-gray-200 text-center text-2xl tracking-[0.35em] font-black focus:border-[#6C5CE7] outline-none text-gray-900 bg-gray-50/50"
                  />
                </div>
              </div>

              <div className="pt-1">
                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full min-h-[52px] py-3.5 px-6 rounded-2xl bg-[#6C5CE7] hover:bg-[#5b4bc4] active:scale-[0.98] text-white font-black text-base sm:text-lg shadow-lg shadow-[#6C5CE7]/30 transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 touch-manipulation"
                >
                  <Check className="w-6 h-6 stroke-[3] shrink-0" />
                  <span>{isLoading ? 'Création...' : 'VALIDER ET ENTRER 🔥'}</span>
                </button>
              </div>
            </form>
          )}

          {/* 3. VUE J'AI DÉJÀ UN COMPTE */}
          {view === 'login' && (
            <form onSubmit={handleLoginSubmit} className="space-y-4 animate-in fade-in">
              <div className="flex items-center justify-between pb-2 border-b border-gray-100">
                <button
                  type="button"
                  onClick={() => {
                    setErrorMsg(null);
                    setView('landing');
                  }}
                  className="text-xs font-black text-gray-500 hover:text-gray-900 flex items-center gap-1 cursor-pointer py-1 px-1 -ml-1 touch-manipulation"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>Retour</span>
                </button>
                <span className="text-xs font-black text-emerald-600 uppercase tracking-wider">
                  Connexion Caisse
                </span>
              </div>

              <div>
                <label className="block text-xs font-black text-gray-700 uppercase tracking-wide mb-1">
                  Nom ou Identifiant de la boutique : *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex : Dodo Shop ou dodo-shop"
                  value={loginNomBoutique}
                  onChange={(e) => setLoginNomBoutique(e.target.value)}
                  className="w-full min-h-[48px] px-4 py-3 rounded-2xl border-2 border-gray-200 text-base font-bold focus:border-[#6C5CE7] outline-none text-gray-900 bg-gray-50/50"
                />
              </div>

              <div>
                <label className="block text-xs font-black text-gray-700 uppercase tracking-wide mb-1">
                  Code PIN Patron (4 chiffres) : *
                </label>
                <div className="relative">
                  <input
                    type={showLoginPin ? 'text' : 'password'}
                    inputMode="numeric"
                    maxLength={4}
                    required
                    placeholder="••••"
                    value={loginPin}
                    onChange={(e) => setLoginPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    className="w-full min-h-[56px] px-4 py-3 pr-12 rounded-2xl border-2 border-gray-200 text-center text-2xl sm:text-3xl tracking-[0.4em] font-black focus:border-[#6C5CE7] outline-none text-gray-900 bg-gray-50/50"
                  />
                  <button
                    type="button"
                    onClick={() => setShowLoginPin(!showLoginPin)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 p-1 cursor-pointer"
                  >
                    {showLoginPin ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full min-h-[52px] py-3.5 px-6 rounded-2xl bg-[#0A53FF] hover:bg-blue-700 active:scale-[0.98] text-white font-black text-base sm:text-lg shadow-lg shadow-blue-500/30 transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 touch-manipulation"
                >
                  <KeyRound className="w-5 h-5 sm:w-6 sm:h-6 shrink-0" />
                  <span>{isLoading ? 'Vérification...' : 'OUVRIR MA CAISSE 🔑'}</span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>

      {/* MODAL LIMITE APPAREILS ATTEINTE (MULTI-DEVICES) */}
      <DeviceLimitModal
        isOpen={limitModalData.isOpen}
        onClose={() => setLimitModalData((prev) => ({ ...prev, isOpen: false }))}
        plan={limitModalData.plan}
        activeCount={limitModalData.activeCount}
        maxAllowed={limitModalData.maxAllowed}
        activeDevices={limitModalData.activeDevices}
        onUpgrade={(targetPlan) => {
          setLimitModalData((prev) => ({ ...prev, isOpen: false }));
          if (onOpenSubscriptionModal) {
            onOpenSubscriptionModal(targetPlan, `Débloquer plus d'appareils pour ${targetPlan}`);
          }
        }}
      />

      <PWAInstallGuideModal
        isOpen={showInstallGuideModal}
        onClose={() => setShowInstallGuideModal(false)}
        isIOS={isIOS}
        isInstalled={isInstalled}
      />
    </div>
  );
};
