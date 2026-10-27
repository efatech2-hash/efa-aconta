import React, { useEffect, useState } from 'react';
import { Store } from 'lucide-react';

interface SplashScreenProps {
  onFinish?: () => void;
}

export const SplashScreen: React.FC<SplashScreenProps> = ({ onFinish }) => {
  const [progress, setProgress] = useState(0);
  const [imgError, setImgError] = useState(false);
  const [isFadingOut, setIsFadingOut] = useState(false);

  useEffect(() => {
    // Démarrer la barre de progression immédiatement après le montage
    const raf = requestAnimationFrame(() => {
      setProgress(100);
    });

    // Déclencher le fade-out à 2.7s pour une transition douce
    const fadeTimer = setTimeout(() => {
      setIsFadingOut(true);
    }, 2700);

    // Terminer à 3 secondes
    const finishTimer = setTimeout(() => {
      if (onFinish) onFinish();
    }, 3000);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(fadeTimer);
      clearTimeout(finishTimer);
    };
  }, [onFinish]);

  return (
    <div
      className={`fixed inset-0 z-[999999] flex flex-col items-center justify-between p-6 bg-gradient-to-br from-[#3B28B8] via-[#6C5CE7] to-[#8075E8] select-none text-white transition-opacity duration-300 ease-out ${
        isFadingOut ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
      style={{
        minHeight: '100dvh',
      }}
    >
      {/* Espaceur haut */}
      <div className="w-full h-8" />

      {/* Centre : Logo + Nom + Slogan */}
      <div className="flex flex-col items-center justify-center text-center px-4 -mt-6">
        <div className="relative mb-5 group">
          {/* Halo lumineux animé */}
          <div className="absolute -inset-4 bg-white/20 rounded-full blur-xl animate-pulse" />

          {/* Logo ou icône de repli */}
          {!imgError ? (
            <img
              src="/logo.png"
              alt="EFA ACONTA"
              onError={() => setImgError(true)}
              className="relative w-[120px] h-[120px] rounded-3xl object-contain drop-shadow-2xl animate-pulse transition-transform duration-1000 transform hover:scale-105"
            />
          ) : (
            <div className="relative w-[120px] h-[120px] rounded-3xl bg-white/15 backdrop-blur-md border border-white/30 flex items-center justify-center shadow-2xl animate-pulse">
              <Store className="w-16 h-16 text-white stroke-[2.5]" />
            </div>
          )}
        </div>

        <h1 className="text-3xl sm:text-4xl font-black tracking-wider drop-shadow-md text-white font-sans">
          EFA ACONTA
        </h1>

        <p className="mt-2 text-xs sm:text-sm font-semibold tracking-widest uppercase text-white/80">
          La caisse intelligente des commerçants
        </p>

        <div className="mt-4 flex items-center gap-2 text-xs font-medium text-white/75">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping inline-block" />
          <span>Chargement...</span>
        </div>
      </div>

      {/* Barre de chargement en bas de l'écran (20px du bas) */}
      <div className="w-full max-w-xs mx-auto pb-[20px] flex flex-col items-center gap-2">
        <div className="w-full h-[3px] bg-white/30 rounded-full overflow-hidden shadow-sm">
          <div
            className="h-full bg-white rounded-full transition-all duration-3000 ease-in-out"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="text-[10px] text-white/60 font-semibold tracking-wider">
          Initialisation rapide • 100% sécurisé
        </p>
      </div>
    </div>
  );
};

export default SplashScreen;
