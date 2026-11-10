import React from 'react';
import { Check, X, Sparkles } from 'lucide-react';
import { speakFrench } from '../lib/speech';

interface ConfirmationModalProps {
  isOpen: boolean;
  summary: string;
  transcript: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
  isOpen,
  summary,
  transcript,
  onConfirm,
  onCancel,
}) => {
  if (!isOpen) return null;

  const handleYes = () => {
    speakFrench("C'est fait !");
    onConfirm();
  };

  const handleNo = () => {
    speakFrench("D'accord, redis.");
    onCancel();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm animate-in fade-in">
      <div className="w-full max-w-lg bg-white rounded-3xl p-6 sm:p-8 shadow-2xl border-4 border-[#6C5CE7] text-center transform scale-100 transition-all">
        {/* Header EFA a compris */}
        <div className="inline-flex items-center gap-2 px-5 py-2 rounded-full bg-[#6C5CE7]/15 text-[#6C5CE7] font-extrabold text-xl mb-4">
          <Sparkles className="w-7 h-7 text-[#6C5CE7] animate-spin" />
          <span>EFA A COMPRIS :</span>
        </div>

        {/* Action text - Police >= 20px */}
        <div className="bg-[#F8F9FA] border-2 border-gray-200 rounded-2xl p-5 mb-4">
          <p className="text-2xl sm:text-3xl font-black text-gray-900 leading-snug">
            "{summary}"
          </p>
          {transcript && transcript !== summary && (
            <p className="text-sm font-semibold text-gray-500 mt-2 italic">
              « {transcript} »
            </p>
          )}
        </div>

        <p className="text-lg font-bold text-gray-600 mb-6">
          Appuie sur OUI pour enregistrer, ou NON pour recommencer :
        </p>

        {/* Les 2 boutons OUI / NON géants >= 80px */}
        <div className="grid grid-cols-2 gap-4">
          {/* NON Rouge géant */}
          <button
            type="button"
            onClick={handleNo}
            className="min-h-[85px] py-4 px-4 rounded-2xl bg-[#D63031] hover:bg-red-700 active:scale-95 text-white font-black text-2xl flex flex-col items-center justify-center gap-1 shadow-lg shadow-red-500/30 transition border-2 border-red-600"
          >
            <div className="flex items-center gap-2">
              <X className="w-8 h-8 stroke-[3]" />
              <span>NON</span>
            </div>
            <span className="text-xs uppercase tracking-wider opacity-90 font-medium">
              Annuler
            </span>
          </button>

          {/* OUI Vert géant */}
          <button
            type="button"
            onClick={handleYes}
            className="min-h-[85px] py-4 px-4 rounded-2xl bg-[#00B894] hover:bg-emerald-600 active:scale-95 text-white font-black text-2xl flex flex-col items-center justify-center gap-1 shadow-lg shadow-emerald-500/30 transition border-2 border-emerald-500"
          >
            <div className="flex items-center gap-2">
              <Check className="w-8 h-8 stroke-[3]" />
              <span>OUI</span>
            </div>
            <span className="text-xs uppercase tracking-wider opacity-90 font-medium">
              Valider
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
