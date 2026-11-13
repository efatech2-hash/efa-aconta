import React, { useState } from 'react';
import { Download, Share, PlusSquare, Smartphone, X, CheckCircle2 } from 'lucide-react';
import { usePWAInstall } from '../lib/usePWAInstall';

interface PWAInstallGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
  isIOS: boolean;
  isInstalled?: boolean;
}

export const PWAInstallGuideModal: React.FC<PWAInstallGuideModalProps> = ({
  isOpen,
  onClose,
  isIOS,
  isInstalled = false,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Installer EFA Aconta"
    >
      <div className="bg-white rounded-3xl max-w-md w-full p-5 sm:p-6 shadow-2xl border-2 border-indigo-100 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <img
              src="/icon-192x192.png"
              alt="EFA Aconta"
              className="w-12 h-12 rounded-2xl border border-indigo-100 shadow-xs shrink-0"
            />
            <div>
              <h3 className="text-base sm:text-lg font-black text-slate-900 leading-tight">
                Installer l'application
              </h3>
              <p className="text-xs font-semibold text-slate-500">
                EFA Aconta sur votre écran d'accueil
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 cursor-pointer"
            aria-label="Fermer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {isInstalled ? (
          <div className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center gap-2.5 text-emerald-800 text-xs sm:text-sm font-bold">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <span>EFA Aconta est déjà installée sur cet appareil.</span>
          </div>
        ) : isIOS ? (
          <div className="space-y-2.5 text-xs sm:text-sm font-semibold text-slate-700 bg-indigo-50/70 border border-indigo-100 rounded-2xl p-4">
            <p className="font-black text-indigo-950">Sur iPhone / iPad (Safari) :</p>
            <div className="flex items-center gap-2.5">
              <span className="w-6 h-6 rounded-full bg-indigo-600 text-white text-xs font-black flex items-center justify-center shrink-0">
                1
              </span>
              <span className="flex items-center gap-1.5 flex-wrap">
                Appuyez sur <Share className="w-4 h-4 text-indigo-700 inline shrink-0" />{' '}
                <strong>Partager</strong> en bas de l'écran.
              </span>
            </div>
            <div className="flex items-center gap-2.5">
              <span className="w-6 h-6 rounded-full bg-indigo-600 text-white text-xs font-black flex items-center justify-center shrink-0">
                2
              </span>
              <span className="flex items-center gap-1.5 flex-wrap">
                Choisissez <PlusSquare className="w-4 h-4 text-indigo-700 inline shrink-0" />{' '}
                <strong>Sur l'écran d'accueil</strong>, puis <strong>Ajouter</strong>.
              </span>
            </div>
          </div>
        ) : (
          <div className="space-y-2.5 text-xs sm:text-sm font-semibold text-slate-700 bg-indigo-50/70 border border-indigo-100 rounded-2xl p-4">
            <p className="font-black text-indigo-950 flex items-center gap-1.5">
              <Smartphone className="w-4 h-4 text-indigo-700 shrink-0" />
              <span>Installation depuis votre navigateur :</span>
            </p>
            <p className="leading-relaxed">
              Ouvrez le menu de votre navigateur (Chrome, Edge ou Samsung Internet) puis sélectionnez{' '}
              <strong>« Installer l'application »</strong> ou{' '}
              <strong>« Ajouter à l'écran d'accueil »</strong>.
            </p>
          </div>
        )}

        <button
          type="button"
          onClick={onClose}
          className="w-full py-2.5 px-4 rounded-xl bg-[#1E3A8A] hover:bg-blue-900 text-white font-black text-sm transition cursor-pointer"
        >
          Compris
        </button>
      </div>
    </div>
  );
};

interface PWAInstallButtonProps {
  className?: string;
  compactOnMobile?: boolean;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  className = '',
  compactOnMobile = true,
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled || (!isInstallable && !isIOS)) {
    return null;
  }

  const handleClick = async () => {
    if (isInstallable) {
      const result = await install();
      if (result === 'unavailable' && isIOS) {
        setShowGuide(true);
      }
      return;
    }
    if (isIOS) {
      setShowGuide(true);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        title="Installer l'application"
        aria-label="Installer l'application"
        className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl bg-[#1E3A8A] hover:bg-blue-900 active:scale-[0.98] text-white text-[11px] sm:text-xs font-black shadow-xs transition shrink-0 cursor-pointer touch-manipulation ${className}`}
      >
        <Download className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
        {compactOnMobile ? (
          <>
            <span className="sm:hidden">Installer</span>
            <span className="hidden sm:inline">Installer l'application</span>
          </>
        ) : (
          <span>Installer l'application</span>
        )}
      </button>

      <PWAInstallGuideModal
        isOpen={showGuide}
        onClose={() => setShowGuide(false)}
        isIOS={isIOS}
        isInstalled={isInstalled}
      />
    </>
  );
};
