import React, { useState, useEffect } from 'react';
import { Crown, Lock, User, AlertTriangle, Delete, Ban, Check } from 'lucide-react';
import type { Patron, Employe, CurrentUser } from '../lib/types';
import { verifyPin, checkBruteForceStatus, registerFailedAttempt, resetFailedAttempts } from '../lib/security';
import { speakFrench } from '../lib/speech';
import { getAccord } from '../lib/accord';
import { logAction } from '../lib/historique';

interface WhoIsSellingModalProps {
  isOpen: boolean;
  patron: Patron;
  employes: Employe[];
  currentUser?: CurrentUser | null;
  onSelectUser: (user: CurrentUser) => void;
  onClose?: () => void;
  canClose?: boolean;
}

export const WhoIsSellingModal: React.FC<WhoIsSellingModalProps> = ({
  isOpen,
  patron,
  employes,
  currentUser,
  onSelectUser,
  onClose,
  canClose = false,
}) => {
  const [selectedCandidate, setSelectedCandidate] = useState<{
    id: string;
    nom: string;
    role: 'patron' | 'vendeuse';
    genre: 'femme' | 'homme';
    photo_url?: string;
    pin_hash: string;
  } | null>(null);

  const [enteredPin, setEnteredPin] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [bruteForceInfo, setBruteForceInfo] = useState(checkBruteForceStatus());

  // Timer for brute-force lock countdown
  useEffect(() => {
    if (!isOpen) return;
    const interval = setInterval(() => {
      setBruteForceInfo(checkBruteForceStatus());
    }, 1000);
    return () => clearInterval(interval);
  }, [isOpen]);

  if (!isOpen) return null;

  const currentAccord = currentUser ? getAccord(currentUser.genre) : getAccord(patron.genre);

  const handleSelectAvatar = (candidate: {
    id: string;
    nom: string;
    role: 'patron' | 'vendeuse';
    genre: 'femme' | 'homme';
    photo_url?: string;
    pin_hash: string;
  }) => {
    if (bruteForceInfo.isLocked) return;
    setSelectedCandidate(candidate);
    setEnteredPin('');
    setErrorMsg(null);
  };

  const handleDigitClick = (digit: string) => {
    if (enteredPin.length < 4) {
      const nextPin = enteredPin + digit;
      setEnteredPin(nextPin);
      if (nextPin.length === 4) {
        verifyEnteredPin(nextPin);
      }
    }
  };

  const handleDeleteDigit = () => {
    setEnteredPin((prev) => prev.slice(0, -1));
    setErrorMsg(null);
  };

  const verifyEnteredPin = async (pin: string) => {
    if (!selectedCandidate) return;

    setIsChecking(true);
    setErrorMsg(null);

    const isMatch = await verifyPin(pin, selectedCandidate.pin_hash);

    if (isMatch) {
      resetFailedAttempts();
      setBruteForceInfo(checkBruteForceStatus());
      const candAccord = getAccord(selectedCandidate.genre);
      speakFrench(`Bonjour ${candAccord.roleAccorde(selectedCandidate.role)} ${selectedCandidate.nom}`);

      // MODIF 1: Log historique de connexion
      logAction({
        patron_id: patron.id,
        user_id: selectedCandidate.id,
        employe_id: selectedCandidate.role === 'patron' ? null : selectedCandidate.id,
        employe_nom: selectedCandidate.role === 'patron' ? undefined : selectedCandidate.nom,
        action_type: 'connexion',
        description: `Connexion à la caisse de ${selectedCandidate.role === 'patron' ? 'Patron' : selectedCandidate.nom}`,
      }).catch(console.error);

      onSelectUser({
        id: selectedCandidate.id,
        nom: selectedCandidate.nom,
        role: selectedCandidate.role,
        genre: selectedCandidate.genre,
        photo_url: selectedCandidate.photo_url,
      });
      setSelectedCandidate(null);
      setEnteredPin('');
    } else {
      const status = registerFailedAttempt();
      setBruteForceInfo(status);
      setEnteredPin('');
      if (status.isLocked) {
        setErrorMsg('5 erreurs ! Caisse bloquée pendant 15 minutes.');
        speakFrench('Attention, caisse bloquée 15 minutes.');
      } else {
        setErrorMsg(`Code PIN incorrect ! Plus que ${status.attemptsLeft} essai(s).`);
        speakFrench('Code PIN incorrect.');
      }
    }
    setIsChecking(false);
  };

  const formatCountdown = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins}m ${secs < 10 ? '0' : ''}${secs}s`;
  };

  const patronAccord = getAccord(patron.genre);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/85 p-4 backdrop-blur-md select-none"
      onClick={(e) => {
        if (e.target === e.currentTarget && canClose && onClose && !bruteForceInfo.isLocked) {
          onClose();
        }
      }}
    >
      <div
        className="w-full max-w-lg bg-white rounded-3xl p-6 sm:p-8 shadow-2xl border-4 border-[#6C5CE7] text-center"
        onClick={(e) => e.stopPropagation()}
      >
        {/* CORRECTION 4 : En-tête QUI VEND avec sous-texte accordé */}
        <div className="mb-6">
          <div className="w-16 h-16 rounded-3xl bg-[#6C5CE7]/15 text-[#6C5CE7] mx-auto flex items-center justify-center mb-3">
            <Lock className="w-9 h-9" />
          </div>
          <h2 className="text-3xl font-black text-gray-900">QUI VEND ?</h2>
          <p className="text-sm font-bold text-gray-500 mt-1">
            {currentUser
              ? `Actuellement ${currentAccord.connecte} en tant que ${currentAccord.roleAccorde(currentUser.role)}`
              : 'Sélectionne ton profil pour déverrouiller la caisse'}
          </p>
        </div>

        {/* ALERTE BLOCAGE ANTI-BRUTE FORCE */}
        {bruteForceInfo.isLocked && (
          <div className="mb-6 p-4 rounded-2xl bg-red-100 border-2 border-red-500 text-red-700">
            <AlertTriangle className="w-10 h-10 mx-auto text-red-600 mb-2 animate-bounce" />
            <h4 className="text-xl font-black">SÉCURITÉ ANTI-INTRUSION ACTIVÉE</h4>
            <p className="text-sm font-bold mt-1">
              5 faux codes PIN détectés. Déblocage automatique dans :
            </p>
            <div className="text-3xl font-black text-red-600 mt-2 font-mono">
              {formatCountdown(bruteForceInfo.remainingSeconds)}
            </div>
          </div>
        )}

        {/* Étape 1 : Choix de l'avatar */}
        {!selectedCandidate && !bruteForceInfo.isLocked && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* Patronne / Patron (avec couronne) */}
              <button
                type="button"
                onClick={() =>
                  handleSelectAvatar({
                    id: patron.id,
                    nom: patron.nom,
                    role: 'patron',
                    genre: patron.genre,
                    photo_url: patron.photo_url,
                    pin_hash: patron.pin_hash,
                  })
                }
                className="p-5 rounded-2xl bg-amber-50 hover:bg-amber-100 border-4 border-amber-400 flex flex-col items-center justify-center transition-all transform active:scale-95 shadow-md"
              >
                <div className="relative mb-2">
                  {patron.photo_url ? (
                    <img
                      src={patron.photo_url}
                      alt={patron.nom}
                      className="w-20 h-20 rounded-full object-cover border-2 border-amber-500 shadow"
                    />
                  ) : (
                    <div className="w-20 h-20 rounded-full bg-gradient-to-tr from-amber-500 to-yellow-400 text-white flex items-center justify-center text-3xl font-black shadow">
                      {patron.nom.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="absolute -top-3 -right-2 bg-yellow-400 p-1.5 rounded-full shadow-lg border-2 border-white">
                    <Crown className="w-6 h-6 text-yellow-900 fill-yellow-400" />
                  </div>
                </div>
                <span className="text-xl font-black text-gray-900">{patron.nom}</span>
                <span className="text-xs font-black uppercase text-amber-700 tracking-wider mt-1">
                  👑 {patronAccord.titrePatron}
                </span>
              </button>

              {/* Employés */}
              {employes.map((emp) => {
                const empAccord = getAccord(emp.genre);
                const isBlocked = emp.is_blocked || emp.status === 'blocked' || emp.is_active === false || emp.is_deleted || emp.status === 'deleted';

                return (
                  <button
                    key={emp.id}
                    type="button"
                    onClick={() => {
                      if (isBlocked) {
                        speakFrench('Compte bloqué par le patron.');
                        setErrorMsg('Compte bloqué. Vous êtes bloqué pour le moment.');
                        return;
                      }
                      handleSelectAvatar({
                        id: emp.id,
                        nom: emp.nom,
                        role: 'vendeuse',
                        genre: emp.genre,
                        photo_url: emp.photo_url,
                        pin_hash: emp.pin_hash,
                      });
                    }}
                    className={`p-5 rounded-2xl border-4 flex flex-col items-center justify-center transition-all transform active:scale-95 shadow-md relative ${
                      isBlocked
                        ? 'bg-gray-100 border-gray-300 opacity-60 cursor-not-allowed'
                        : 'bg-purple-50 hover:bg-purple-100 border-purple-300'
                    }`}
                  >
                    {isBlocked && (
                      <div className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-orange-100 border border-orange-300 text-orange-800 text-[10px] font-black flex items-center gap-1 shadow-sm">
                        <Ban className="w-3 h-3" />
                        Bloqué
                      </div>
                    )}
                    <div className="w-20 h-20 rounded-full bg-gradient-to-tr from-[#6C5CE7] to-indigo-400 text-white flex items-center justify-center text-3xl font-black shadow mb-2 overflow-hidden">
                      {emp.photo_url ? (
                        <img
                          src={emp.photo_url}
                          alt={emp.nom}
                          className={`w-full h-full object-cover ${isBlocked ? 'grayscale' : ''}`}
                        />
                      ) : (
                        emp.nom.charAt(0).toUpperCase()
                      )}
                    </div>
                    <span className="text-xl font-black text-gray-900">{emp.nom}</span>
                    <span className="text-xs font-black uppercase text-[#6C5CE7] tracking-wider mt-1">
                      {empAccord.titreVendeur}
                    </span>
                  </button>
                );
              })}
            </div>

            {employes.length === 0 && (
              <p className="text-xs font-bold text-gray-400 italic">
                (Aucun employé supplémentaire pour l'instant. Tu peux en créer 3 max)
              </p>
            )}
          </div>
        )}

        {/* Étape 2 : Saisie du PIN à 4 chiffres */}
        {selectedCandidate && !bruteForceInfo.isLocked && (
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <div className="flex items-center gap-2 text-left">
                <div className="w-10 h-10 rounded-full bg-[#6C5CE7] text-white flex items-center justify-center font-bold">
                  {selectedCandidate.nom.charAt(0).toUpperCase()}
                </div>
                <div>
                  <h4 className="text-lg font-black text-gray-900">{selectedCandidate.nom}</h4>
                  <p className="text-xs font-bold text-gray-500">Tape ton code PIN à 4 chiffres</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedCandidate(null)}
                className="text-sm font-bold text-gray-500 underline hover:text-gray-800"
              >
                Changer
              </button>
            </div>

            {/* Indicateurs de PIN (4 ronds) */}
            <div className="flex justify-center gap-4 my-3">
              {[0, 1, 2, 3].map((idx) => (
                <div
                  key={idx}
                  className={`w-6 h-6 rounded-full border-2 transition-all ${
                    enteredPin.length > idx
                      ? 'bg-[#6C5CE7] border-[#6C5CE7] scale-110 shadow-md'
                      : 'border-gray-300 bg-gray-100'
                  }`}
                />
              ))}
            </div>

            {errorMsg && (
              <p className="text-sm font-black text-red-600 animate-shake">
                {errorMsg}
              </p>
            )}

            {/* Clavier numérique tactile géant */}
            <div className="grid grid-cols-3 gap-3 max-w-xs mx-auto">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
                <button
                  key={digit}
                  type="button"
                  onClick={() => handleDigitClick(digit)}
                  disabled={isChecking}
                  className="h-16 rounded-2xl bg-gray-100 hover:bg-gray-200 active:bg-[#6C5CE7] active:text-white text-2xl font-black text-gray-900 transition flex items-center justify-center shadow-sm"
                >
                  {digit}
                </button>
              ))}
              <div />
              <button
                type="button"
                onClick={() => handleDigitClick('0')}
                disabled={isChecking}
                className="h-16 rounded-2xl bg-gray-100 hover:bg-gray-200 active:bg-[#6C5CE7] active:text-white text-2xl font-black text-gray-900 transition flex items-center justify-center shadow-sm"
              >
                0
              </button>
              <button
                type="button"
                onClick={handleDeleteDigit}
                className="h-16 rounded-2xl bg-red-100 hover:bg-red-200 active:bg-red-300 text-red-700 font-bold transition flex items-center justify-center shadow-sm"
              >
                <Delete className="w-7 h-7" />
              </button>
            </div>

            {/* Bouton Confirmer vert */}
            <button
              type="button"
              onClick={() => verifyEnteredPin(enteredPin)}
              disabled={enteredPin.length !== 4 || isChecking}
              className={`w-full max-w-xs mx-auto min-h-[54px] rounded-2xl font-black text-lg flex items-center justify-center gap-2 shadow-lg transition mt-4 ${
                enteredPin.length === 4 && !isChecking
                  ? 'bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white shadow-emerald-500/30'
                  : 'bg-emerald-600/40 text-white/70 cursor-not-allowed'
              }`}
            >
              <Check className="w-6 h-6 stroke-[3]" />
              <span>Confirmer</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
