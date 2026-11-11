import React, { useState } from 'react';
import { Store, KeyRound, User, ArrowLeft, Check, ShieldCheck, Sparkles, Smartphone, Eye, EyeOff } from 'lucide-react';
import { createBoutique, loginBoutique, slugifyBoutiqueName, type EfaBoutiqueRecord } from '../lib/deviceAuth';
import { DeviceLimitModal } from './DeviceLimitModal';
import type { Patron } from '../lib/types';
import { boutiqueToPatron } from '../lib/deviceAuth';

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

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!createNomBoutique.trim()) {
      setErrorMsg('Veuillez indiquer le nom de votre boutique.');
      return;
    }
    const cleanDigits = createWhatsapp.replace(/\D/g, '');
    if (!createWhatsapp.trim() || cleanDigits.length < 8) {
      setErrorMsg('Le numéro WhatsApp est obligatoire et doit comporter au moins 8 chiffres (ex : +228 90 00 00 00).');
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
        whatsappNumber: createWhatsapp.trim(),
        telephone: createWhatsapp.trim(),
        pin: createPin,
      });

      if (!res.success || !res.boutique) {
        setErrorMsg(res.error || 'Erreur lors de la création de la boutique.');
        setIsLoading(false);
        return;
      }

      const patronObj = boutiqueToPatron(res.boutique, createPin);
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
    <div className="min-h-screen bg-[#F8F9FA] flex flex-col justify-center items-center p-4 sm:p-6 select-none">
      <div className="w-full max-w-md bg-white rounded-3xl p-6 sm:p-8 shadow-xl border-2 border-gray-100 space-y-6">
        {/* LOGO & TITRE */}
        <div className="text-center space-y-2">
          <img
            src="/logo.png"
            alt="EFA ACONTA"
            className="w-20 h-20 rounded-full mx-auto object-contain drop-shadow-xl transform active:scale-95 transition"
          />
          <h1 className="text-2xl sm:text-3xl font-black text-gray-900 tracking-tight leading-tight">
            EFA ACONTA
          </h1>
          <p className="text-xs sm:text-sm font-semibold text-gray-500">
            Caisse Vocale & Tactile • 100% Sécurisée
          </p>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-[11px] font-black text-emerald-700">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>ZÉRO GMAIL • ZÉRO EMAIL REQUIS</span>
          </div>
        </div>

        {errorMsg && (
          <div className="p-4 rounded-2xl bg-rose-50 border-2 border-rose-300 text-rose-800 text-xs sm:text-sm font-black text-center animate-in fade-in">
            {errorMsg}
          </div>
        )}

        {/* 1. VUE LANDING : 2 BOUTONS */}
        {view === 'landing' && (
          <div className="space-y-4 pt-2">
            <button
              type="button"
              onClick={() => {
                setErrorMsg(null);
                setView('create');
              }}
              className="w-full min-h-[68px] py-4 px-6 rounded-2xl bg-[#6C5CE7] hover:bg-[#5b4bc4] active:scale-98 text-white font-black text-lg sm:text-xl shadow-xl shadow-[#6C5CE7]/25 transition flex items-center justify-center gap-3 cursor-pointer"
            >
              <Store className="w-6 h-6 stroke-[2.5]" />
              <span>CRÉER MA BOUTIQUE</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setErrorMsg(null);
                setView('login');
              }}
              className="w-full min-h-[68px] py-4 px-6 rounded-2xl bg-white hover:bg-gray-50 active:scale-98 text-gray-900 font-black text-lg sm:text-xl border-2 border-gray-300 shadow-md transition flex items-center justify-center gap-3 cursor-pointer"
            >
              <KeyRound className="w-6 h-6 text-[#6C5CE7] stroke-[2.5]" />
              <span>J'AI DÉJÀ UN COMPTE</span>
            </button>

            <div className="pt-4 text-center">
              <p className="text-[11px] text-gray-400 font-semibold leading-relaxed">
                Connectez-vous avec seulement le nom de votre boutique et votre code PIN à 4 chiffres.
              </p>
            </div>
          </div>
        )}

        {/* 2. VUE CRÉATION DE BOUTIQUE */}
        {view === 'create' && (
          <form onSubmit={handleCreateSubmit} className="space-y-4 animate-in fade-in">
            <div className="flex items-center justify-between pb-2 border-b border-gray-100">
              <button
                type="button"
                onClick={() => {
                  setErrorMsg(null);
                  setView('landing');
                }}
                className="text-xs font-black text-gray-500 hover:text-gray-900 flex items-center gap-1 cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Retour</span>
              </button>
              <span className="text-xs font-black text-[#6C5CE7] uppercase tracking-wider">
                Nouvelle Boutique
              </span>
            </div>

            <div>
              <label className="block text-xs font-black text-gray-700 uppercase tracking-wide mb-1">
                Nom de la boutique : *
              </label>
              <input
                type="text"
                required
                placeholder="Ex : Dodo Shop, Aïcha Wax..."
                value={createNomBoutique}
                onChange={(e) => setCreateNomBoutique(e.target.value)}
                className="w-full p-4 rounded-2xl border-2 border-gray-200 text-base font-bold focus:border-[#6C5CE7] outline-none text-gray-900 bg-gray-50/50"
              />
              {createNomBoutique && (
                <p className="text-[11px] text-gray-400 mt-1 font-semibold">
                  Identifiant : <span className="font-mono text-[#6C5CE7] font-bold">{slugifyBoutiqueName(createNomBoutique)}</span>
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs font-black text-gray-700 uppercase tracking-wide mb-1">
                Ton prénom ({createGenre === 'homme' ? 'Patron' : 'Patronne'}) :
              </label>
              <input
                type="text"
                placeholder={createGenre === 'homme' ? 'Ex : Koffi, Kodjo...' : 'Ex : Aïcha, Akou...'}
                value={createNomPatron}
                onChange={(e) => setCreateNomPatron(e.target.value)}
                className="w-full p-4 rounded-2xl border-2 border-gray-200 text-base font-bold focus:border-[#6C5CE7] outline-none text-gray-900 bg-gray-50/50"
              />
            </div>

            <div>
              <label className="block text-xs font-black text-gray-700 uppercase tracking-wide mb-1">
                Genre : *
              </label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setCreateGenre('homme')}
                  className={`p-3.5 rounded-2xl border-2 font-black text-xs sm:text-sm flex items-center justify-center gap-2 transition cursor-pointer ${
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
                  className={`p-3.5 rounded-2xl border-2 font-black text-xs sm:text-sm flex items-center justify-center gap-2 transition cursor-pointer ${
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

            <div>
              <label className="block text-xs font-black text-gray-700 uppercase tracking-wide mb-1 flex items-center justify-between">
                <span>Numéro WhatsApp : *</span>
                <span className="text-[10px] text-emerald-600 font-bold lowercase">assistance & caisse</span>
              </label>
              <input
                type="tel"
                inputMode="tel"
                required
                placeholder="+228..."
                value={createWhatsapp}
                onChange={(e) => setCreateWhatsapp(e.target.value)}
                className="w-full p-4 rounded-2xl border-2 border-gray-200 text-base font-bold focus:border-[#6C5CE7] outline-none text-gray-900 bg-gray-50/50"
              />
              <p className="text-[11px] text-gray-400 mt-1 font-semibold">
                8 chiffres minimum (ex : +228 90 00 00 00)
              </p>
            </div>

            <div>
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
                  className="w-full p-4 rounded-2xl border-2 border-gray-200 text-center text-2xl tracking-[0.4em] font-black focus:border-[#6C5CE7] outline-none text-gray-900 bg-gray-50/50"
                />
                <button
                  type="button"
                  onClick={() => setShowCreatePin(!showCreatePin)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 p-1 cursor-pointer"
                >
                  {showCreatePin ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            <div>
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
                className="w-full p-4 rounded-2xl border-2 border-gray-200 text-center text-2xl tracking-[0.4em] font-black focus:border-[#6C5CE7] outline-none text-gray-900 bg-gray-50/50"
              />
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-4 px-6 rounded-2xl bg-[#6C5CE7] hover:bg-[#5b4bc4] active:scale-98 text-white font-black text-lg shadow-lg shadow-[#6C5CE7]/30 transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                <Check className="w-6 h-6 stroke-[3]" />
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
                className="text-xs font-black text-gray-500 hover:text-gray-900 flex items-center gap-1 cursor-pointer"
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
                className="w-full p-4 rounded-2xl border-2 border-gray-200 text-base font-bold focus:border-[#6C5CE7] outline-none text-gray-900 bg-gray-50/50"
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
                  className="w-full p-4 rounded-2xl border-2 border-gray-200 text-center text-3xl tracking-[0.4em] font-black focus:border-[#6C5CE7] outline-none text-gray-900 bg-gray-50/50"
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
                className="w-full py-4 px-6 rounded-2xl bg-[#0A53FF] hover:bg-blue-700 active:scale-98 text-white font-black text-lg shadow-lg shadow-blue-500/30 transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                <KeyRound className="w-6 h-6" />
                <span>{isLoading ? 'Vérification...' : 'OUVRIR MA CAISSE 🔑'}</span>
              </button>
            </div>
          </form>
        )}
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
    </div>
  );
};
