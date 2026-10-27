import React, { useState } from 'react';
import { Smartphone, Store, Check, Lock, ArrowRight, ShieldCheck, X } from 'lucide-react';
import type { Patron } from '../lib/types';
import { setDeviceStore, verifyPatronPin, clearDeviceStore } from '../lib/mesBoutiques';
import { speakFrench } from '../lib/speech';

interface DeviceStoreSelectModalProps {
  isOpen: boolean;
  patron: Patron;
  stores: Patron[];
  currentDeviceStoreId?: string | null;
  onSelectStore: (store: Patron) => void;
  onClose?: () => void;
  isChangeMode?: boolean; // Si ouvert via bouton "Changer"
}

export const DeviceStoreSelectModal: React.FC<DeviceStoreSelectModalProps> = ({
  isOpen,
  patron,
  stores,
  currentDeviceStoreId,
  onSelectStore,
  onClose,
  isChangeMode = false,
}) => {
  // Étape PIN requise si on change une boutique déjà verrouillée
  const [needsPin, setNeedsPin] = useState<boolean>(isChangeMode);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);

  if (!isOpen) return null;

  const handleVerifyPin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (pinInput.length < 4) {
      setPinError('Entrez votre code PIN patron à 4 chiffres.');
      return;
    }

    setIsVerifying(true);
    setPinError(null);

    const ok = await verifyPatronPin(pinInput, patron);
    setIsVerifying(false);

    if (ok) {
      setNeedsPin(false);
      setPinInput('');
    } else {
      setPinError('Code PIN patron incorrect.');
    }
  };

  const handleStoreClick = (store: Patron) => {
    setDeviceStore(store.id, store.nom_boutique);
    speakFrench(`Appareil verrouillé sur ${store.nom_boutique}`);
    onSelectStore(store);
  };

  const handleResetToAll = () => {
    clearDeviceStore();
    speakFrench('Verrouillage retiré. Mode boutique principale.');
    if (onClose) onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md animate-in fade-in select-none">
      <div className="w-full max-w-xl bg-white rounded-3xl p-6 sm:p-8 shadow-2xl border-4 border-[#6C5CE7] space-y-6 max-h-[92vh] overflow-y-auto">
        {/* En-tête */}
        <div className="text-center space-y-2">
          <div className="w-16 h-16 rounded-3xl bg-purple-100 text-[#6C5CE7] flex items-center justify-center mx-auto shadow-inner border-2 border-purple-200">
            <Smartphone className="w-9 h-9 stroke-[2.2]" />
          </div>

          <span className="inline-block px-3 py-1 rounded-full bg-purple-100 text-[#6C5CE7] font-black text-xs uppercase tracking-wider">
            Configuration Appareil • Pro
          </span>

          <h2 className="text-2xl sm:text-3xl font-black text-gray-900 leading-tight">
            Ce téléphone va afficher quelle boutique ?
          </h2>

          <p className="text-xs sm:text-sm font-bold text-gray-500 max-w-md mx-auto">
            Sélectionnez la boutique pour verrouiller cet appareil. Les données et les vendeurs seront automatiquement isolés pour ce point de vente.
          </p>
        </div>

        {/* Étape PIN si déverrouillage */}
        {needsPin ? (
          <form onSubmit={handleVerifyPin} className="space-y-4 pt-2">
            <div className="p-4 rounded-2xl bg-amber-50 border-2 border-amber-300 text-amber-900 text-xs font-bold flex items-center gap-2">
              <Lock className="w-5 h-5 text-amber-700 shrink-0" />
              <span>
                Sécurité patron : Entrez votre code PIN pour déverrouiller ou réassigner cet appareil.
              </span>
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-black uppercase text-gray-500">
                Code PIN Patron (4 chiffres)
              </label>
              <input
                type="password"
                maxLength={4}
                autoFocus
                value={pinInput}
                onChange={(e) => {
                  const val = e.target.value.replace(/[^0-9]/g, '');
                  setPinInput(val);
                  setPinError(null);
                  if (val.length === 4) {
                    verifyPatronPin(val, patron).then((ok) => {
                      if (ok) {
                        setNeedsPin(false);
                        setPinInput('');
                      } else {
                        setPinError('Code PIN patron incorrect.');
                      }
                    });
                  }
                }}
                placeholder="••••"
                className="w-full text-center text-3xl font-black tracking-widest p-4 rounded-2xl border-2 border-purple-200 focus:border-[#6C5CE7] focus:ring-4 focus:ring-purple-100 outline-none"
              />
              {pinError && (
                <p className="text-xs font-black text-red-600 text-center">{pinError}</p>
              )}
            </div>

            <div className="flex gap-2">
              {onClose && (
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 py-3 px-4 rounded-2xl bg-gray-100 text-gray-700 font-black text-sm hover:bg-gray-200 transition"
                >
                  Annuler
                </button>
              )}
              <button
                type="submit"
                disabled={isVerifying || pinInput.length < 4}
                className="flex-1 py-3 px-4 rounded-2xl bg-[#6C5CE7] text-white font-black text-sm hover:bg-[#5b4cc4] transition disabled:opacity-50"
              >
                {isVerifying ? 'Vérification...' : 'Déverrouiller'}
              </button>
            </div>
          </form>
        ) : (
          /* Liste des grosses cartes de boutiques cliquables */
          <div className="space-y-3">
            {stores.map((store, index) => {
              const isSelected = currentDeviceStoreId === store.id;
              const isMain = store.type === 'MAIN' || !store.parentId;

              return (
                <button
                  key={store.id}
                  type="button"
                  onClick={() => handleStoreClick(store)}
                  className={`w-full p-5 rounded-3xl border-3 text-left flex items-center justify-between transition group cursor-pointer shadow-sm hover:shadow-md active:scale-[0.98] ${
                    isSelected
                      ? 'border-[#6C5CE7] bg-purple-50 ring-4 ring-purple-100'
                      : 'border-gray-200 bg-white hover:border-purple-300 hover:bg-purple-50/30'
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <div
                      className={`w-14 h-14 rounded-2xl flex items-center justify-center font-black text-xl shrink-0 transition ${
                        isMain
                          ? 'bg-amber-400 text-amber-950 border-2 border-amber-500 shadow-sm'
                          : 'bg-purple-100 text-[#6C5CE7] border-2 border-purple-200'
                      }`}
                    >
                      <Store className="w-7 h-7" />
                    </div>

                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-lg sm:text-xl font-black text-gray-900 block">
                          {store.nom_boutique}
                        </span>
                        {isMain ? (
                          <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-black uppercase">
                            Principale
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full bg-purple-100 text-[#6C5CE7] text-[10px] font-black uppercase">
                            Boutique {index + 1}
                          </span>
                        )}
                      </div>

                      <p className="text-xs font-bold text-gray-500 mt-0.5">
                        {isMain
                          ? 'Siège principal • Toutes les fonctionnalités débloquées'
                          : 'Point de vente secondaire • Interface vendeurs simplifiée'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {isSelected ? (
                      <span className="w-8 h-8 rounded-full bg-emerald-500 text-white flex items-center justify-center font-black shadow-md">
                        <Check className="w-5 h-5 stroke-[3]" />
                      </span>
                    ) : (
                      <span className="w-8 h-8 rounded-full bg-gray-100 text-gray-400 group-hover:bg-[#6C5CE7] group-hover:text-white flex items-center justify-center transition">
                        <ArrowRight className="w-4 h-4 stroke-[3]" />
                      </span>
                    )}
                  </div>
                </button>
              );
            })}

            {/* Option déverrouiller pour réinitialiser au mode principal */}
            {currentDeviceStoreId && (
              <div className="pt-2 text-center">
                <button
                  type="button"
                  onClick={handleResetToAll}
                  className="text-xs font-bold text-gray-400 hover:text-gray-700 underline cursor-pointer"
                >
                  Ne pas verrouiller cet appareil (mode libre patron)
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
