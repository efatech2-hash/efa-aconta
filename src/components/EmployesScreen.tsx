import React, { useState, useEffect, useRef } from 'react';
import { withTimeout } from '../lib/supabaseHelper';
import {
  Users,
  UserPlus,
  Shield,
  KeyRound,
  Phone,
  Trash2,
  ArrowLeft,
  Check,
  Lock,
  Camera,
  Image as ImageIcon,
  Eye,
  EyeOff,
  Ban,
  AlertTriangle,
  Pencil,
  X,
} from 'lucide-react';
import type { Patron, Employe, Genre } from '../lib/types';
import { db } from '../lib/db';
import { queueSyncItem } from '../lib/sync';
import { hashPin } from '../lib/security';
import { speakFrench } from '../lib/speech';
import { getAccord } from '../lib/accord';
import { BoutonRetour } from './BoutonRetour';
import {
  takePhotoFromCamera,
  pickPhotoFromGallery,
  pickPhotoInApp,
  persistFormState,
  restoreFormState,
  clearFormState,
} from '../lib/camera';
import { COUNTRY_CODES, validatePhoneNumber } from '../lib/countryCodes';
import { logAction } from '../lib/historique';
import { canAddEmploye, canAddVendeur, getVendeurLimitInfo, PLAN_CONFIGS } from '../lib/checkLimits';
import {
  isProActive,
  getMainStoreId,
  getTotalEmployeeCount,
  canAddEmployeePro,
  PRO_MAX_EMPLOYEES,
} from '../lib/mesBoutiques';
import { supabase } from '../lib/supabase';

interface EmployesScreenProps {
  patron: Patron;
  employes: Employe[];
  onBack: () => void;
  onRefresh: () => void;
  onOpenSubscriptionModal?: (plan?: 'populaire' | 'pro', reason?: string) => void;
}

