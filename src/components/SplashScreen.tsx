import React, { useEffect, useState } from 'react';

interface SplashScreenProps {
  onFinish?: () => void;
}

export const SplashScreen: React.FC<SplashScreenProps> = ({ onFinish }) => {
  const [animStep, setAnimStep] = useState<number>(0);
  // 0: start (only blue background)
  // 1: ring appears (t ~ 100ms)
  // 2: coin 1 falls (t ~ 800ms)
  // 3: coin 2 falls (t ~ 1500ms)
  // 4: coin 3 falls (t ~ 2200ms)
  // 5: all stacked + gleam + text reveal (t ~ 2800ms)
  // 6: fade out transition (t ~ 3400ms)
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    // Progress bar animation
    const raf = requestAnimationFrame(() => {
      setProgress(100);
    });

    const t1 = setTimeout(() => setAnimStep(1), 100);   // Ring appears
    const t2 = setTimeout(() => setAnimStep(2), 750);   // Coin 1 drops
    const t3 = setTimeout(() => setAnimStep(3), 1450);  // Coin 2 drops
    const t4 = setTimeout(() => setAnimStep(4), 2150);  // Coin 3 drops
    const t5 = setTimeout(() => setAnimStep(5), 2800);  // Stack complete + shine
    const t6 = setTimeout(() => setAnimStep(6), 3400);  // Fade out
    const t7 = setTimeout(() => {
      if (onFinish) onFinish();
    }, 3750); // Finish into app

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
      clearTimeout(t5);
      clearTimeout(t6);
      clearTimeout(t7);
    };
  }, [onFinish]);

  const handleSkip = () => {
    setAnimStep(6);
    setTimeout(() => {
      if (onFinish) onFinish();
    }, 250);
  };

  return (
    <div
      onClick={handleSkip}
      className={`fixed inset-0 z-[999999] flex flex-col items-center justify-between p-6 select-none cursor-pointer overflow-hidden transition-all duration-400 ease-out ${
        animStep === 6 ? 'opacity-0 scale-105 pointer-events-none' : 'opacity-100 scale-100'
      }`}
      style={{
        background: 'radial-gradient(circle at 50% 40%, #154BC6 0%, #0A2E8A 50%, #041445 100%)',
        minHeight: '100dvh',
      }}
    >
      {/* Dynamic inline styles for 3D physics & animations */}
      <style>{`
        @keyframes ringEntry {
          0% {
            transform: scale(0.6) rotateX(25deg);
            opacity: 0;
            filter: drop-shadow(0 0 0 rgba(251,191,36,0));
          }
          60% {
            transform: scale(1.04) rotateX(-5deg);
            opacity: 1;
            filter: drop-shadow(0 15px 35px rgba(251,191,36,0.45));
          }
          100% {
            transform: scale(1) rotateX(0deg);
            opacity: 1;
            filter: drop-shadow(0 10px 25px rgba(0,0,0,0.5));
          }
        }

        @keyframes coinDrop1 {
          0% {
            transform: translateY(-380px) scale(1.3) rotateX(65deg) rotateZ(-15deg);
            opacity: 0;
          }
          65% {
            transform: translateY(22px) scale(1) rotateX(0deg) rotateZ(0deg);
            opacity: 1;
          }
          82% {
            transform: translateY(14px) scale(1.02) rotateX(-4deg);
          }
          100% {
            transform: translateY(20px) scale(1) rotateX(0deg);
            opacity: 1;
          }
        }

        @keyframes coinDrop2 {
          0% {
            transform: translateY(-400px) scale(1.25) rotateX(55deg) rotateZ(12deg);
            opacity: 0;
          }
          65% {
            transform: translateY(11px) scale(1) rotateX(0deg) rotateZ(0deg);
            opacity: 1;
          }
          82% {
            transform: translateY(6px) scale(1.02) rotateX(-3deg);
          }
          100% {
            transform: translateY(10px) scale(1) rotateX(0deg);
            opacity: 1;
          }
        }

        @keyframes coinDrop3 {
          0% {
            transform: translateY(-420px) scale(1.2) rotateX(50deg) rotateZ(-8deg);
            opacity: 0;
          }
          65% {
            transform: translateY(0px) scale(1) rotateX(0deg) rotateZ(0deg);
            opacity: 1;
          }
          82% {
            transform: translateY(-4px) scale(1.02) rotateX(-2deg);
          }
          100% {
            transform: translateY(0px) scale(1) rotateX(0deg);
            opacity: 1;
          }
        }

        @keyframes goldSheen {
          0% {
            transform: translateX(-150%) skewX(-25deg);
            opacity: 0;
          }
          30% {
            opacity: 0.85;
          }
          100% {
            transform: translateX(250%) skewX(-25deg);
            opacity: 0;
          }
        }

        @keyframes goldPulse {
          0%, 100% {
            transform: scale(1);
            filter: drop-shadow(0 10px 30px rgba(251,191,36,0.35));
          }
          50% {
            transform: scale(1.02);
            filter: drop-shadow(0 15px 45px rgba(251,191,36,0.65));
          }
        }

        @keyframes rippleBurst {
          0% {
            transform: scale(0.6);
            opacity: 0.9;
          }
          100% {
            transform: scale(1.4);
            opacity: 0;
          }
        }

        @keyframes ambientFloat {
          0%, 100% {
            transform: translateY(0px);
          }
          50% {
            transform: translateY(-6px);
          }
        }
      `}</style>

      {/* Particules d'or subtiles en arrière-plan */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden opacity-30">
        <div className="absolute top-[15%] left-[20%] w-2 h-2 rounded-full bg-amber-300 blur-[1px] animate-pulse" />
        <div className="absolute top-[30%] right-[18%] w-1.5 h-1.5 rounded-full bg-yellow-200 blur-[1px] animate-ping" />
        <div className="absolute top-[65%] left-[25%] w-2 h-2 rounded-full bg-amber-400 blur-[1px] animate-pulse" />
        <div className="absolute top-[50%] right-[28%] w-1 h-1 rounded-full bg-amber-200" />
      </div>

      {/* Espaceur haut */}
      <div className="w-full h-4" />

      {/* CENTRE : SCÈNE 3D DE L'ANNEAU ET DES 3 PIÈCES */}
      <div className="flex flex-col items-center justify-center text-center px-4 -mt-2">
        {/* Conteneur 3D avec perspective */}
        <div
          className="relative w-[180px] h-[180px] sm:w-[210px] h-[210px] flex items-center justify-center mb-6"
          style={{ perspective: '1000px' }}
        >
          {/* Halo lumineux doré d'arrière-plan */}
          <div
            className={`absolute -inset-6 rounded-full bg-amber-400/20 blur-2xl transition-all duration-700 pointer-events-none ${
              animStep >= 1 ? 'opacity-100 scale-100' : 'opacity-0 scale-75'
            } ${animStep >= 4 ? 'bg-amber-400/35 blur-3xl' : ''}`}
          />

          {/* Onde de choc lors de l'impact des pièces */}
          {(animStep === 2 || animStep === 3 || animStep === 4) && (
            <div
              key={`ripple-${animStep}`}
              className="absolute inset-0 rounded-full border-2 border-amber-300/80 pointer-events-none"
              style={{ animation: 'rippleBurst 0.6s ease-out forwards' }}
            />
          )}

          {/* 1. L'ANNEAU OR APPARAÎT (avec fond bleu dégradé à l'intérieur) */}
          <div
            className={`absolute inset-0 rounded-full overflow-hidden transition-all duration-700 ${
              animStep >= 1 ? 'opacity-100' : 'opacity-0'
            }`}
            style={{
              animation: animStep >= 1 ? 'ringEntry 0.75s cubic-bezier(0.16, 1, 0.3, 1) forwards' : 'none',
            }}
          >
            {/* Image de fond + anneau or (ou anneau isolé avec fond bleu royal) */}
            <img
              src="/splash-ring.png"
              alt="Anneau EFA ACONTA"
              className="w-full h-full object-contain pointer-events-none select-none"
              onError={(e) => {
                // Si /splash-ring.png a un souci, repli sur /logo.png
                e.currentTarget.src = '/logo.png';
              }}
            />

            {/* Brillance spéculaire sur l'anneau or */}
            {animStep >= 5 && (
              <div
                className="absolute inset-0 pointer-events-none"
                style={{
                  background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.65) 50%, transparent 100%)',
                  animation: 'goldSheen 1.2s ease-in-out infinite',
                }}
              />
            )}
          </div>

          {/* 2. LES 3 PIÈCES TOMBENT UNE À UNE (1, 2, 3) */}
          {animStep < 5 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              {/* PIÈCE 1 (Fond de la pile) */}
              {animStep >= 2 && (
                <div
                  className="absolute w-[58%] h-auto transition-transform"
                  style={{
                    animation: 'coinDrop1 0.65s cubic-bezier(0.25, 1, 0.5, 1) forwards',
                  }}
                >
                  <img
                    src="/gold-coin.png"
                    alt="Pièce 1"
                    className="w-full h-auto object-contain drop-shadow-[0_8px_12px_rgba(0,0,0,0.6)]"
                  />
                </div>
              )}

              {/* PIÈCE 2 (Milieu de la pile) */}
              {animStep >= 3 && (
                <div
                  className="absolute w-[58%] h-auto transition-transform"
                  style={{
                    animation: 'coinDrop2 0.65s cubic-bezier(0.25, 1, 0.5, 1) forwards',
                  }}
                >
                  <img
                    src="/gold-coin.png"
                    alt="Pièce 2"
                    className="w-full h-auto object-contain drop-shadow-[0_8px_14px_rgba(0,0,0,0.65)]"
                  />
                </div>
              )}

              {/* PIÈCE 3 (Haut de la pile, avec E gravé au centre) */}
              {animStep >= 4 && (
                <div
                  className="absolute w-[58%] h-auto transition-transform"
                  style={{
                    animation: 'coinDrop3 0.65s cubic-bezier(0.25, 1, 0.5, 1) forwards',
                  }}
                >
                  <img
                    src="/gold-coin.png"
                    alt="Pièce 3"
                    className="w-full h-auto object-contain drop-shadow-[0_12px_20px_rgba(0,0,0,0.7)]"
                  />
                </div>
              )}
            </div>
          )}

          {/* 3. LOGO COMPLET REVEAL (Une fois les 3 pièces empilées, rendu parfait 1024x1024) */}
          {animStep >= 5 && (
            <div
              className="absolute inset-0 rounded-full transition-opacity duration-300 animate-in fade-in"
              style={{
                animation: 'goldPulse 2.5s ease-in-out infinite',
              }}
            >
              <img
                src="/logo.png"
                alt="EFA ACONTA"
                className="w-full h-full object-contain rounded-full drop-shadow-[0_15px_30px_rgba(0,0,0,0.6)] pointer-events-none select-none"
              />
              {/* Balayage de lumière dorée sur tout le logo */}
              <div
                className="absolute inset-0 rounded-full pointer-events-none overflow-hidden"
              >
                <div
                  className="w-full h-full"
                  style={{
                    background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.7) 50%, transparent 100%)',
                    animation: 'goldSheen 1.3s ease-out forwards',
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* TITRE & SLOGAN avec apparition élégante */}
        <div
          className={`transition-all duration-700 transform ${
            animStep >= 1 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
          }`}
        >
          <h1 className="text-3xl sm:text-4xl font-black tracking-wider drop-shadow-[0_4px_12px_rgba(0,0,0,0.6)] text-white font-sans flex items-center justify-center gap-2">
            <span>EFA ACONTA</span>
          </h1>

          <p className="mt-2 text-xs sm:text-sm font-bold tracking-widest uppercase text-blue-100 drop-shadow-sm">
            La caisse intelligente des commerçants
          </p>

          {/* Indicateur de chargement & statut */}
          <div className="mt-4 flex items-center justify-center gap-2 text-xs font-semibold text-blue-200">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping inline-block" />
            <span>
              {animStep < 5 ? "Initialisation de la caisse..." : "Prêt ! Bienvenue"}
            </span>
          </div>
        </div>
      </div>

      {/* BARRE DE CHARGEMENT AU BAS DE L'ÉCRAN */}
      <div className="w-full max-w-xs mx-auto pb-4 flex flex-col items-center gap-2.5">
        <div className="w-full h-[4px] bg-white/20 rounded-full overflow-hidden shadow-inner backdrop-blur-xs">
          <div
            className="h-full bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-400 rounded-full transition-all duration-3000 ease-out shadow-[0_0_8px_rgba(251,191,36,0.8)]"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex items-center justify-between w-full text-[10px] text-blue-200/80 font-bold tracking-wider">
          <span>100% SÉCURISÉ • HORS-LIGNE</span>
          <span className="text-amber-300">TOUCHER POUR ENTRER</span>
        </div>
      </div>
    </div>
  );
};

export default SplashScreen;
