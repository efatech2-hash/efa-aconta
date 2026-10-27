import React, { useState, useEffect } from 'react';
import { Lock, Check, Clock, ShieldAlert } from 'lucide-react';
import type { CurrentUser } from '../lib/types';
import { getAccord } from '../lib/accord';

interface AutoLogoutPromptModalProps {
  isOpen: boolean;
  currentUser: CurrentUser;
  onStay: () => void;
  onLock: () => void;
  onLogout?: () => void; // compatibilité
}

export const AutoLogoutPromptModal: React.FC<AutoLogoutPromptModalProps> = ({
  isOpen,
  currentUser,
  onStay,
  onLock,
  onLogout,
}) => {
  const [secondsLeft, setSecondsLeft] = useState(10);
  const accord = getAccord(currentUser.genre);

  const handleTriggerLock = onLock || onLogout;

  useEffect(() => {
    if (!isOpen) {
      setSecondsLeft(10);
      return;
    }

    setSecondsLeft(10);
    const interval = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          if (handleTriggerLock) {
            handleTriggerLock();
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isOpen, handleTriggerLock]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md animate-in fade-in select-none">
      <div className="w-full max-w-md bg-white rounded-3xl p-6 sm:p-8 shadow-2xl border-4 border-[#6C5CE7] text-center space-y-4">
        <div className="w-16 h-16 rounded-full bg-purple-100 text-[#6C5CE7] mx-auto flex items-center justify-center shadow">
          <ShieldAlert className="w-9 h-9 stroke-[2.5]" />
        </div>

        <h3 className="text-2xl font-black text-gray-900">
          RESTER {accord.connecte.toUpperCase()} ?
        </h3>

        <p className="text-sm font-bold text-gray-600">
          Opération enregistrée ! Pour la sécurité de la caisse, la session va se verrouiller automatiquement.
        </p>

        {/* Compte à rebours 10 secondes */}
        <div className="p-3 rounded-2xl bg-amber-50 border-2 border-amber-300 flex items-center justify-center gap-2 text-amber-900">
          <Clock className="w-5 h-5 text-amber-600 animate-spin" />
          <span className="font-extrabold text-sm">
            Verrouillage automatique dans : <strong className="text-lg font-black font-mono text-red-600">{secondsLeft}s</strong>
          </span>
        </div>

        {/* Les 2 boutons RESTER / VERROUILLER */}
        <div className="grid grid-cols-2 gap-3 pt-2">
          <button
            type="button"
            onClick={onStay}
            className="min-h-[75px] rounded-2xl bg-[#00B894] hover:bg-emerald-600 active:scale-95 text-white font-black text-lg flex flex-col items-center justify-center gap-0.5 shadow-lg shadow-emerald-500/25 transition cursor-pointer"
          >
            <div className="flex items-center gap-1.5">
              <Check className="w-6 h-6 stroke-[3]" />
              <span>RESTER</span>
            </div>
            <span className="text-[11px] font-semibold opacity-90">Continuer</span>
          </button>

          <button
            type="button"
            onClick={handleTriggerLock}
            className="min-h-[75px] rounded-2xl bg-red-600 hover:bg-red-700 active:scale-95 text-white font-black text-lg flex flex-col items-center justify-center gap-0.5 shadow-lg shadow-red-500/25 transition cursor-pointer"
          >
            <div className="flex items-center gap-1.5">
              <Lock className="w-5 h-5 stroke-[2.5]" />
              <span>VERROUILLER</span>
            </div>
            <span className="text-[11px] font-semibold opacity-90">Écran PIN</span>
          </button>
        </div>
      </div>
    </div>
  );
};
