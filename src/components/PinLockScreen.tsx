import React, { useState, useEffect, useCallback } from 'react';
import { Lock, Shield, User, Delete, Check, AlertCircle, ArrowRight, RefreshCw, KeyRound } from 'lucide-react';
import type { Patron, Employe, CurrentUser } from '../lib/types';
import { verifyPin } from '../lib/security';
import { speakFrench } from '../lib/speech';
import { supabase } from '../lib/supabase';
import { db } from '../lib/db';

interface PinLockScreenProps {
  patron: Patron;
  employes: Employe[];
  currentUser?: CurrentUser | null;
  onUnlock: (user: CurrentUser) => void;
  onSwitchUser?: (newUser: CurrentUser) => void;
}

export const PinLockScreen: React.FC<PinLockScreenProps> = ({
  patron,
  employes,
  currentUser,
  onUnlock,
  onSwitchUser,
}) => {
  // Utilisateur actuellement sélectionné pour le déverrouillage
  const [selectedUser, setSelectedUser] = useState<{
    id: string;
    nom: string;
    role: 'patron' | 'vendeuse';
    genre: 'femme' | 'homme';
    photo_url?: string;
    pin_hash: string;
    pin_code?: string;
    code_pin?: string;
  }>(() => {
    if (currentUser) {
      if (currentUser.role === 'patron') {
        return {
          id: patron.id,
          nom: patron.nom,
          role: 'patron',
          genre: patron.genre || 'femme',
          photo_url: patron.photo_url,
          pin_hash: patron.pin_hash,
          pin_code: patron.pin_code,
          code_pin: patron.pin_code,
        };
      }
      const foundEmp = employes.find((e) => e.id === currentUser.id);
      const isBlocked = foundEmp?.is_blocked || foundEmp?.status === 'blocked' || foundEmp?.is_active === false;
      const isDeleted = foundEmp?.is_deleted || foundEmp?.status === 'deleted';
      if (foundEmp && !isBlocked && !isDeleted) {
        return {
          id: foundEmp.id,
          nom: foundEmp.nom,
          role: 'vendeuse',
          genre: foundEmp.genre || 'femme',
          photo_url: foundEmp.photo_url,
          pin_hash: foundEmp.pin_hash,
          pin_code: foundEmp.pin_code,
          code_pin: foundEmp.code_pin,
        };
      }
    }
    // Par défaut, Patron
    return {
      id: patron.id,
      nom: patron.nom,
      role: 'patron',
      genre: patron.genre || 'femme',
      photo_url: patron.photo_url,
      pin_hash: patron.pin_hash,
      pin_code: patron.pin_code,
      code_pin: patron.pin_code,
    };
  });

  const [enteredPin, setEnteredPin] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);

  // Vérification du code PIN quand 4 chiffres sont tapés
  const verifyEnteredPin = useCallback(
    async (pinToVerify: string) => {
      if (pinToVerify.length !== 4) return;
      setIsVerifying(true);
      setErrorMsg(null);

      if (selectedUser.role !== 'patron') {
        const emp = employes.find((e) => e.id === selectedUser.id);
        const isBlocked = emp?.is_blocked || emp?.status === 'blocked' || emp?.is_active === false;
        const isDeleted = emp?.is_deleted || emp?.status === 'deleted';
        if (isBlocked || isDeleted) {
          setErrorMsg("Compte bloqué. Vous êtes bloqué pour le moment.");
          speakFrench("Compte bloqué par le patron.");
          setEnteredPin('');
          setIsVerifying(false);
          return;
        }
      }

      try {
        let isMatch = false;

        // 1. Vérification par comparaison directe de pin_code / code_pin
        const rawCode = selectedUser.code_pin || selectedUser.pin_code;
        if (rawCode && pinToVerify === rawCode) {
          isMatch = true;
        }

        // 2. Vérification par hash bcrypt
        if (!isMatch && selectedUser.pin_hash) {
          isMatch = await verifyPin(pinToVerify, selectedUser.pin_hash);
        }

        // 3. Override de sécurité : le code PIN du patron déverrouille toujours
        if (!isMatch) {
          const patronRaw = patron.pin_code;
          if (patronRaw && pinToVerify === patronRaw) {
            isMatch = true;
          } else if (patron.pin_hash) {
            isMatch = await verifyPin(pinToVerify, patron.pin_hash);
          }
        }

        if (isMatch) {
          localStorage.setItem('efa_aconta_locked', 'false');
          const unlockedUser: CurrentUser = {
            id: selectedUser.id,
            nom: selectedUser.nom,
            role: selectedUser.role,
            genre: selectedUser.genre,
            photo_url: selectedUser.photo_url,
          };
          localStorage.setItem('efa_active_user_id', selectedUser.id);
          if (selectedUser.role === 'patron') {
            localStorage.setItem('efa_patron_pin', pinToVerify);
            sessionStorage.setItem('efa_patron_pin', pinToVerify);
            patron.pin_code = pinToVerify;
            patron.code_pin = pinToVerify;
            db.patrons.update(patron.id, { pin_code: pinToVerify, code_pin: pinToVerify }).catch(() => {});
          }
          speakFrench(`Bonjour ${selectedUser.nom}, session déverrouillée`);

          // Mise à jour de l'activité de cet appareil
          try {
            const currentDeviceId = localStorage.getItem('efa_device_id');
            if (currentDeviceId) {
              await supabase
                .from('efa_devices')
                .update({ last_seen: new Date().toISOString() })
                .eq('boutique_id', patron.id)
                .eq('device_id', currentDeviceId);
            }
          } catch (deviceUpdateErr) {
            console.warn('[PinLock] Activité appareil non synchronisée:', deviceUpdateErr);
          }

          onUnlock(unlockedUser);
        } else {
          try {
            if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
              navigator.vibrate(200);
            }
          } catch {}
          setErrorMsg('Code PIN incorrect. Réessaie !');
          setEnteredPin('');
        }
      } catch (err) {
        console.error('Erreur vérification PIN:', err);
        setErrorMsg('Erreur de vérification.');
        setEnteredPin('');
      } finally {
        setIsVerifying(false);
      }
    },
    [selectedUser, patron, onUnlock]
  );

  // Écoute clavier physique sur desktop ou mobile
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isVerifying) return;
      if (/^[0-9]$/.test(e.key)) {
        if (enteredPin.length < 4) {
          const next = enteredPin + e.key;
          setEnteredPin(next);
          if (next.length === 4) {
            verifyEnteredPin(next);
          }
        }
      } else if (e.key === 'Backspace') {
        setEnteredPin((prev) => prev.slice(0, -prev.length ? -1 : 0));
        setErrorMsg(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enteredPin, isVerifying, verifyEnteredPin]);

  const handleDigitPress = (digit: string) => {
    if (isVerifying) return;
    if (enteredPin.length < 4) {
      const next = enteredPin + digit;
      setEnteredPin(next);
      setErrorMsg(null);
      if (next.length === 4) {
        verifyEnteredPin(next);
      }
    }
  };

  const handleBackspace = () => {
    if (isVerifying) return;
    setEnteredPin((prev) => prev.slice(0, -1));
    setErrorMsg(null);
  };

  const handleClear = () => {
    if (isVerifying) return;
    setEnteredPin('');
    setErrorMsg(null);
  };

  return (
    <div className="fixed inset-0 z-[99999] bg-[#0A53FF] text-white flex flex-col justify-between p-4 sm:p-6 select-none overflow-y-auto">
      {/* Header avec Logo EFA ACONTA */}
      <div className="w-full max-w-md mx-auto flex items-center justify-between pt-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="group focus:outline-none transition-transform active:scale-95 cursor-pointer"
            title="EFA ACONTA"
            aria-label="Logo EFA ACONTA"
          >
            <img
              src="/logo.png"
              alt="EFA ACONTA"
              className="h-8 sm:h-9 w-auto rounded-xl object-contain drop-shadow-lg shadow-black/20 group-hover:scale-105 transition"
              onError={(e) => {
                e.currentTarget.onerror = null;
                e.currentTarget.src = '/logo-efa.png';
              }}
            />
          </button>
          <div>
            <h1 className="text-lg font-black tracking-wider leading-none">EFA ACONTA</h1>
            <p className="text-[11px] font-bold text-blue-200 uppercase tracking-widest mt-0.5">
              {patron.nom_boutique || 'Gestion Caisse Sécurisée'}
            </p>
          </div>
        </div>

        <div className="px-3 py-1 rounded-full bg-blue-700/60 border border-blue-400/40 text-xs font-black flex items-center gap-1.5 shadow-sm">
          <Lock className="w-3.5 h-3.5 text-blue-200" />
          <span>VERROUILLÉ</span>
        </div>
      </div>

      {/* Message discret rouge en haut si l'employé sélectionné est bloqué */}
      {selectedUser.role !== 'patron' && employes.some((e) => e.id === selectedUser.id && (e.is_blocked || e.status === 'blocked' || e.is_active === false || e.is_deleted || e.status === 'deleted')) && (
        <div className="w-full max-w-md mx-auto mt-2 py-2 px-4 rounded-full bg-red-600 text-white text-xs font-black flex items-center justify-center gap-2 shadow-lg border border-red-400 animate-in fade-in">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>Vous êtes bloqué pour le moment</span>
        </div>
      )}

      {/* Carte centrale Utilisateur & PIN */}
      <div className="w-full max-w-sm mx-auto my-auto py-4 flex flex-col items-center text-center space-y-4">
        {/* Avatar de l'utilisateur actif */}
        <div className="relative group">
          {selectedUser.photo_url ? (
            <img
              src={selectedUser.photo_url}
              alt={selectedUser.nom}
              className="w-20 h-20 rounded-3xl object-cover border-4 border-white shadow-2xl mx-auto"
            />
          ) : (
            <div className="w-20 h-20 rounded-3xl bg-white text-[#0A53FF] flex items-center justify-center font-black text-3xl shadow-2xl mx-auto border-4 border-white">
              {selectedUser.role === 'patron' ? '👑' : selectedUser.nom.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="absolute -bottom-2 -right-2 bg-yellow-400 text-yellow-950 p-1.5 rounded-full shadow-md text-xs font-black">
            <KeyRound className="w-4 h-4" />
          </div>
        </div>

        <div>
          <h2 className="text-2xl font-black tracking-tight">{selectedUser.nom}</h2>
          <p className="text-xs font-black uppercase text-blue-200 tracking-wider">
            {selectedUser.role === 'patron' ? '👑 Patron (Accès Total)' : '👤 Vendeur(se)'}
          </p>
        </div>

        {/* Message d'erreur */}
        {errorMsg ? (
          <div className="p-2.5 px-4 rounded-2xl bg-red-500 text-white font-black text-xs flex items-center gap-2 shadow-lg animate-bounce">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{errorMsg}</span>
          </div>
        ) : (
          <p className="text-xs font-bold text-blue-100">
            Tape ton code secret à 4 chiffres pour continuer
          </p>
        )}

        {/* Indicateur des 4 chiffres PIN */}
        <div className="flex items-center justify-center gap-4 py-2">
          {[0, 1, 2, 3].map((idx) => {
            const hasChar = enteredPin.length > idx;
            return (
              <div
                key={idx}
                className={`w-5 h-5 rounded-full transition-all duration-200 ${
                  hasChar
                    ? 'bg-yellow-300 scale-125 shadow-lg shadow-yellow-300/50'
                    : 'bg-blue-800/80 border-2 border-blue-400/40'
                }`}
              />
            );
          })}
        </div>

        {/* CLAVIER NUMÉRIQUE TACTILE (0 à 9, Effacer, Vider) */}
        <div className="grid grid-cols-3 gap-3 w-full max-w-[280px] pt-1">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
            <button
              key={digit}
              type="button"
              disabled={isVerifying}
              onClick={() => handleDigitPress(digit)}
              className="h-16 rounded-2xl bg-white/10 hover:bg-white/20 active:bg-white/30 text-white font-black text-2xl flex items-center justify-center shadow-md border border-white/10 active:scale-90 transition-all cursor-pointer touch-manipulation"
            >
              {digit}
            </button>
          ))}
          <button
            type="button"
            disabled={isVerifying || enteredPin.length === 0}
            onClick={handleClear}
            className="h-16 rounded-2xl bg-white/5 hover:bg-white/15 text-blue-200 font-bold text-xs flex items-center justify-center border border-white/10 active:scale-90 transition-all cursor-pointer touch-manipulation"
          >
            Vider
          </button>
          <button
            type="button"
            disabled={isVerifying}
            onClick={() => handleDigitPress('0')}
            className="h-16 rounded-2xl bg-white/10 hover:bg-white/20 active:bg-white/30 text-white font-black text-2xl flex items-center justify-center shadow-md border border-white/10 active:scale-90 transition-all cursor-pointer touch-manipulation"
          >
            0
          </button>
          <button
            type="button"
            disabled={isVerifying || enteredPin.length === 0}
            onClick={handleBackspace}
            className="h-16 rounded-2xl bg-white/10 hover:bg-white/20 active:bg-white/30 text-white font-bold text-lg flex items-center justify-center border border-white/10 active:scale-90 transition-all cursor-pointer touch-manipulation"
            title="Effacer"
          >
            <Delete className="w-6 h-6 stroke-[2.5]" />
          </button>
        </div>

        {/* Bouton Changer d'utilisateur si quelqu'un d'autre prend la caisse */}
        <div className="pt-2">
          <button
            type="button"
            onClick={() => setIsSwitching(!isSwitching)}
            className="text-xs font-bold text-blue-200 hover:text-white underline inline-flex items-center gap-1 cursor-pointer transition"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Changer d'utilisateur ({employes.length + 1} profil(s))</span>
          </button>

          {/* Liste déroulante des utilisateurs disponibles */}
          {isSwitching && (
            <div className="mt-3 p-2 bg-blue-900/90 rounded-2xl border border-blue-400/30 space-y-1 max-w-[280px] mx-auto animate-in fade-in duration-150">
              {/* Option Patron */}
              <button
                type="button"
                onClick={() => {
                  setSelectedUser({
                    id: patron.id,
                    nom: patron.nom,
                    role: 'patron',
                    genre: patron.genre || 'femme',
                    photo_url: patron.photo_url,
                    pin_hash: patron.pin_hash,
                    pin_code: patron.pin_code,
                    code_pin: patron.pin_code,
                  });
                  setEnteredPin('');
                  setErrorMsg(null);
                  setIsSwitching(false);
                }}
                className={`w-full p-2 rounded-xl text-left font-bold text-xs flex items-center gap-2 transition ${
                  selectedUser.id === patron.id ? 'bg-yellow-400 text-yellow-950 font-black' : 'hover:bg-blue-800'
                }`}
              >
                <span>👑</span>
                <span className="truncate">{patron.nom} (Patron)</span>
              </button>

              {/* Options Employés */}
              {employes.map((emp) => {
                const isBlocked = emp.is_blocked || emp.status === 'blocked' || emp.is_active === false || emp.is_deleted || emp.status === 'deleted';
                return (
                  <button
                    key={emp.id}
                    type="button"
                    onClick={() => {
                      if (isBlocked) {
                        setErrorMsg("Compte bloqué. Vous êtes bloqué pour le moment.");
                        speakFrench("Compte bloqué par le patron.");
                        return;
                      }
                      setSelectedUser({
                        id: emp.id,
                        nom: emp.nom,
                        role: 'vendeuse',
                        genre: emp.genre || 'femme',
                        photo_url: emp.photo_url,
                        pin_hash: emp.pin_hash,
                        pin_code: emp.pin_code,
                        code_pin: emp.code_pin,
                      });
                      setEnteredPin('');
                      setErrorMsg(null);
                      setIsSwitching(false);
                    }}
                    className={`w-full p-2 rounded-xl text-left font-bold text-xs flex items-center justify-between transition ${
                      selectedUser.id === emp.id ? 'bg-yellow-400 text-yellow-950 font-black' : 'hover:bg-blue-800'
                    } ${isBlocked ? 'opacity-60 cursor-not-allowed' : ''}`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <span>👤</span>
                      <span className="truncate">{emp.nom} ({emp.genre === 'femme' ? 'Vendeuse' : 'Vendeur'})</span>
                    </div>
                    {isBlocked && (
                      <span className="px-1.5 py-0.5 rounded bg-red-600 text-white text-[10px] font-black shrink-0">
                        Bloqué
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Bas de page avec statut sécurisé */}
      <div className="text-center text-[11px] font-bold text-blue-200/80 pb-2">
        Sécurité EFA ACONTA • Déverrouillage hors-ligne actif (Mode Avion disponible)
      </div>
    </div>
  );
};

export default PinLockScreen;