export const EmployesScreen: React.FC<EmployesScreenProps> = ({
  patron,
  employes,
  onBack,
  onRefresh,
  onOpenSubscriptionModal,
}) => {
  const [nom, setNom] = useState('');
  const [phoneCountry, setPhoneCountry] = useState('+228');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [showAddPin, setShowAddPin] = useState(false);
  const [showAddConfirmPin, setShowAddConfirmPin] = useState(false);
  const [showPatronPin, setShowPatronPin] = useState(false);
  const [genre, setGenre] = useState<Genre>('femme'); // Genre obligatoire
  const [photoUrl, setPhotoUrl] = useState<string | undefined>(undefined); // Photo optionnelle
  const [isLoading, setIsLoading] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  // LOGIQUE DES 10 EMPLOYÉS PARTAGÉS (PRO)
  const isPro = isProActive(patron);
  const mainStoreId = getMainStoreId(patron);
  const [totalEmployesPro, setTotalEmployesPro] = useState<number>(employes.length);

  useEffect(() => {
    if (isPro) {
      getTotalEmployeeCount(mainStoreId).then(setTotalEmployesPro);
    } else {
      setTotalEmployesPro(employes.length);
    }
  }, [patron, employes, isPro, mainStoreId]);

  // Restauration automatique du formulaire si déchargé par Android
  useEffect(() => {
    const draft = restoreFormState<{
      nom?: string;
      genre?: Genre;
      phoneCountry?: string;
      phoneNumber?: string;
      pin?: string;
      confirmPin?: string;
      photoUrl?: string;
    }>('new_employe');

    if (draft) {
      if (draft.nom) setNom(draft.nom);
      if (draft.genre) setGenre(draft.genre);
      if (draft.phoneCountry) setPhoneCountry(draft.phoneCountry);
      if (draft.phoneNumber) setPhoneNumber(draft.phoneNumber);
      if (draft.pin) setPin(draft.pin);
      if (draft.confirmPin) setConfirmPin(draft.confirmPin);
      if (draft.photoUrl) setPhotoUrl(draft.photoUrl);
    }
  }, []);

  // Afficher / Masquer PIN pour chaque employé
  const [visiblePins, setVisiblePins] = useState<Record<string, boolean>>({});

  const isFetchingEmployesRef = useRef(false);
  const hasFetchedEmployesRef = useRef(false);

  // Récupérer les employés depuis Supabase avec timeout 5s, limit 20, tri et guard anti-boucle
  useEffect(() => {
    async function fetchEmployesFromSupabase() {
      if (isFetchingEmployesRef.current || hasFetchedEmployesRef.current) return;
      isFetchingEmployesRef.current = true;

      try {
        const query = supabase
          .from('employes')
          .select('id, nom, code_pin, role, telephone, phone_country, phone_number, phone_full, photo_url, status, is_active, genre, pin_hash, created_at')
          .eq('patron_id', patron.id)
          .order('created_at', { ascending: false })
          .limit(20);

        const { data, error }: any = await withTimeout(query, 5000);

        if (!error && data && data.length > 0) {
          let hasNew = false;
          for (const emp of data) {
            const mappedEmp: Employe = {
              id: emp.id,
              patron_id: patron.id,
              nom: emp.nom,
              role: (emp.role as any) || 'vendeuse',
              telephone: emp.telephone || '',
              phone_country: emp.phone_country,
              phone_number: emp.phone_number,
              phone_full: emp.phone_full,
              photo_url: emp.photo_url,
              status: emp.status,
              is_active: emp.is_active,
              genre: (emp.genre as any) || 'femme',
              pin_hash: emp.pin_hash || '',
              pin_code: emp.code_pin,
              code_pin: emp.code_pin,
              created_at: emp.created_at || new Date().toISOString(),
            };
            await db.employes.put(mappedEmp);
            hasNew = true;
          }
          if (hasNew) {
            onRefresh();
          }
        }
        hasFetchedEmployesRef.current = true;
      } catch (err) {
        console.warn('[Employes] Timeout ou erreur Supabase (mode local conservé):', err);
      } finally {
        isFetchingEmployesRef.current = false;
      }
    }

    if (typeof navigator !== 'undefined' && navigator.onLine) {
      fetchEmployesFromSupabase();
    }
  }, [patron.id]);

  // Correction 1: Modal confirmation suppression "Vraiment licencier [nom]?"
  const [employeToDelete, setEmployeToDelete] = useState<Employe | null>(null);

  // MODIF 6: Édition du nom employé
  const [editingEmp, setEditingEmp] = useState<Employe | null>(null);
  const [editEmpNom, setEditEmpNom] = useState('');

  const accord = getAccord(patron.genre);
  const currentPlan = patron.subscription_status || 'trial';
  const maxAllowedEmployes = PLAN_CONFIGS[currentPlan]?.maxEmployes ?? 3;
  const canAddMore = canAddEmploye(patron, employes.length);

  // Capture / Sélection photo in-app Capacitor sans navigation externe ni rechargement
  const handleCamera = async () => {
    const currentForm = {
      nom,
      genre,
      phoneCountry,
      phoneNumber,
      pin,
      confirmPin,
      photoUrl,
    };
    const photoDataUrl = await takePhotoFromCamera({
      formKey: 'new_employe',
      formData: currentForm,
    });
    if (photoDataUrl) {
      setPhotoUrl(photoDataUrl);
    }
  };

  const handleGallery = async () => {
    const currentForm = {
      nom,
      genre,
      phoneCountry,
      phoneNumber,
      pin,
      confirmPin,
      photoUrl,
    };
    const photoDataUrl = await pickPhotoFromGallery({
      formKey: 'new_employe',
      formData: currentForm,
    });
    if (photoDataUrl) {
      setPhotoUrl(photoDataUrl);
    }
  };

  const handlePickPhoto = handleCamera;

  const handleAddEmploye = async (e: React.FormEvent) => {
    e.preventDefault();

    // RÈGLE PRO : max 10 employés toutes boutiques réunies
    if (isPro) {
      const check = await canAddEmployeePro(mainStoreId);
      if (!check.allowed) {
        setFeedback("Limite Pro atteinte : 10 employés pour toutes tes boutiques réunies.");
        alert("Limite Pro atteinte : 10 employés pour toutes tes boutiques réunies.");
        return;
      }
    } else {
      const limitInfo = getVendeurLimitInfo(patron, employes.length);
      if (!limitInfo.allowed) {
        if (onOpenSubscriptionModal) {
          onOpenSubscriptionModal('populaire', limitInfo.message);
        } else {
          setFeedback(limitInfo.message);
        }
        return;
      }
    }
    if (!nom.trim()) {
      setFeedback("Indique le nom de l'employé(e).");
      return;
    }
    if (!phoneNumber.trim()) {
      setFeedback('Indique le numéro WhatsApp.');
      return;
    }
    if (!validatePhoneNumber(phoneNumber, phoneCountry)) {
      setFeedback(`Numéro invalide pour le pays sélectionné (${phoneCountry}). Format 8 à 10 chiffres requis.`);
      return;
    }
    if (pin.length !== 4 || !/^\d{4}$/.test(pin)) {
      setFeedback('Le PIN doit comporter exactement 4 chiffres.');
      return;
    }
    if (pin === '1234') {
      setFeedback("Le code '1234' est interdit pour des raisons de sécurité. Veuillez choisir un code PIN personnalisé.");
      return;
    }
    if (pin !== confirmPin) {
      setFeedback('Les codes PIN ne correspondent pas.');
      return;
    }

    setIsLoading(true);
    setFeedback(null);

    const empId = 'emp-' + Date.now();
    try {
      // Sécurité : PIN hashé avec bcryptjs.hash(pin, 10)
      const pin_hash = await hashPin(pin);

      const cleanDigits = phoneNumber.replace(/[\s\-\.]/g, '');
      const phoneFull = phoneCountry === 'Autre' ? cleanDigits : `${phoneCountry}${cleanDigits}`;

      const newEmploye: Employe = {
        id: empId,
        patron_id: patron.id,
        nom: nom.trim(),
        telephone: `${phoneCountry} ${cleanDigits}`,
        phone_country: phoneCountry,
        phone_number: cleanDigits,
        phone_full: phoneFull,
        pin_hash,
        pin_code: pin, // Correction 1: code PIN stocké et visible par le patron
        code_pin: pin, // Supabase code_pin colonne
        status: 'active',
        is_active: true,
        genre,
        photo_url: photoUrl,
        role: 'vendeuse',
        subscription_status: patron.subscription_status || 'trial',
        created_at: new Date().toISOString(),
      };

      await db.employes.put(newEmploye);
      await queueSyncItem('employes', 'insert', empId, newEmploye);

      // MODIF 1: Log historique création employé
      logAction({
        patron_id: patron.id,
        action_type: 'creation_employe',
        description: `Création du compte employé ${newEmploye.nom} (${genre === 'femme' ? 'Vendeuse' : 'Vendeur'}) par Patron`,
      }).catch(console.error);

      const empAccord = getAccord(genre);
      speakFrench(`${empAccord.titreVendeur} ${newEmploye.nom} ajouté(e) avec succès !`);
      setFeedback(`${empAccord.titreVendeur} "${newEmploye.nom}" ajouté(e) avec succès.`);

      // Nettoyage formulaire et brouillon persistant
      clearFormState('new_employe');
      setNom('');
      setPhoneNumber('');
      setPin('');
      setConfirmPin('');
      setPhotoUrl(undefined);
      onRefresh();
    } catch (err) {
      console.error('Erreur employe:', err);
      setFeedback("Erreur lors de la création.");
    } finally {
      setIsLoading(false);
    }
  };

  // Correction 1: Bouton Bloquer / Débloquer
  const handleToggleBlockEmploye = async (emp: Employe) => {
    const isCurrentlyBlocked = emp.is_blocked || emp.status === 'blocked' || emp.is_active === false;
    const nextBlocked = !isCurrentlyBlocked;
    const nextStatus = nextBlocked ? 'blocked' : 'active';
    const nextIsActive = !nextBlocked;

    try {
      await db.employes.update(emp.id, {
        status: nextStatus,
        is_active: nextIsActive,
        is_blocked: nextBlocked,
      });
      await queueSyncItem('employes', 'update', emp.id, {
        status: nextStatus,
        is_active: nextIsActive,
        is_blocked: nextBlocked,
      });

      // MODIF 1: Log historique blocage/déblocage
      logAction({
        patron_id: patron.id,
        action_type: 'blocage_employe',
        description: `${isCurrentlyBlocked ? 'Déblocage' : 'Blocage'} du compte de ${emp.nom} par Patron`,
      }).catch(console.error);

      if (isCurrentlyBlocked) {
        speakFrench(`Compte de ${emp.nom} débloqué avec succès.`);
        setFeedback(`Compte de ${emp.nom} débloqué.`);
      } else {
        speakFrench(`Compte de ${emp.nom} bloqué par le patron.`);
        setFeedback(`Compte de ${emp.nom} bloqué.`);
      }
      onRefresh();
    } catch (err) {
      console.error('Erreur mise à jour statut employé:', err);
      setFeedback('Erreur lors du changement de statut.');
    }
  };

  // Correction 1: Confirmation et suppression de l'employé
  const handleConfirmDelete = async () => {
    if (!employeToDelete) return;
    const emp = employeToDelete;
    try {
      await db.employes.delete(emp.id);
      await queueSyncItem('employes', 'delete', emp.id, { status: 'deleted' });

      // MODIF 1: Log historique suppression employé
      logAction({
        patron_id: patron.id,
        action_type: 'suppression',
        description: `Suppression définitive du compte employé ${emp.nom} par Patron`,
      }).catch(console.error);

      speakFrench(`Accès supprimé pour ${emp.nom}.`);
      setFeedback(`Employé(e) "${emp.nom}" licencié(e) et accès supprimé.`);
      setEmployeToDelete(null);
      onRefresh();
    } catch (err) {
      console.error('Erreur suppression employe:', err);
      setFeedback("Erreur lors de la suppression de l'accès.");
    }
  };

  // MODIF 6: Enregistrer la modification du nom d'un employé
  const handleSaveEditEmpName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEmp || !editEmpNom.trim()) return;
    const newNom = editEmpNom.trim();
    const oldNom = editingEmp.nom;
    try {
      await db.employes.update(editingEmp.id, { nom: newNom });
      await queueSyncItem('employes', 'update', editingEmp.id, { nom: newNom });

      logAction({
        patron_id: patron.id,
        action_type: 'modif_stock',
        description: `Modification du nom de l'employé : "${oldNom}" renommé en "${newNom}"`,
      }).catch(console.error);

      speakFrench(`Nom de l'employé mis à jour en ${newNom}`);
      setFeedback(`Employé "${newNom}" renommé avec succès.`);
      setEditingEmp(null);
      setEditEmpNom('');
      onRefresh();
    } catch (err) {
      console.error('Erreur mise à jour nom employé:', err);
      setFeedback('Erreur lors de la mise à jour du nom.');
    }
  };

  return (
    <div className="space-y-6 pb-28 select-none relative pt-4">
      {/* CORRECTION 3: Bouton Retour tactile mobile responsive */}
      <BoutonRetour onBack={onBack} />

      {/* Header */}
      <div className="flex items-center justify-between pl-14 sm:pl-0">
        <div className="hidden sm:block">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl bg-gray-200 hover:bg-gray-300 font-bold text-gray-800 transition"
          >
            <ArrowLeft className="w-5 h-5" />
            <span>Retour</span>
          </button>
        </div>

        <h2 className="text-xl sm:text-2xl font-black text-gray-900">
          GESTION DES EMPLOYÉS
        </h2>
      </div>

      {feedback && (
        <div className="p-4 rounded-2xl bg-emerald-100 border-2 border-emerald-400 text-emerald-800 font-black text-center text-base flex items-center justify-center gap-2">
          <Check className="w-5 h-5 stroke-[3]" />
          <span>{feedback}</span>
        </div>
      )}

      {/* Explication sécurité RLS */}
      <div className="bg-purple-50 border-2 border-purple-200 rounded-3xl p-5">
        <div className="flex items-center gap-3">
          <Shield className="w-8 h-8 text-[#6C5CE7] flex-shrink-0" />
          <div>
            <h4 className="font-black text-lg text-gray-900">
              Protection {accord.titrePatron} Garantie (3 accès max)
            </h4>
            <p className="text-xs sm:text-sm font-bold text-purple-800 mt-0.5">
              Chaque vendeur(se) peut seulement enregistrer des ventes. Il/elle ne voit <strong>JAMAIS</strong> ton solde de caisse, ni tes dépenses, ni tes bénéfices.
            </p>
          </div>
        </div>
      </div>

      {/* Confirmation Modal pour licenciement */}
      {employeToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-md bg-white rounded-3xl p-6 shadow-2xl border-4 border-red-500 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-red-100 text-red-600 mx-auto flex items-center justify-center">
              <AlertTriangle className="w-9 h-9 stroke-[2.5]" />
            </div>

            <h3 className="text-2xl font-black text-gray-900">
              Vraiment licencier {employeToDelete.nom} ?
            </h3>

            <p className="text-sm font-bold text-gray-600">
              Cette action supprimera définitivement son profil et son accès à la caisse. Ses ventes passées resteront enregistrées.
            </p>

            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                type="button"
                onClick={() => setEmployeToDelete(null)}
                className="btn min-h-[50px] p-3 rounded-2xl bg-gray-200 hover:bg-gray-300 text-gray-800 font-black text-sm"
              >
                Annuler
              </button>

              <button
                type="button"
                onClick={handleConfirmDelete}
                className="btn min-h-[50px] p-3 rounded-2xl bg-red-600 hover:bg-red-700 text-white font-black text-sm shadow-md"
              >
                Oui, Licencier
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Liste des employés actuels */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
          <h3 className="text-lg font-black text-gray-900">
            Profils de la caisse ({employes.length} / {isPro ? 10 : maxAllowedEmployes}) :
          </h3>
          {isPro && (
            <span className="text-xs font-bold text-purple-700 bg-purple-50 px-2.5 py-1 rounded-full border border-purple-200 w-fit">
              👥 Employés utilisés : {totalEmployesPro} / 10 (toutes boutiques)
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3">
          {/* CARTE SPÉCIALE "PATRON (Moi)" avec Code PIN visible via œil */}
          <div className="border-2 border-yellow-400 bg-yellow-50 p-4 rounded-xl shadow-sm transition hover:shadow-md">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                {patron.photo_url ? (
                  <img
                    src={patron.photo_url}
                    alt={patron.nom}
                    className="w-14 h-14 rounded-full object-cover border-2 border-yellow-400 shadow flex-shrink-0"
                  />
                ) : (
                  <div className="w-14 h-14 rounded-full bg-yellow-400 text-amber-900 flex items-center justify-center font-black text-2xl shadow flex-shrink-0">
                    👑
                  </div>
                )}
                <div>
                  <p className="font-black text-lg text-gray-900">👑 Patron : {patron.nom}</p>
                  <div className="flex items-center gap-2 text-sm font-black text-gray-800">
                    <span>Code PIN : {showPatronPin ? (patron.pin_code || patron.code_pin || 'Non défini') : '••••'}</span>
                    <button
                      type="button"
                      onClick={() => setShowPatronPin(!showPatronPin)}
                      className="p-1 rounded-lg text-gray-600 hover:text-gray-900 hover:bg-yellow-200/70 transition cursor-pointer"
                      title={showPatronPin ? 'Masquer mon code PIN' : 'Afficher mon code PIN'}
                    >
                      {showPatronPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4 text-amber-700" />}
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 font-bold">Votre code PIN personnel</p>
                </div>
              </div>
              <span className="px-3 py-1 rounded-full bg-yellow-200 text-yellow-900 text-xs font-black flex items-center gap-1 self-start sm:self-center">
                <Lock className="w-3.5 h-3.5" />
                Patron
              </span>
            </div>
          </div>

          {/* Cartes employés avec Code PIN visible + Boutons Bloquer & Supprimer */}
          {employes.map((emp) => {
            const empAccord = getAccord(emp.genre);
            const isBlocked = emp.is_blocked || emp.status === 'blocked' || emp.is_active === false;
            const isPinShown = visiblePins[emp.id] || false;
            const displayPin = emp.code_pin || emp.pin_code || '';

            return (
              <div
                key={emp.id}
                className={`p-4 rounded-2xl border-2 transition-all flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 ${
                  isBlocked
                    ? 'bg-gray-100/90 border-gray-300 opacity-75'
                    : 'bg-white border-gray-200 shadow-sm'
                }`}
              >
                <div className="flex items-center gap-3">
                  {emp.photo_url ? (
                    <img
                      src={emp.photo_url}
                      alt={emp.nom}
                      className={`w-14 h-14 rounded-full object-cover border-2 shadow flex-shrink-0 ${
                        isBlocked ? 'border-gray-400 grayscale' : 'border-[#0A53FF]'
                      }`}
                    />
                  ) : (
                    <div
                      className={`w-14 h-14 rounded-full text-white flex items-center justify-center font-black text-xl shadow flex-shrink-0 ${
                        isBlocked ? 'bg-gray-400' : 'bg-[#0A53FF]'
                      }`}
                    >
                      {emp.nom.charAt(0).toUpperCase()}
                    </div>
                  )}

                  <div className="space-y-0.5">
                    {/* Nom en haut + icône crayon pour modifier */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <h5 className="font-black text-lg text-gray-900">{emp.nom}</h5>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingEmp(emp);
                          setEditEmpNom(emp.nom);
                        }}
                        className="p-1 rounded-lg text-blue-600 hover:text-blue-800 hover:bg-blue-50 transition cursor-pointer"
                        title="Modifier le nom de l'employé"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      {isBlocked ? (
                        <span className="px-2.5 py-0.5 rounded-full bg-orange-100 text-orange-800 border border-orange-300 text-xs font-black inline-flex items-center gap-1">
                          <Ban className="w-3 h-3" />
                          Bloqué
                        </span>
                      ) : (
                        <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 text-xs font-black">
                          Actif
                        </span>
                      )}
                    </div>

                    <p className="text-xs font-bold text-gray-500">
                      {empAccord.titreVendeur} • {emp.phone_full || emp.telephone}
                    </p>

                    {/* EN DESSOUS DU NOM: Vrai Code PIN + icône œil */}
                    <div className="flex items-center gap-2 text-xs text-gray-700 font-mono font-bold pt-0.5">
                      <span>Code PIN : {isPinShown ? (displayPin || 'Non défini') : '••••'}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setVisiblePins((prev) => ({ ...prev, [emp.id]: !prev[emp.id] }))
                        }
                        className="p-1 rounded-lg text-gray-500 hover:text-gray-800 hover:bg-gray-200 transition cursor-pointer"
                        title={isPinShown ? 'Masquer le code PIN' : 'Afficher le code PIN'}
                        aria-label={isPinShown ? 'Masquer le code PIN' : 'Afficher le code PIN'}
                      >
                        {isPinShown ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4 text-[#0A53FF]" />}
                      </button>
                    </div>
                  </div>
                </div>

                {/* 2 BOUTONS À DROITE : BLOQUER (orange) + SUPPRIMER (rouge) */}
                <div className="flex items-center gap-2 self-end sm:self-center">
                  <button
                    type="button"
                    onClick={() => handleToggleBlockEmploye(emp)}
                    className={`btn min-h-[44px] px-3.5 py-2 rounded-xl font-black text-xs inline-flex items-center justify-center gap-1.5 transition active:scale-95 ${
                      isBlocked
                        ? 'bg-amber-500 hover:bg-amber-600 text-white shadow'
                        : 'bg-orange-100 hover:bg-orange-200 text-orange-800 border border-orange-300'
                    }`}
                    title={isBlocked ? 'Débloquer cet employé' : 'Bloquer cet employé'}
                  >
                    {isBlocked ? (
                      <>
                        <Check className="w-4 h-4 stroke-[3]" />
                        <span>Débloquer</span>
                      </>
                    ) : (
                      <>
                        <Ban className="w-4 h-4" />
                        <span>Bloquer</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => setEmployeToDelete(emp)}
                    className="btn min-h-[44px] px-3.5 py-2 rounded-xl bg-red-100 hover:bg-red-200 text-red-700 border border-red-300 font-black text-xs inline-flex items-center justify-center gap-1.5 transition active:scale-95"
                    title="Licencier / Supprimer"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>Supprimer</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Formulaire ajout employé (si < 3) */}
      {canAddMore ? (
        <form
          onSubmit={handleAddEmploye}
          className="bg-white rounded-3xl p-6 border-2 border-gray-200 shadow-sm space-y-4"
        >
          <div className="flex items-center gap-2 pb-2 border-b border-gray-100">
            <UserPlus className="w-6 h-6 text-[#6C5CE7]" />
            <h3 className="text-xl font-black text-gray-900">
              Créer un nouvel accès employé
            </h3>
          </div>

          {/* GENRE UNIQUE : ACCUEIL PERSONNALISÉ & RÔLE (UN SEUL SELECTEUR H/F) */}
          <div>
            <label className="block text-sm font-black text-gray-800 mb-2">
              Genre de l'employé(e) (pour l'accueil personnalisé) : *
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setGenre('femme')}
                className={`py-3.5 px-4 rounded-2xl border-2 font-black text-sm sm:text-base flex items-center justify-center gap-2 transition active:scale-95 touch-manipulation cursor-pointer ${
                  genre === 'femme'
                    ? 'border-[#6C5CE7] bg-purple-100 text-[#6C5CE7] shadow-md ring-2 ring-purple-200'
                    : 'border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100'
                }`}
              >
                <span className="text-2xl">👩</span>
                <span>Femme (Vendeuse)</span>
              </button>

              <button
                type="button"
                onClick={() => setGenre('homme')}
                className={`py-3.5 px-4 rounded-2xl border-2 font-black text-sm sm:text-base flex items-center justify-center gap-2 transition active:scale-95 touch-manipulation cursor-pointer ${
                  genre === 'homme'
                    ? 'border-blue-600 bg-blue-100 text-blue-700 shadow-md ring-2 ring-blue-200'
                    : 'border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100'
                }`}
              >
                <span className="text-2xl">👨</span>
                <span>Homme (Vendeur)</span>
              </button>
            </div>
          </div>

          {/* PHOTO PROFIL OPTIONNELLE : CAPACITOR IN-APP CAMERA SANS RESET APP */}
          <div className="flex items-center gap-3 py-1">
            <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center overflow-hidden border-2 border-gray-300 shrink-0">
              {photoUrl ? (
                <img src={photoUrl} alt="Aperçu" className="w-full h-full object-cover" />
              ) : (
                <span className="text-2xl">{genre === 'femme' ? '👩' : '👨'}</span>
              )}
            </div>

            <div className="flex-1">
              <span className="block text-xs font-bold text-gray-600 mb-1">
                Photo (optionnel) :
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleCamera}
                  className="px-3.5 py-2.5 rounded-2xl bg-teal-600 hover:bg-teal-700 active:scale-95 text-xs font-black text-white cursor-pointer flex items-center gap-1.5 shadow-sm transition touch-manipulation border border-teal-500/20"
                >
                  <Camera className="w-4 h-4 stroke-[2.5]" />
                  <span>Caméra</span>
                </button>

                <button
                  type="button"
                  onClick={handleGallery}
                  className="px-3.5 py-2.5 rounded-2xl bg-[#6C5CE7] hover:bg-[#5b4bc4] active:scale-95 text-xs font-black text-white cursor-pointer flex items-center gap-1.5 shadow-sm transition touch-manipulation border border-indigo-500/20"
                >
                  <ImageIcon className="w-4 h-4 stroke-[2.5]" />
                  <span>Galerie</span>
                </button>

                {photoUrl && (
                  <button
                    type="button"
                    onClick={() => setPhotoUrl(undefined)}
                    className="px-2.5 py-2 rounded-xl bg-red-50 hover:bg-red-100 text-red-600 text-xs font-bold transition active:scale-95 cursor-pointer border border-red-200"
                    title="Supprimer la photo"
                  >
                    Supprimer
                  </button>
                )}
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-black text-gray-800 mb-1">
              Nom / Prénom de l'employé(e) :
            </label>
            <input
              type="text"
              required
              placeholder="Ex : Aïcha, Kodjo, Akossiwa..."
              value={nom}
              onChange={(e) => setNom(e.target.value)}
              className="w-full text-lg font-bold p-3.5 rounded-2xl border-2 border-gray-300 focus:border-[#6C5CE7] focus:outline-none bg-gray-50 text-gray-900"
            />
          </div>

          {/* CORRECTION 3 : TÉLÉPHONE AVEC SELECT INDICATIF INTERNATIONAL */}
          <div>
            <label className="block text-sm font-black text-gray-800 mb-1 flex items-center gap-1.5">
              <Phone className="w-4 h-4 text-emerald-600" />
              Numéro WhatsApp :
            </label>
            <div className="grid grid-cols-12 gap-2">
              <select
                value={phoneCountry}
                onChange={(e) => setPhoneCountry(e.target.value)}
                className="col-span-5 text-xs sm:text-sm font-bold p-3.5 rounded-2xl border-2 border-gray-300 focus:border-[#6C5CE7] focus:outline-none bg-gray-50 text-gray-900 cursor-pointer"
              >
                {COUNTRY_CODES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.flag} {c.code} ({c.country})
                  </option>
                ))}
              </select>
              <input
                type="tel"
                required
                placeholder="Ex : 91 23 45 67"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                className="col-span-7 w-full text-lg font-bold p-3.5 rounded-2xl border-2 border-gray-300 focus:border-[#6C5CE7] focus:outline-none bg-gray-50 text-gray-900"
              />
            </div>
            <p className="text-xs font-bold text-gray-400 mt-1">
              Format 8 à 10 chiffres • Indicatif {phoneCountry}
            </p>
          </div>

          {/* Double champ PIN (Création + Confirmation) pour Employé */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-black text-gray-800 mb-1 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <KeyRound className="w-4 h-4 text-amber-500" />
                  Code PIN (4 chiffres) :
                </span>
                <span className="text-xs font-bold text-gray-400">Pour se connecter</span>
              </label>
              <div className="relative">
                <input
                  type={showAddPin ? 'text' : 'password'}
                  inputMode="numeric"
                  maxLength={4}
                  required
                  placeholder="••••"
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  className="w-full text-2xl font-black text-center tracking-widest p-3.5 pr-12 rounded-2xl border-2 border-gray-300 focus:border-[#6C5CE7] focus:outline-none bg-gray-50 text-gray-900"
                />
                <button
                  type="button"
                  onClick={() => setShowAddPin(!showAddPin)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-gray-400 hover:text-gray-700 transition"
                  aria-label={showAddPin ? 'Masquer' : 'Afficher'}
                >
                  {showAddPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-black text-gray-800 mb-1 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <KeyRound className="w-4 h-4 text-indigo-500" />
                  Confirmez Code PIN :
                </span>
                {confirmPin && pin && (
                  <span className={`text-xs font-bold ${pin === confirmPin ? 'text-emerald-600' : 'text-rose-500'}`}>
                    {pin === confirmPin ? '✓ Identique' : '✗ Ne correspond pas'}
                  </span>
                )}
              </label>
              <div className="relative">
                <input
                  type={showAddConfirmPin ? 'text' : 'password'}
                  inputMode="numeric"
                  maxLength={4}
                  required
                  placeholder="••••"
                  value={confirmPin}
                  onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  className={`w-full text-2xl font-black text-center tracking-widest p-3.5 pr-12 rounded-2xl border-2 ${
                    confirmPin && pin !== confirmPin ? 'border-rose-400 bg-rose-50/30' : 'border-gray-300'
                  } focus:border-[#6C5CE7] focus:outline-none bg-gray-50 text-gray-900`}
                />
                <button
                  type="button"
                  onClick={() => setShowAddConfirmPin(!showAddConfirmPin)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-gray-400 hover:text-gray-700 transition"
                  aria-label={showAddConfirmPin ? 'Masquer' : 'Afficher'}
                >
                  {showAddConfirmPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full min-h-[70px] rounded-2xl bg-[#6C5CE7] hover:bg-[#5b4bc4] active:scale-95 text-white font-black text-xl flex items-center justify-center gap-2 shadow-lg shadow-[#6C5CE7]/25 transition"
          >
            <Check className="w-7 h-7 stroke-[3]" />
            <span>CRÉER L'ACCÈS EMPLOYÉ</span>
          </button>
        </form>
      ) : (
        <div className="p-6 rounded-3xl bg-amber-50 border-2 border-amber-300 text-center space-y-3 shadow-xs">
          <div className="w-12 h-12 rounded-2xl bg-amber-200 text-amber-900 mx-auto flex items-center justify-center font-black">
            <Lock className="w-6 h-6" />
          </div>
          <h4 className="font-black text-base text-gray-900">
            {currentPlan === 'trial' || currentPlan === 'free'
              ? '1 vendeur max en essai gratuit'
              : `Limite de ${maxAllowedEmployes} vendeurs atteinte`}
          </h4>
          <p className="text-xs font-semibold text-gray-600 max-w-md mx-auto">
            {currentPlan === 'trial' || currentPlan === 'free'
              ? 'En essai gratuit, vous avez droit à 1 vendeur max. Passez à Populaire (3 vendeurs) ou Boutique Pro (10 vendeurs).'
              : currentPlan !== 'pro'
              ? 'Passez à Boutique Pro pour débloquer jusqu\'à 10 vendeurs avec code PIN personnel.'
              : 'Vous avez atteint le maximum de 10 vendeurs autorisés.'}
          </p>
          {currentPlan !== 'pro' && onOpenSubscriptionModal && (
            <button
              type="button"
              onClick={() => onOpenSubscriptionModal('populaire', '1 vendeur max en essai gratuit. Passez à Populaire pour 3 vendeurs ou Pro pour 10')}
              className="px-5 py-2.5 rounded-2xl bg-[#6C5CE7] hover:bg-[#5848c7] active:scale-95 text-white font-black text-xs sm:text-sm shadow-md transition cursor-pointer"
            >
              Passer à Populaire (3 vendeurs) ou Pro (10) 🚀
            </button>
          )}
        </div>
      )}
      {/* MODIF 6: Modal Édition Nom Employé */}
      {editingEmp && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in duration-150">
            <div className="flex items-center justify-between">
              <h4 className="text-lg font-black text-gray-900 flex items-center gap-2">
                <Pencil className="w-5 h-5 text-blue-600" />
                <span>Modifier le nom de l'employé</span>
              </h4>
              <button
                type="button"
                onClick={() => setEditingEmp(null)}
                className="p-2 rounded-full hover:bg-gray-100 text-gray-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEditEmpName} className="space-y-4">
              <div>
                <label className="block text-xs font-black uppercase text-gray-500 mb-1">
                  Nouveau nom :
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
                  className="flex-1 py-3 rounded-2xl border border-gray-300 font-bold text-gray-600 hover:bg-gray-50 transition"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="flex-1 py-3 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white font-black shadow-md transition"
                >
                  Enregistrer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
