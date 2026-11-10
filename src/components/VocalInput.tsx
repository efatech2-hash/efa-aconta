import React, { useState, useRef, useEffect } from 'react';
import { Mic, MicOff, Search, X, Loader2 } from 'lucide-react';

interface VocalInputProps {
  value: string;
  onChange: (val: string) => void;
  onResult?: (transcript: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  plan?: string;
  isPro?: boolean;
  onUpgradeRequired?: () => void;
}

export const VocalInput: React.FC<VocalInputProps> = ({
  value,
  onChange,
  onResult,
  placeholder = 'Rechercher un article ou dis un mot...',
  className = '',
  autoFocus = false,
  plan,
  isPro,
  onUpgradeRequired,
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);

  const isBoutiquePro = isPro !== undefined ? isPro : (plan === 'pro' || plan === 'boutique_pro');

  // Nettoyage au démontage
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {}
      }
    };
  }, []);

  const handleMicro = (e?: React.MouseEvent) => {
    if (e) e.preventDefault();
    if (!isBoutiquePro) {
      const msg = "Fonction vocale réservée à l'offre Boutique Pro";
      setErrorMessage(msg);
      if (onUpgradeRequired) {
        onUpgradeRequired();
      }
      return;
    }
    handleStartListening();
  };

  const handleStartListening = async () => {
    if (!isBoutiquePro) {
      setErrorMessage("Fonction vocale réservée à l'offre Boutique Pro");
      if (onUpgradeRequired) {
        onUpgradeRequired();
      }
      return;
    }

    // Si déjà en cours, arrêter
    if (isRecording) {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {}
      }
      setIsRecording(false);
      return;
    }

    setErrorMessage(null);

    // Vérifier support Web Speech API
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      const msg = 'Micro non supporté sur ce navigateur, utilise Chrome sur Android';
      alert(msg);
      setErrorMessage(msg);
      return;
    }

    // Demande de permission microphone au préalable (Chrome Android & iOS)
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // Arrêter le stream test immédiatement après accord de permission
        stream.getTracks().forEach((track) => track.stop());
      } catch (micErr) {
        console.warn('Microphone permission refusée:', micErr);
        // On continue quand même vers SpeechRecognition car certains navigateurs gèrent les perms directement
      }
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.lang = 'fr-FR'; // Français standard (compris par Togo, Bénin, CI, etc.)
      recognition.continuous = false;
      recognition.interimResults = false;

      recognition.onstart = () => {
        setIsRecording(true);
        setErrorMessage(null);
      };

      recognition.onresult = (event: any) => {
        if (event.results && event.results[0] && event.results[0][0]) {
          const transcript = event.results[0][0].transcript.trim();
          onChange(transcript);
          if (onResult) {
            onResult(transcript);
          }
        }
      };

      recognition.onerror = (e: any) => {
        console.log('Erreur speech recognition:', e);
        setIsRecording(false);
        if (e.error === 'not-allowed') {
          setErrorMessage('Permission micro refusée. Autorise le micro dans ton navigateur.');
        } else if (e.error === 'no-speech') {
          setErrorMessage('Aucune parole détectée. Réessaie en parlant plus fort.');
        }
      };

      recognition.onend = () => {
        setIsRecording(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err: any) {
      console.error('Erreur démarrage reconnaissance:', err);
      setIsRecording(false);
      setErrorMessage("Impossible d'activer le micro. Réessaie sur Chrome.");
    }
  };

  return (
    <div className={`relative w-full ${className}`}>
      <div className="relative flex items-center">
        {/* Icône Loupe à gauche */}
        <div className="absolute left-3.5 pointer-events-none text-gray-400">
          <Search className="w-5 h-5" />
        </div>

        {/* Input texte */}
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={isRecording ? '🎙️ Parle maintenant... EFA écoute' : placeholder}
          autoFocus={autoFocus}
          className={`w-full pl-11 pr-24 py-3 sm:py-3.5 rounded-2xl border-2 text-base font-bold transition outline-none shadow-sm ${
            isRecording
              ? 'border-red-500 bg-red-50 text-red-900 ring-2 ring-red-200 placeholder-red-400'
              : 'border-gray-300 bg-white text-gray-900 focus:border-[#6C5CE7] focus:ring-2 focus:ring-purple-100 placeholder-gray-400'
          }`}
        />

        {/* Boutons d'action à droite (Effacer X + Micro) */}
        <div className="absolute right-2 flex items-center gap-1.5">
          {value && (
            <button
              type="button"
              onClick={() => onChange('')}
              className="w-8 h-8 rounded-full hover:bg-gray-200 active:bg-gray-300 text-gray-500 flex items-center justify-center transition"
              title="Effacer"
            >
              <X className="w-4 h-4" />
            </button>
          )}

          {/* Bouton Micro : Actif UNIQUEMENT si boutique_pro, sinon masqué selon le plan */}
          {isBoutiquePro && (
            <button
              type="button"
              onClick={handleMicro}
              className={`min-h-[44px] min-w-[44px] px-3 py-2 rounded-xl font-black text-xs flex items-center justify-center gap-1.5 transition active:scale-95 shadow-sm cursor-pointer ${
                isRecording
                  ? 'bg-red-600 text-white animate-pulse ring-4 ring-red-300 shadow-red-500/40'
                  : 'bg-blue-100 text-[#0A53FF] hover:bg-blue-200 active:bg-blue-300'
              }`}
              title={isRecording ? 'Arrêter le micro' : 'Parler pour chercher'}
            >
              {isRecording ? (
                <>
                  <Mic className="w-5 h-5 text-white animate-bounce" />
                  <span className="hidden sm:inline font-bold">Écoute...</span>
                </>
              ) : (
                <>
                  <Mic className="w-5 h-5" />
                  <span className="hidden sm:inline font-bold">Micro</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Message d'erreur discret si micro bloqué */}
      {errorMessage && (
        <p className="text-xs font-bold text-red-600 mt-1 pl-2 animate-in fade-in">
          ⚠️ {errorMessage}
        </p>
      )}
    </div>
  );
};
