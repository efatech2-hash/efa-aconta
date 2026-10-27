import React from 'react';
import { ArrowLeft } from 'lucide-react';

interface BoutonRetourProps {
  onBack: () => void;
  className?: string;
}

export const BoutonRetour: React.FC<BoutonRetourProps> = ({ onBack, className = '' }) => {
  return (
    <button
      type="button"
      onClick={onBack}
      className={`fixed top-4 left-4 z-[999] w-[48px] h-[48px] bg-white text-gray-900 rounded-full shadow-xl flex items-center justify-center active:scale-90 transition-transform touch-manipulation border border-gray-200 cursor-pointer hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#0A53FF] ${className}`}
      aria-label="Retour"
      title="Retour"
    >
      <ArrowLeft className="w-6 h-6 stroke-[2.5] text-gray-800" />
    </button>
  );
};

export default BoutonRetour;
