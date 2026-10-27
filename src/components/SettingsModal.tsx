import React, { useState, useEffect } from 'react';
import {
  KeyRound,
  Shield,
  Smartphone,
  Check,
  X,
  AlertCircle,
  LogOut,
  ToggleLeft,
  ToggleRight,
  Send,
  MessageSquare,
  Pencil,
  Store,
  User,
  Users,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Eye,
  EyeOff,
  Camera,
  Image as ImageIcon,
  Cloud,
  RefreshCw,
  Crown,
  Sparkles,
  CheckCircle2,
  Trash2,
  Laptop,
} from 'lucide-react';
import type { Patron, CurrentUser, Employe } from '../lib/types';
import { verifyPin, hashPin } from '../lib/security';
import { db } from '../lib/db';
import { queueSyncItem } from '../lib/sync';
import { speakFrench } from '../lib/speech';
import { supabase } from '../lib/supabase';
import { logAction } from '../lib/historique';
import { BoutonRetour } from './BoutonRetour';
import { takePhotoFromCamera, pickPhotoFromGallery } from '../lib/camera';
import {
  getBoutiqueDevices,
  disconnectDevice,
  getDeviceId,
  DEVICE_LIMITS,
  type EfaDeviceRecord,
} from '../lib/deviceAuth';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  patron: Patron;
  currentUser: CurrentUser;
  employes?: Employe[];
  onLogout: () => void;
  onPatronUpdated: (updated: Patron) => void;
  onOpenSubscriptionModal?: (plan?: 'populaire' | 'pro', reason?: string) => void;
  onDataRefresh?: () => void;
  onNavigate?: (tab: 'home' | 'vendre' | 'mon-argent' | 'stock' | 'ajouter' | 'employes' | 'ambassadrice' | 'mes-ventes' | 'historique' | 'mon-abonnement') => void;
  onOpenMonAbonnementModal?: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  patron,
  currentUser,
  employes = [],
  onLogout,
  onPatronUpdated,
  onOpenSubscriptionModal,
  onDataRefresh,
  onNavigate,
  onOpenMonAbonnementModal,
}) => {
  // Changement de PIN
  const [isChangingPin, setIsChangingPin] = useState(false);
  const [oldPin, setOldPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinFeedback, setPinFeedback] = useState<string | null>(null);
  const [isPinSuccess, setIsPinSuccess] = useState(false);

  // OTP Reset WhatsApp
  const [isOtpResetMode, setIsOtpResetMode] = useState(false);
  const [generatedOtp, setGeneratedOtp] = useState<string | null>(null);
  const [enteredOtp, setEnteredOtp] = useState('');
  const [otpResetNewPin, setOtpResetNewPin] = useState('');
  const [otpFeedback, setOtpFeedback] = useState<string | null>(null);

  // Préférence auto-déconnexion
  const [autoLogout, setAutoLogout] = useState(patron.auto_logout_after_action ?? true);

  // MODIF 6: Modifier Nom patron
  const [patronNom, setPatronNom] = useState(patron.nom);
  const [isSavingPatronNom, setIsSavingPatronNom] = useState(false);
  const [patronNomFeedback, setPatronNomFeedback] = useState<string | null>(null);

  // MODIF 6: Modifier Nom boutique
  const [boutiqueNom, setBoutiqueNom] = useState(patron.nom_boutique || '');
  const [isSavingBoutiqueNom, setIsSavingBoutiqueNom] = useState(false);
  const [boutiqueNomFeedback, setBoutiqueNomFeedback] = useState<string | null>(null);

  // Photo profil patron
  const [patronPhotoUrl, setPatronPhotoUrl] = useState<string>(patron.photo_url || '');

  // MODIF 6: Modifier Nom employé
  const [editingEmp, setEditingEmp] = useState<Employe | null>(null);
  const [editEmpNom, setEditEmpNom] = useState('');

  // Appareils connectés (Multi-devices)
  const [devicesList, setDevicesList] = useState<EfaDeviceRecord[]>([]);
  const [isLoadingDevices, setIsLoadingDevices] = useState(false);
  const [currentDeviceId, setCurrentDeviceId] = useState<string>('');

  useEffect(() => {
    if (isOpen && patron?.id) {
      setCurrentDeviceId(getDeviceId());
      setIsLoadingDevices(true);
      getBoutiqueDevices(patron.id)
        .then((devs) => setDevicesList(devs))
        .catch(console.error)
        .finally(() => setIsLoadingDevices(false));
    }
  }, [isOpen, patron?.id]);

  const handleDisconnectDevice = async (deviceIdToDisconnect: string) => {
    if (!confirm('Voulez-vous vraiment déconnecter cette session ?')) return;
    try {
      try {
        await supabase
          .from('efa_devices')
          .update({ is_active: false })
          .eq('boutique_id', patron.id)
          .eq('device_id', deviceIdToDisconnect);
      } catch (e) {
        console.warn('Erreur déconnexion appareil supabase:', e);
      }

      try {
        await db.appareils
          .where('patron_id')
          .equals(patron.id)
          .filter((d) => d.device_id === deviceIdToDisconnect)
          .modify({ is_active: false });
      } catch (e) {}

      speakFrench('Déconnecté avec succès');
      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch (e) {}
      onClose();
      onLogout();
      if (typeof window !== 'undefined') {
        window.location.href = '/login';
      }
    } catch (err) {
      console.error('Erreur déconnexion session:', err);
    }
  };

  // Zone dangereuse & Suppression compte définitive
  const [isDangerZoneOpen, setIsDangerZoneOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deleteConfirmationText, setDeleteConfirmationText] = useState('');
  const [isDeleteCheckboxChecked, setIsDeleteCheckboxChecked] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  // ÉTATS ET LOGIQUE SYNC CLOUD DIRECT (SANS DEMANDER DE PIN)
  const [isSyncingCloud, setIsSyncingCloud] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);
  const [syncStatusMsg, setSyncStatusMsg] = useState<string | null>(null);
  const [syncToast, setSyncToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Authentification transparente avec PIN en mémoire / storage
  // Authentification transparente (Zéro Email - accès base direct)
  const handleAuthenticateWithPin = async (_pinValue?: string): Promise<any> => {
    return null;
  };

  // 1. SYNC CLOUD : Patron clique = sync direct, PAS besoin de taper code pin avant
  const handleSyncCloud = async () => {
    if (isSyncingCloud) return;
    setIsSyncingCloud(true);
    setSyncToast(null);
    setSyncStatusMsg("Sauvegarde en cours...");
    setSyncProgress(10);

    try {
      // 1. Lire tout IndexedDB (toutes les tables)
      const [allPatrons, allProduits, allVentes, allDepenses, allCredits, allEmployes, allParrainage, allHistorique] =
        await Promise.all([
          db.patrons.toArray(),
          db.produits.toArray(),
          db.ventes.toArray(),
          db.depenses.toArray(),
          db.credits.toArray(),
          db.employes.toArray(),
          db.parrainage.toArray(),
          db.historiqueActions.toArray(),
        ]);

      const totalItems =
        allPatrons.length +
        allProduits.length +
        allVentes.length +
        allDepenses.length +
        allCredits.length +
        allEmployes.length +
        allParrainage.length +
        allHistorique.length;

      // 2. Vérifier si une session Supabase active existe, sinon tenter de s'authentifier automatiquement
      let currentAuthUser: any = null;
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        currentAuthUser = sessionData?.session?.user;
      } catch (e) {
        // ignore
      }

      if (!currentAuthUser) {
        currentAuthUser = await handleAuthenticateWithPin();
      }

      let processed = 0;
      const updateBar = () => {
        processed++;
        const pct = Math.min(95, Math.round((processed / Math.max(1, totalItems)) * 80) + 10);
        setSyncProgress(pct);
      };

      let hadFatalError = false;

      // Helper upsert sécurisé avec gestion gracieuse
      const pushRows = async (table: string, items: any[]): Promise<boolean> => {
        if (!items || items.length === 0) return true;
        for (const item of items) {
          const rowData = { ...item };
          if (table === 'patrons' && currentAuthUser) {
            rowData.auth_id = currentAuthUser.id;
          }
          delete rowData.is_exemple;

          const { error } = await supabase.from(table).upsert(rowData, { onConflict: 'id' });
          if (error) {
            console.warn(`[SYNC CLOUD] Note upsert ${table} id=${item.id}:`, error.message);
            if (table === 'patrons' || table === 'produits') {
              hadFatalError = true;
            }
          }
          updateBar();
        }
        return true;
      };

      await pushRows('patrons', allPatrons);
      await pushRows('employes', allEmployes);
      await pushRows('produits', allProduits);
      await pushRows('ventes', allVentes);
      await pushRows('depenses', allDepenses);
      await pushRows('credits', allCredits);
      await pushRows('parrainage', allParrainage);
      await pushRows('historique_actions', allHistorique);

      // Vérification des compteurs Cloud
      try {
        const { count: patronsCount } = await supabase
          .from('patrons')
          .select('*', { count: 'exact', head: true });
        const { count: produitsCount } = await supabase
          .from('produits')
          .select('*', { count: 'exact', head: true });
        console.log('[SYNC CLOUD] 📊 Compteurs Cloud :', {
          patronsInCloud: patronsCount,
          produitsInCloud: produitsCount,
        });
      } catch (e) {
        // ignore
      }

      if (hadFatalError) {
        setSyncToast({ message: 'Sync échoué', type: 'error' });
        setTimeout(() => setSyncToast(null), 3000);
      } else {
        setSyncProgress(100);
        setSyncToast({ message: 'Sync ok', type: 'success' });
        setTimeout(() => setSyncToast(null), 3000);
        speakFrench('Synchronisation terminée avec succès');
        onDataRefresh?.();
      }
    } catch (err: any) {
      console.warn('[SYNC CLOUD] Note synchronisation :', err?.message || err);
      setSyncToast({ message: 'Sync échoué', type: 'error' });
      setTimeout(() => setSyncToast(null), 3000);
    } finally {
      setIsSyncingCloud(false);
      setSyncStatusMsg(null);
    }
  };

  if (!isOpen) return null;

  const handleUpdatePatronNom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!patronNom.trim()) return;
    setIsSavingPatronNom(true);
    setPatronNomFeedback(null);
    const newNom = patronNom.trim();
    const oldNom = patron.nom;
    try {
      const updated: Patron = { ...patron, nom: newNom };
      await db.patrons.update(patron.id, { nom: newNom });
      await queueSyncItem('patrons', 'update', patron.id, { nom: newNom });
      try {
        await supabase.from('patrons').update({ nom: newNom }).eq('id', patron.id);
      } catch {}
      logAction({
        patron_id: patron.id,
        action_type: 'modif_stock',
        description: `Modification profil patron : nom changé de "${oldNom}" en "${newNom}"`,
      }).catch(console.error);
      onPatronUpdated(updated);
      setPatronNomFeedback('Nom modifié avec succès !');
      speakFrench(`Nom patron modifié : ${newNom}`);
      setTimeout(() => setPatronNomFeedback(null), 2500);
    } catch {
      setPatronNomFeedback('Erreur lors de la modification');
    } finally {
      setIsSavingPatronNom(false);
    }
  };

  const handleCameraPatronPhoto = async () => {
    const photo = await takePhotoFromCamera({
      formKey: 'patron_photo',
      formData: { id: patron.id, nom: patronNom },
    });
    if (photo) {
      setPatronPhotoUrl(photo);
      const updated: Patron = { ...patron, photo_url: photo };
      await db.patrons.update(patron.id, { photo_url: photo });
      await queueSyncItem('patrons', 'update', patron.id, { photo_url: photo });
      try {
        await supabase.from('patrons').update({ photo_url: photo }).eq('id', patron.id);
      } catch {}
      onPatronUpdated(updated);
      speakFrench('Photo de profil mise à jour');
    }
  };

  const handleGalleryPatronPhoto = async () => {
    const photo = await pickPhotoFromGallery({
      formKey: 'patron_photo',
      formData: { id: patron.id, nom: patronNom },
    });
    if (photo) {
      setPatronPhotoUrl(photo);
      const updated: Patron = { ...patron, photo_url: photo };
      await db.patrons.update(patron.id, { photo_url: photo });
      await queueSyncItem('patrons', 'update', patron.id, { photo_url: photo });
      try {
        await supabase.from('patrons').update({ photo_url: photo }).eq('id', patron.id);
      } catch {}
      onPatronUpdated(updated);
      speakFrench('Photo de profil mise à jour');
    }
  };

  const handleRemovePatronPhoto = async () => {
    setPatronPhotoUrl('');
    const updated: Patron = { ...patron, photo_url: undefined };
    await db.patrons.update(patron.id, { photo_url: undefined });
    await queueSyncItem('patrons', 'update', patron.id, { photo_url: null });
    try {
      await supabase.from('patrons').update({ photo_url: null }).eq('id', patron.id);
    } catch {}
    onPatronUpdated(updated);
  };

  const handleUpdateBoutiqueNom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!boutiqueNom.trim()) return;
    setIsSavingBoutiqueNom(true);
    setBoutiqueNomFeedback(null);
    const newNom = boutiqueNom.trim();
    const oldNom = patron.nom_boutique;
    try {
      const updated: Patron = { ...patron, nom_boutique: newNom };
      await db.patrons.update(patron.id, { nom_boutique: newNom });
      await queueSyncItem('patrons', 'update', patron.id, { nom_boutique: newNom });
      try {
        await supabase.from('patrons').update({ nom_boutique: newNom }).eq('id', patron.id);
      } catch {}
      logAction({
        patron_id: patron.id,
        action_type: 'modif_stock',
        description: `Modification boutique : nom changé de "${oldNom}" en "${newNom}"`,
      }).catch(console.error);
      onPatronUpdated(updated);
      setBoutiqueNomFeedback('Nom de boutique modifié !');
      speakFrench(`Boutique renommée : ${newNom}`);
      setTimeout(() => setBoutiqueNomFeedback(null), 2500);
    } catch {
      setBoutiqueNomFeedback('Erreur lors de la modification');
    } finally {
      setIsSavingBoutiqueNom(false);
    }
  };

  const handleSaveEditEmpNom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEmp || !editEmpNom.trim()) return;
    const newNom = editEmpNom.trim();
    const oldNom = editingEmp.nom;
    try {
      await db.employes.update(editingEmp.id, { nom: newNom });
      await queueSyncItem('employes', 'update', editingEmp.id, { nom: newNom });
      try {
        await supabase.from('employes').update({ nom: newNom }).eq('id', editingEmp.id);
      } catch {}
      logAction({
        patron_id: patron.id,
        action_type: 'modif_stock',
        description: `Modification employé : "${oldNom}" renommé en "${newNom}"`,
      }).catch(console.error);
      speakFrench(`Employé renommé : ${newNom}`);
      setEditingEmp(null);
      setEditEmpNom('');
      onDataRefresh?.();
    } catch (err) {
      console.error(err);
    }
  };

  const handlePermanentDeleteAccount = async () => {
    if (deleteConfirmationText !== 'SUPPRIMER' || !isDeleteCheckboxChecked) return;
    setIsDeletingAccount(true);
    try {
      try {
        await supabase.from('patrons').delete().eq('id', patron.id);
        await supabase.from('employes').delete().eq('patron_id', patron.id);
      } catch (e) {
        console.warn('Supabase cascade delete:', e);
      }
      await Promise.all([
        db.patrons.clear(),
        db.employes.clear(),
        db.produits.clear(),
        db.ventes.clear(),
        db.depenses.clear(),
        db.credits.clear(),
        db.parrainage.clear(),
        db.logsSuppression.clear(),
        db.syncQueue.clear(),
        db.historiqueActions.clear(),
      ]);
      localStorage.clear();
      alert('Compte supprimé');
      window.location.href = '/';
    } catch (err) {
      console.error('Erreur suppression compte:', err);
      setIsDeletingAccount(false);
    }
  };

  const handleToggleAutoLogout = async () => {
    const nextVal = !autoLogout;
    setAutoLogout(nextVal);
    const updated = { ...patron, auto_logout_after_action: nextVal };
    await db.patrons.update(patron.id, { auto_logout_after_action: nextVal });
    await queueSyncItem('patrons', 'update', patron.id, updated);
    onPatronUpdated(updated);
  };

  // Soumission changement de PIN normal
  const handleChangePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinFeedback(null);

    if (newPin.length !== 4 || confirmPin.length !== 4) {
      setPinFeedback('Le code PIN doit comporter 4 chiffres.');
      return;
    }

    if (newPin !== confirmPin) {
      setPinFeedback('Les deux nouveaux codes PIN ne correspondent pas.');
      return;
    }

    // Récupérer le pin_hash de l'utilisateur actif
    let currentHash = patron.pin_hash;
    if (currentUser.role === 'vendeuse') {
      const emp = await db.employes.get(currentUser.id);
      if (emp) currentHash = emp.pin_hash;
    }

    const isValidOld = await verifyPin(oldPin, currentHash);
    if (!isValidOld) {
      setPinFeedback("L'ancien code PIN est incorrect !");
      speakFrench('Ancien code PIN incorrect');
      return;
    }

    const hashed = await hashPin(newPin);

    if (currentUser.role === 'patron') {
      const updated = { ...patron, pin_hash: hashed, pin_code: newPin, code_pin: newPin };
      await db.patrons.update(patron.id, { pin_hash: hashed, pin_code: newPin, code_pin: newPin });
      localStorage.setItem('efa_patron_pin', newPin);
      sessionStorage.setItem('efa_patron_pin', newPin);
      try {
        await supabase.from('patrons').update({ pin_hash: hashed, pin_code: newPin, code_pin: newPin }).eq('id', patron.id);
        await supabase.from('efa_boutiques').update({ pin_patron_hash: hashed, pin_code: newPin }).eq('id', patron.id);
      } catch {}
      await queueSyncItem('patrons', 'update', patron.id, updated);
      onPatronUpdated(updated);
    } else {
      await db.employes.update(currentUser.id, { pin_hash: hashed, pin_code: newPin, code_pin: newPin });
      try {
        await supabase.from('employes').update({ pin_hash: hashed, pin_code: newPin, code_pin: newPin }).eq('id', currentUser.id);
      } catch {}
      await queueSyncItem('employes', 'update', currentUser.id, { pin_hash: hashed, pin_code: newPin, code_pin: newPin });
    }

    setIsPinSuccess(true);
    setPinFeedback('Code PIN modifié avec succès !');
    speakFrench('Ton nouveau code PIN est enregistré avec succès.');

    setTimeout(() => {
      setIsChangingPin(false);
      setIsPinSuccess(false);
      setOldPin('');
      setNewPin('');
      setConfirmPin('');
    }, 1500);
  };

  // Envoi OTP simulé sur WhatsApp
  const handleSendOtp = () => {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    setGeneratedOtp(code);
    setIsOtpResetMode(true);
    setOtpFeedback(`Code OTP envoyé sur WhatsApp au ${patron.telephone} : ${code}`);
    speakFrench(`Un code secret a été envoyé sur ton WhatsApp.`);
  };

  const handleValidateOtpReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (enteredOtp !== generatedOtp) {
      setOtpFeedback('Code OTP incorrect, vérifie tes messages WhatsApp.');
      return;
    }

    if (otpResetNewPin.length !== 4) {
      setOtpFeedback('Le nouveau PIN doit comporter 4 chiffres.');
      return;
    }

    const hashed = await hashPin(otpResetNewPin);
    if (currentUser.role === 'patron') {
      const updated = { ...patron, pin_hash: hashed, pin_code: otpResetNewPin, code_pin: otpResetNewPin };
      await db.patrons.update(patron.id, { pin_hash: hashed, pin_code: otpResetNewPin, code_pin: otpResetNewPin });
      localStorage.setItem('efa_patron_pin', otpResetNewPin);
      sessionStorage.setItem('efa_patron_pin', otpResetNewPin);
      try {
        await supabase.from('patrons').update({ pin_hash: hashed, pin_code: otpResetNewPin, code_pin: otpResetNewPin }).eq('id', patron.id);
        await supabase.from('efa_boutiques').update({ pin_patron_hash: hashed, pin_code: otpResetNewPin }).eq('id', patron.id);
      } catch {}
      await queueSyncItem('patrons', 'update', patron.id, updated);
      onPatronUpdated(updated);
    } else {
      await db.employes.update(currentUser.id, { pin_hash: hashed, pin_code: otpResetNewPin, code_pin: otpResetNewPin });
      try {
        await supabase.from('employes').update({ pin_hash: hashed, pin_code: otpResetNewPin, code_pin: otpResetNewPin }).eq('id', currentUser.id);
      } catch {}
      await queueSyncItem('employes', 'update', currentUser.id, { pin_hash: hashed, pin_code: otpResetNewPin, code_pin: otpResetNewPin });
    }

    speakFrench('Code PIN réinitialisé avec succès !');
    setOtpFeedback('Succès ! PIN réinitialisé.');

    setTimeout(() => {
      setIsOtpResetMode(false);
      setGeneratedOtp(null);
      setEnteredOtp('');
      setOtpResetNewPin('');
    }, 1500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in select-none">
      {/* CORRECTION 3: Bouton Retour tactile mobile responsive */}
      <BoutonRetour onBack={onClose} />
      <div className="w-full max-w-lg bg-white rounded-3xl p-6 sm:p-8 shadow-2xl border-4 border-gray-200 max-h-[90vh] overflow-y-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-2xl bg-purple-100 text-[#6C5CE7] flex items-center justify-center font-black">
              ⚙️
            </div>
            <div>
              <h3 className="text-xl font-black text-gray-900">
                PARAMÈTRES & SÉCURITÉ
              </h3>
              <p className="text-xs font-bold text-gray-500">
                Profil : {currentUser.nom} ({currentUser.role})
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-10 h-10 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-700"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* BOUTON MON ABONNEMENT DANS PARAMÈTRES (Réservé au patron) */}
        {patron && currentUser.role === 'patron' && onOpenMonAbonnementModal && (
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenMonAbonnementModal();
            }}
            className="w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600 hover:from-amber-500 hover:to-amber-700 text-slate-950 font-black text-sm flex items-center justify-between shadow-md border-2 border-amber-600 transition active:scale-98 cursor-pointer touch-manipulation group"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-slate-950 text-amber-300 flex items-center justify-center shadow-xs">
                <Crown className="w-5 h-5 fill-amber-400 group-hover:scale-110 transition-transform" />
              </div>
              <div className="text-left">
                <div className="leading-tight font-black text-sm text-slate-950">
                  Mon Forfait & Abonnement
                </div>
                <div className="text-[11px] text-slate-900 font-bold">
                  Consulter les jours restants et renouveler
                </div>
              </div>
            </div>
            <div className="px-2.5 py-1 rounded-xl bg-slate-950 text-amber-300 text-xs font-black">
              Voir
            </div>
          </button>
        )}

        {/* Toast discret après synchronisation (check vert 'Sync ok' / croix rouge 'Sync échoué') */}
        {syncToast && (
          <div
            className={`fixed top-4 left-1/2 -translate-x-1/2 z-[100000] px-4 py-2 rounded-full shadow-lg flex items-center gap-2 text-xs font-black transition-all animate-in fade-in slide-in-from-top-2 pointer-events-none ${
              syncToast.type === 'success'
                ? 'bg-emerald-600 text-white shadow-emerald-600/30'
                : 'bg-red-600 text-white shadow-red-600/30'
            }`}
          >
            {syncToast.type === 'success' ? (
              <Check className="w-4 h-4 text-white stroke-[3]" />
            ) : (
              <X className="w-4 h-4 text-white stroke-[3]" />
            )}
            <span>{syncToast.message}</span>
          </div>
        )}


        {/* CORRECTION 8 : TOGGLE AUTO-DÉCONNEXION APRÈS ACTION - COMPACT & LÉGER */}
        <div className="p-3 sm:p-3.5 rounded-xl bg-gray-50/90 border border-gray-200 flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0 pr-2">
            <h4 className="font-extrabold text-xs sm:text-sm text-gray-900 leading-snug">
              Déconnexion auto après chaque vente
            </h4>
            <p className="text-[11px] font-medium text-gray-500 mt-0.5 leading-tight">
              Verrouille automatiquement après chaque vente pour protéger la caisse.
            </p>
          </div>
          <button
            type="button"
            onClick={handleToggleAutoLogout}
            className="focus:outline-none transition transform active:scale-90 shrink-0 cursor-pointer"
            aria-label="Toggle déconnexion auto"
          >
            {autoLogout ? (
              <ToggleRight className="w-8 h-8 text-[#00B894]" />
            ) : (
              <ToggleLeft className="w-8 h-8 text-gray-400" />
            )}
          </button>
        </div>

        {/* MODIF 6: SECTION MON PROFIL */}
        <div className="p-3.5 sm:p-4 rounded-2xl bg-blue-50/60 border border-blue-200 space-y-3">
          <div className="flex items-center gap-2">
            <User className="w-4 h-4 text-blue-600" />
            <h4 className="font-black text-xs sm:text-sm text-gray-900">Mon profil (Patron)</h4>
          </div>

          {/* Photo profil patron avec les 2 boutons côte à côte réactifs Android */}
          <div className="flex items-center gap-3 py-1">
            <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-blue-100 flex items-center justify-center overflow-hidden border-2 border-blue-300 shrink-0">
              {patronPhotoUrl ? (
                <img src={patronPhotoUrl} alt="Aperçu" className="w-full h-full object-cover" />
              ) : (
                <span className="text-2xl">{patron.genre === 'homme' ? '👨' : '👩'}</span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <span className="block text-[11px] font-bold text-gray-600 mb-1">
                Photo de profil :
              </span>
              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                <button
                  type="button"
                  onClick={handleCameraPatronPhoto}
                  className="px-3 py-1.5 rounded-xl bg-teal-600 hover:bg-teal-700 active:scale-95 text-xs font-black text-white cursor-pointer flex items-center gap-1.5 shadow-xs transition touch-manipulation border border-teal-500/20"
                >
                  <Camera className="w-3.5 h-3.5 stroke-[2.5]" />
                  <span>Caméra</span>
                </button>
                <button
                  type="button"
                  onClick={handleGalleryPatronPhoto}
                  className="px-3 py-1.5 rounded-xl bg-[#6C5CE7] hover:bg-[#5b4bc4] active:scale-95 text-xs font-black text-white cursor-pointer flex items-center gap-1.5 shadow-xs transition touch-manipulation border border-indigo-500/20"
                >
                  <ImageIcon className="w-3.5 h-3.5 stroke-[2.5]" />
                  <span>Galerie</span>
                </button>
                {patronPhotoUrl && (
                  <button
                    type="button"
                    onClick={handleRemovePatronPhoto}
                    className="px-2 py-1.5 rounded-xl bg-red-50 hover:bg-red-100 text-red-600 text-xs font-bold transition active:scale-95 cursor-pointer border border-red-200"
                  >
                    Retirer
                  </button>
                )}
              </div>
            </div>
          </div>

          <form onSubmit={handleUpdatePatronNom} className="space-y-1.5">
            <label className="block text-xs font-bold text-gray-600">Nom du patron :</label>
            <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
              <input
                type="text"
                required
                value={patronNom}
                onChange={(e) => setPatronNom(e.target.value)}
                className="flex-1 min-w-[150px] px-3 py-2 rounded-xl border border-gray-300 font-bold text-xs sm:text-sm bg-white text-gray-900 focus:outline-none focus:border-blue-600 shadow-xs"
              />
              <button
                type="submit"
                disabled={isSavingPatronNom}
                className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-black text-xs shadow-xs transition cursor-pointer shrink-0"
              >
                {isSavingPatronNom ? '...' : 'Modifier'}
              </button>
            </div>
            {patronNomFeedback && (
              <p className="text-xs font-bold text-emerald-600 flex items-center gap-1">
                <Check className="w-3.5 h-3.5 stroke-[3]" />
                <span>{patronNomFeedback}</span>
              </p>
            )}
          </form>
        </div>

        {/* MODIF 6: SECTION MA BOUTIQUE */}
        <div className="p-3.5 sm:p-4 rounded-2xl bg-indigo-50/60 border border-indigo-200 space-y-3">
          <div className="flex items-center gap-2">
            <Store className="w-4 h-4 text-indigo-600" />
            <h4 className="font-black text-xs sm:text-sm text-gray-900">Ma boutique</h4>
          </div>
          <form onSubmit={handleUpdateBoutiqueNom} className="space-y-1.5">
            <label className="block text-xs font-bold text-gray-600">Nom de la boutique :</label>
            <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
              <input
                type="text"
                required
                value={boutiqueNom}
                onChange={(e) => setBoutiqueNom(e.target.value)}
                className="flex-1 min-w-[150px] px-3 py-2 rounded-xl border border-gray-300 font-bold text-xs sm:text-sm bg-white text-gray-900 focus:outline-none focus:border-indigo-600 shadow-xs"
              />
              <button
                type="submit"
                disabled={isSavingBoutiqueNom}
                className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white font-black text-xs shadow-xs transition cursor-pointer shrink-0"
              >
                {isSavingBoutiqueNom ? '...' : 'Modifier'}
              </button>
            </div>
            {boutiqueNomFeedback && (
              <p className="text-xs font-bold text-emerald-600 flex items-center gap-1">
                <Check className="w-3.5 h-3.5 stroke-[3]" />
                <span>{boutiqueNomFeedback}</span>
              </p>
            )}
          </form>
        </div>

        {/* MODIF 6: SECTION EMPLOYÉS */}
        {employes && employes.length > 0 && (
          <div className="p-4 rounded-2xl bg-purple-50/60 border border-purple-200 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-purple-600" />
                <h4 className="font-black text-sm text-gray-900">Employés ({employes.length})</h4>
              </div>
              <span className="text-[11px] font-bold text-purple-700">Clique sur le crayon pour renommer</span>
            </div>
            <div className="space-y-2">
              {employes.map((emp) => (
                <div
                  key={emp.id}
                  className="p-2.5 rounded-xl bg-white border border-gray-200 flex items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center font-black text-xs flex-shrink-0">
                      {emp.nom.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-black text-gray-900 truncate">{emp.nom}</p>
                      <p className="text-[10px] font-bold text-gray-400">{emp.phone_full || emp.telephone}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingEmp(emp);
                      setEditEmpNom(emp.nom);
                    }}
                    className="p-2 rounded-lg text-blue-600 hover:text-blue-800 hover:bg-blue-50 transition cursor-pointer flex-shrink-0"
                    title="Modifier le nom de l'employé"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* CORRECTION 9 : CHANGER CODE PIN */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-base font-black text-gray-900 flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-amber-500" />
              <span>Sécurité du Code PIN (4 chiffres)</span>
            </h4>
          </div>

          {!isChangingPin && !isOtpResetMode && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setIsChangingPin(true)}
                className="p-3.5 rounded-2xl bg-purple-50 hover:bg-purple-100 text-[#6C5CE7] font-black text-sm border-2 border-purple-200 flex items-center justify-center gap-2 transition"
              >
                <KeyRound className="w-4 h-4" />
                <span>CHANGER MON CODE PIN</span>
              </button>

              <button
                type="button"
                onClick={handleSendOtp}
                className="p-3.5 rounded-2xl bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-black text-sm border-2 border-emerald-200 flex items-center justify-center gap-2 transition"
              >
                <MessageSquare className="w-4 h-4 text-emerald-600" />
                <span>PIN OUBLIÉ ? (WHATSAPP OTP)</span>
              </button>
            </div>
          )}

          {/* Formulaire normal de modification de PIN */}
          {isChangingPin && (
            <form onSubmit={handleChangePinSubmit} className="p-4 rounded-2xl bg-purple-50/70 border-2 border-[#6C5CE7] space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-black text-purple-900">
                  Modifier ton code PIN :
                </span>
                <button
                  type="button"
                  onClick={() => setIsChangingPin(false)}
                  className="text-xs font-bold text-gray-500 underline"
                >
                  Annuler
                </button>
              </div>

              {pinFeedback && (
                <div
                  className={`p-2.5 rounded-xl text-xs font-bold text-center ${
                    isPinSuccess ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
                  }`}
                >
                  {pinFeedback}
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  Ancien code PIN actuel :
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  required
                  placeholder="••••"
                  value={oldPin}
                  onChange={(e) => setOldPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  className="w-full text-center text-xl font-black p-2.5 rounded-xl border border-gray-300 bg-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    Nouveau PIN (4 ch.) :
                  </label>
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    required
                    placeholder="••••"
                    value={newPin}
                    onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    className="w-full text-center text-xl font-black p-2.5 rounded-xl border border-gray-300 bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    Confirmer :
                  </label>
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    required
                    placeholder="••••"
                    value={confirmPin}
                    onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    className="w-full text-center text-xl font-black p-2.5 rounded-xl border border-gray-300 bg-white"
                  />
                </div>
              </div>

              <button
                type="submit"
                className="w-full py-3 rounded-xl bg-[#6C5CE7] text-white font-black text-sm flex items-center justify-center gap-2 shadow"
              >
                <Check className="w-4 h-4 stroke-[3]" />
                <span>ENREGISTRER LE NOUVEAU PIN</span>
              </button>
            </form>
          )}

          {/* Formulaire Réinitialisation via WhatsApp OTP */}
          {isOtpResetMode && (
            <form onSubmit={handleValidateOtpReset} className="p-4 rounded-2xl bg-emerald-50 border-2 border-emerald-400 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-black text-emerald-950 flex items-center gap-1.5">
                  <Smartphone className="w-4 h-4 text-emerald-600" />
                  Réinitialisation WhatsApp OTP :
                </span>
                <button
                  type="button"
                  onClick={() => setIsOtpResetMode(false)}
                  className="text-xs font-bold text-gray-500 underline"
                >
                  Annuler
                </button>
              </div>

              {otpFeedback && (
                <div className="p-2.5 rounded-xl bg-white border border-emerald-300 text-xs font-black text-emerald-900 text-center">
                  {otpFeedback}
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-emerald-900 mb-1">
                  Code OTP reçu (6 chiffres) :
                </label>
                <input
                  type="text"
                  maxLength={6}
                  required
                  placeholder="Code à 6 chiffres"
                  value={enteredOtp}
                  onChange={(e) => setEnteredOtp(e.target.value)}
                  className="w-full text-center text-2xl font-black p-2.5 rounded-xl border border-emerald-300 bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-emerald-900 mb-1">
                  Nouveau code PIN à 4 chiffres :
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  required
                  placeholder="••••"
                  value={otpResetNewPin}
                  onChange={(e) => setOtpResetNewPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  className="w-full text-center text-xl font-black p-2.5 rounded-xl border border-emerald-300 bg-white"
                />
              </div>

              <button
                type="submit"
                className="w-full py-3 rounded-xl bg-emerald-600 text-white font-black text-sm flex items-center justify-center gap-2 shadow"
              >
                <Check className="w-4 h-4 stroke-[3]" />
                <span>RÉINITIALISER MON PIN</span>
              </button>
            </form>
          )}
        </div>

        {/* SECTION MES APPAREILS CONNECTÉS / SESSIONS */}
        <div className="p-4 sm:p-5 rounded-3xl bg-white border-2 border-gray-200 shadow-xs space-y-3.5">
          <div className="flex items-center justify-between pb-2 border-b border-gray-100">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-teal-50 text-teal-700 flex items-center justify-center font-black">
                <Smartphone className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm sm:text-base font-black text-gray-900">
                  Mes appareils & sessions connectées
                </h4>
                <p className="text-[11px] text-gray-500 font-semibold">
                  Accès actifs sur smartphones, tablettes ou ordinateurs
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={async () => {
                setIsLoadingDevices(true);
                const devs = await getBoutiqueDevices(patron.id);
                setDevicesList(devs);
                setIsLoadingDevices(false);
              }}
              className="text-xs font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingDevices ? 'animate-spin' : ''}`} />
              <span>Actualiser</span>
            </button>
          </div>

          {isLoadingDevices ? (
            <p className="text-xs text-gray-400 font-semibold py-2">Chargement des sessions...</p>
          ) : devicesList.length === 0 ? (
            <div className="p-3 rounded-xl bg-gray-50 border border-gray-200 text-xs text-gray-500 text-center font-bold">
              1 appareil connecté (cet appareil actuel)
            </div>
          ) : (
            <div className="space-y-2">
              {devicesList.map((dev) => {
                const isCurrent = dev.device_id === currentDeviceId;
                return (
                  <div
                    key={dev.id || dev.device_id}
                    className="p-3 rounded-xl border border-gray-200 bg-gray-50 flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-9 h-9 rounded-xl bg-white border border-gray-200 flex items-center justify-center text-gray-700 shrink-0">
                        {dev.device_name.includes('PC') || dev.device_name.includes('Mac') ? (
                          <Laptop className="w-4 h-4" />
                        ) : (
                          <Smartphone className="w-4 h-4" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-black text-gray-900 truncate">{dev.device_name}</span>
                          {isCurrent && (
                            <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-black">
                              Cet appareil
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-gray-400 font-semibold block truncate">
                          Dernière activité : {new Date(dev.last_seen).toLocaleString('fr-FR')}
                        </span>
                      </div>
                    </div>

                    {/* BOUTON ROUGE DECONNEXION DE CETTE SESSION */}
                    <button
                      type="button"
                      onClick={() => handleDisconnectDevice(dev.device_id)}
                      className="px-3 py-2 rounded-xl bg-red-600 hover:bg-red-700 active:scale-95 text-white font-black text-xs transition cursor-pointer flex items-center gap-1.5 shadow-xs shrink-0"
                      title="Déconnecter cette session"
                    >
                      <LogOut className="w-3.5 h-3.5 stroke-[2.5]" />
                      <span>Déconnecter</span>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Forcer mise à jour du cache */}
        <div className="pt-2">
          <button
            type="button"
            onClick={async () => {
              try {
                if ('serviceWorker' in navigator) {
                  const regs = await navigator.serviceWorker.getRegistrations();
                  for (const reg of regs) await reg.unregister();
                }
                const cacheNames = await caches.keys();
                for (const name of cacheNames) await caches.delete(name);
              } catch (e) {
                console.warn(e);
              }
              window.location.reload();
            }}
            className="w-full py-3 px-4 rounded-2xl bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-xs flex items-center justify-center gap-2 transition"
          >
            <span>🔄 Forcer l'actualisation / Vider le cache</span>
          </button>
        </div>

        {/* BOUTON ROUGE DÉCONNEXION COMPLÈTE DE L'APPAREIL */}
        <div className="pt-4 border-t border-gray-200">
          <button
            type="button"
            onClick={async () => {
              if (window.confirm('Êtes-vous sûr de vouloir déconnecter complètement cet appareil ?')) {
                const devId = getDeviceId();
                try {
                  await supabase
                    .from('efa_devices')
                    .update({ is_active: false })
                    .eq('boutique_id', patron.id)
                    .eq('device_id', devId);
                } catch {}

                try {
                  localStorage.clear();
                  sessionStorage.clear();
                } catch (e) {
                  console.warn(e);
                }

                speakFrench('Appareil déconnecté');
                onClose();
                onLogout();
                if (typeof window !== 'undefined') {
                  window.location.href = '/login';
                }
              }
            }}
            className="w-full min-h-[58px] rounded-2xl bg-red-600 hover:bg-red-700 active:scale-95 text-white font-black text-sm sm:text-base flex items-center justify-center gap-3 shadow-lg shadow-red-500/25 transition cursor-pointer"
          >
            <LogOut className="w-5 h-5 sm:w-6 sm:h-6 stroke-[2.5]" />
            <span>DÉCONNEXION DE L'APPAREIL</span>
          </button>
          <p className="text-[11px] text-gray-500 font-bold mt-2 text-center">
            Efface complètement les données locales de cet appareil et redemande le nom de boutique et mot de passe patron.
          </p>
        </div>

        {/* MODIF 6: ZONE DANGEREUSE CACHÉE (ACCORDION FERMÉ PAR DÉFAUT) */}
        <div className="pt-6 pb-2 text-center border-t border-gray-100">
          <button
            type="button"
            onClick={() => setIsDangerZoneOpen(!isDangerZoneOpen)}
            className="text-[11px] font-bold text-gray-400 hover:text-gray-600 inline-flex items-center gap-1 transition cursor-pointer"
          >
            <span>Zone dangereuse</span>
            {isDangerZoneOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>

          {isDangerZoneOpen && (
            <div className="mt-3 p-4 rounded-2xl bg-red-50/70 border-2 border-red-200 space-y-3 text-left animate-in fade-in duration-150">
              <div className="flex items-center gap-2 text-red-700">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <p className="text-xs font-black">
                  Supprimer définitivement mon compte EFA ACONTA
                </p>
              </div>
              <p className="text-[11px] text-red-600 leading-relaxed font-semibold">
                Cette action supprimera toutes vos données (stock, ventes, employés, crédits, historique). Elle est strictement irréversible.
              </p>
              <button
                type="button"
                onClick={() => {
                  setDeleteConfirmationText('');
                  setIsDeleteCheckboxChecked(false);
                  setIsDeleteModalOpen(true);
                }}
                className="w-full py-2.5 px-4 rounded-xl border border-red-500 bg-white hover:bg-red-600 text-red-600 hover:text-white font-black text-xs transition cursor-pointer"
              >
                Supprimer mon compte
              </button>
            </div>
          )}
        </div>
      </div>

      {/* MODIF 6: MODAL ÉDITION NOM EMPLOYÉ */}
      {editingEmp && (
        <div className="fixed inset-0 z-[10000] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in duration-150">
            <div className="flex items-center justify-between">
              <h4 className="text-lg font-black text-gray-900 flex items-center gap-2">
                <Pencil className="w-5 h-5 text-blue-600" />
                <span>Modifier le nom de l'employé</span>
              </h4>
              <button
                type="button"
                onClick={() => setEditingEmp(null)}
                className="p-2 rounded-full hover:bg-gray-100 text-gray-500 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEditEmpNom} className="space-y-4">
              <div>
                <label className="block text-xs font-black uppercase text-gray-500 mb-1">
                  Nouveau nom de l'employé :
                </label>
                <input
                  type="text"
                  required
                  value={editEmpNom}
                  onChange={(e) => setEditEmpNom(e.target.value)}
                  className="w-full text-lg font-black p-3.5 rounded-2xl border-2 border-gray-300 focus:border-blue-600 focus:outline-none bg-gray-50 text-gray-900"
                />
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingEmp(null)}
                  className="flex-1 py-3 rounded-2xl border border-gray-300 font-bold text-gray-600 hover:bg-gray-50 transition cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="flex-1 py-3 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white font-black shadow-md transition cursor-pointer"
                >
                  Enregistrer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODIF 6: MODAL CONFIRMATION SUPPRESSION DÉFINITIVE DU COMPTE */}
      {isDeleteModalOpen && (
        <div className="fixed inset-0 z-[10000] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border-2 border-red-500 space-y-4 animate-in fade-in zoom-in duration-150">
            <div className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="w-6 h-6 flex-shrink-0 stroke-[2.5]" />
              <h4 className="text-base font-black text-red-700">
                ⚠️ ATTENTION - Cette action est IRRÉVERSIBLE
              </h4>
            </div>

            <p className="text-xs text-gray-700 leading-relaxed font-bold">
              Toutes vos données (stock, ventes, employés, historique) seront supprimées définitivement. Tapez{' '}
              <span className="font-mono font-black text-red-600 bg-red-50 px-1 py-0.5 rounded border border-red-200">
                SUPPRIMER
              </span>{' '}
              pour confirmer :
            </p>

            <input
              type="text"
              placeholder="Tapez SUPPRIMER"
              value={deleteConfirmationText}
              onChange={(e) => setDeleteConfirmationText(e.target.value)}
              className="w-full text-center text-lg font-black p-3.5 rounded-2xl border-2 border-red-300 focus:border-red-600 focus:outline-none uppercase tracking-wider"
            />

            <label className="flex items-start gap-2.5 cursor-pointer select-none text-xs text-gray-700 font-bold p-2 rounded-xl bg-gray-50 border border-gray-200">
              <input
                type="checkbox"
                checked={isDeleteCheckboxChecked}
                onChange={(e) => setIsDeleteCheckboxChecked(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded text-red-600 focus:ring-red-500 cursor-pointer"
              />
              <span>Je comprends que je perds tout définitivement</span>
            </label>

            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsDeleteModalOpen(false)}
                className="flex-1 py-3 rounded-2xl border border-gray-300 font-bold text-gray-600 hover:bg-gray-50 transition cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={deleteConfirmationText !== 'SUPPRIMER' || !isDeleteCheckboxChecked || isDeletingAccount}
                onClick={handlePermanentDeleteAccount}
                className={`flex-1 py-3 px-2 rounded-2xl font-black text-xs text-white shadow transition ${
                  deleteConfirmationText === 'SUPPRIMER' && isDeleteCheckboxChecked
                    ? 'bg-red-600 hover:bg-red-700 cursor-pointer shadow-red-500/30'
                    : 'bg-gray-300 cursor-not-allowed opacity-60'
                }`}
              >
                {isDeletingAccount ? 'Suppression...' : 'Confirmer suppression définitive'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
