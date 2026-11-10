import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Volume2, X, AlertCircle } from 'lucide-react';
import { parseVoiceCommand, speakFrench } from '../lib/speech';
import type { ParsedVoiceCommand, Produit } from '../lib/types';

interface EFAVoiceAssistantProps {
  isOnline: boolean;
  products: Produit[];
  onCommandParsed: (cmd: ParsedVoiceCommand) => void;
  plan?: string;
  isPro?: boolean;
  onOpenSubscriptionModal?: (plan?: 'populaire' | 'pro', reason?: string) => void;
}

export const EFAVoiceAssistant: React.FC<EFAVoiceAssistantProps> = ({
  isOnline,
  products,
  onCommandParsed,
  plan,
  isPro,
  onOpenSubscriptionModal,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);

  // Initialize SpeechRecognition if available
  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = 'fr-FR';

      recognition.onstart = () => {
        setIsListening(true);
      };

      recognition.onresult = (event: any) => {
        let currentTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          currentTranscript += event.results[i][0].transcript;
        }
        setTranscript(currentTranscript);

        if (event.results[0].isFinal) {
          handleProcessVoiceText(currentTranscript);
        }
      };

      recognition.onerror = (event: any) => {
        console.warn('Speech error:', event.error);
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
    }
  }, [products]);

  const isBoutiquePro = isPro !== undefined ? isPro : (plan === 'pro' || plan === 'boutique_pro');

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 3500);
  };

  const handleFloatingClick = () => {
    if (!isBoutiquePro) {
      showToast("Fonction vocale réservée à l'offre Boutique Pro");
      if (onOpenSubscriptionModal) {
        onOpenSubscriptionModal('pro', "La reconnaissance vocale est réservée à l'offre Boutique Pro");
      }
      return;
    }

    if (!isOnline) {
      showToast('Hors ligne - Écriture manuelle seulement');
      return;
    }

    setIsOpen(true);
    setTranscript('');
    startListening();
  };

  const startListening = async () => {
    if (!isBoutiquePro) {
      showToast("Fonction vocale réservée à l'offre Boutique Pro");
      return;
    }

    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
      } catch (e) {
        console.warn('Microphone permission warning:', e);
      }
    }

    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {}
      try {
        recognitionRef.current.start();
        setIsListening(true);
      } catch (err) {
        console.warn('Unable to start speech recognition:', err);
      }
    }
  };

  const stopListening = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
    }
    setIsListening(false);
  };

  const handleProcessVoiceText = (text: string) => {
    stopListening();
    const parsed = parseVoiceCommand(text, products);
    if (parsed) {
      setIsOpen(false);
      onCommandParsed(parsed);
    } else {
      speakFrench("Je n'ai pas bien compris. Peux-tu répéter ?");
    }
  };

  // Simuler une phrase dictée au marché (par exemple si pas de micro physique sur PC de test)
  const simulateCommand = (sampleText: string) => {
    setTranscript(sampleText);
    handleProcessVoiceText(sampleText);
  };

  return (
    <>
      {/* Toast Notification Hors ligne / Info */}
      {toastMessage && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-[#D63031] text-white font-bold text-lg px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-3 animate-bounce">
          <AlertCircle className="w-7 h-7 flex-shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* RÈGLE D'OR #1: BOUTON VOCAL FLOTTANT EFA DÉBLOQUÉ EN PRO (MASQUÉ SELON LE PLAN) */}
      {isBoutiquePro && (
        <button
          type="button"
          onClick={handleFloatingClick}
          aria-label="Parler à l'assistante EFA"
          className={`fixed bottom-24 right-5 z-40 w-[72px] h-[72px] rounded-full flex items-center justify-center shadow-2xl transition-all transform active:scale-90 cursor-pointer ${
            isOnline
              ? 'bg-[#0A53FF] hover:bg-blue-700 text-white shadow-blue-500/50 animate-pulse'
              : 'bg-gray-400 text-gray-200 cursor-not-allowed opacity-80'
          }`}
        >
          {isOnline ? (
            <div className="relative flex items-center justify-center">
              <Mic className="w-9 h-9 stroke-[2.5]" />
              <span className="absolute -top-1 -right-1 flex h-4 w-4">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-4 w-4 bg-emerald-500"></span>
              </span>
            </div>
          ) : (
            <MicOff className="w-8 h-8" />
          )}
        </button>
      )}

      {/* BOTTOM SHEET "PARLE À EFA" */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-lg bg-white rounded-t-3xl sm:rounded-3xl p-6 sm:p-8 shadow-2xl border-t-4 sm:border-4 border-[#6C5CE7] max-h-[90vh] overflow-y-auto">
            {/* Header Bottom Sheet */}
            <div className="flex items-center justify-between pb-4 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-[#6C5CE7] text-white flex items-center justify-center shadow-md font-black text-xl">
                  EFA
                </div>
                <div>
                  <h3 className="text-2xl font-black text-gray-900 leading-tight">
                    Parle à EFA
                  </h3>
                  <p className="text-sm font-semibold text-[#6C5CE7]">
                    Assistante vocale en Français (fr-FR)
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  stopListening();
                  setIsOpen(false);
                }}
                className="w-12 h-12 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-600 font-bold"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Visualizer / Microphone Center */}
            <div className="my-6 text-center">
              <div
                onClick={() => {
                  if (isListening) stopListening();
                  else startListening();
                }}
                className={`mx-auto w-24 h-24 rounded-full flex items-center justify-center cursor-pointer transition-all shadow-xl ${
                  isListening
                    ? 'bg-red-500 text-white animate-pulse ring-8 ring-red-200 scale-110'
                    : 'bg-[#6C5CE7] text-white hover:bg-[#5848c9]'
                }`}
              >
                <Mic className="w-12 h-12 stroke-[2.5]" />
              </div>
              <p className="mt-3 text-lg font-extrabold text-gray-800">
                {isListening ? 'EFA t\'écoute... Parle maintenant !' : 'Touche le micro pour parler'}
              </p>
            </div>

            {/* Live Transcription Box */}
            <div className="bg-[#F8F9FA] rounded-2xl p-4 border-2 border-dashed border-[#6C5CE7]/40 min-h-[85px] flex items-center justify-center text-center">
              {transcript ? (
                <p className="text-xl font-black text-[#6C5CE7]">
                  « {transcript} »
                </p>
              ) : (
                <p className="text-base font-semibold text-gray-400 italic">
                  Dis par exemple : "Vends 2 pulls noirs à Koffi crédit 10000"
                </p>
              )}
            </div>

            {/* Exemples rapides de commandes vocales pour la boutique */}
            <div className="mt-5">
              <p className="text-xs uppercase font-extrabold tracking-wider text-gray-500 mb-2">
                Exemples rapides à tester en boutique :
              </p>
              <div className="grid grid-cols-1 gap-2">
                <button
                  type="button"
                  onClick={() => simulateCommand('Vends 2 pulls noirs à Koffi crédit 10000')}
                  className="text-left p-3 rounded-xl bg-purple-50 hover:bg-purple-100 text-purple-900 font-bold text-sm border border-purple-200 transition"
                >
                  🗣️ "Vends 2 pulls noirs à Koffi crédit 10000"
                </button>
                <button
                  type="button"
                  onClick={() => simulateCommand('Ajoute dépense loyer 50000')}
                  className="text-left p-3 rounded-xl bg-red-50 hover:bg-red-100 text-red-900 font-bold text-sm border border-red-200 transition"
                >
                  🗣️ "Ajoute dépense loyer 50000"
                </button>
                <button
                  type="button"
                  onClick={() => simulateCommand('Ajoute pull noir achat 3000 vente 5000 stock 10')}
                  className="text-left p-3 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-900 font-bold text-sm border border-amber-200 transition"
                >
                  🗣️ "Ajoute pull noir achat 3000 vente 5000 stock 10"
                </button>
                <button
                  type="button"
                  onClick={() => simulateCommand('Montre mon argent')}
                  className="text-left p-3 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-900 font-bold text-sm border border-blue-200 transition"
                >
                  🗣️ "Montre mon argent"
                </button>
              </div>
            </div>

            {/* Note d'encouragement */}
            <div className="mt-4 flex items-center justify-center gap-2 text-xs font-semibold text-gray-500">
              <Volume2 className="w-4 h-4 text-[#6C5CE7]" />
              <span>Chaque action vocale te demandera confirmation OUI / NON.</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
