import React, { useState, useEffect } from 'react';
import {
  Store,
  Plus,
  Crown,
  Users,
  Package,
  Smartphone,
  Trash2,
  Check,
  AlertTriangle,
  ArrowLeft,
  Sparkles,
  Lock,
  Layers,
  ArrowRight,
} from 'lucide-react';
import type { Patron, Produit, Employe } from '../lib/types';
import { db } from '../lib/db';
import {
  isProActive,
  getOwnerStores,
  getTotalArticleCount,
  getTotalEmployeeCount,
  createSubBoutique,
  deleteSubBoutique,
  getDeviceStoreInfo,
  setDeviceStore,
  clearDeviceStore,
  PRO_MAX_ARTICLES,
  PRO_MAX_EMPLOYEES,
  PRO_MAX_BOUTIQUES,
} from '../lib/mesBoutiques';
import { speakFrench } from '../lib/speech';
import { BoutonRetour } from './BoutonRetour';

interface MesBoutiquesScreenProps {
  patron: Patron;
  onBack: () => void;
  onSelectStoreToView: (storeId: string) => void;
  onOpenSubscriptionModal?: (plan?: 'populaire' | 'pro', reason?: string) => void;
  onRefreshData?: () => void;
}

export const MesBoutiquesScreen: React.FC<MesBoutiquesScreenProps> = ({
  patron,
  onBack,
  onSelectStoreToView,
  onOpenSubscriptionModal,
  onRefreshData,
}) => {
  const [stores, setStores] = useState<Patron[]>([]);
  const [storeStats, setStoreStats] = useState<
    Record<string, { articles: number; employes: number }>
  >({});
  const [totalArticles, setTotalArticles] = useState(0);
  const [totalEmployees, setTotalEmployees] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  // Modal Ajout
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newStoreName, setNewStoreName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Appareil actuel verrouillé
  const [deviceInfo, setDeviceInfo] = useState(getDeviceStoreInfo());

  // Toast
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const isPro = isProActive(patron);
  const mainStoreId = patron.parentId || patron.ownerId || patron.id;

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3500);
  };

  const loadStoresAndStats = async () => {
    setIsLoading(true);
    try {
      const ownerStores = await getOwnerStores(mainStoreId);
      setStores(ownerStores);

      const [totArt, totEmp, allProds, allEmps] = await Promise.all([
        getTotalArticleCount(mainStoreId),
        getTotalEmployeeCount(mainStoreId),
        db.produits.toArray(),
        db.employes.toArray(),
      ]);

      setTotalArticles(totArt);
      setTotalEmployees(totEmp);

      // Calcul des stats par boutique
      const statsMap: Record<string, { articles: number; employes: number }> = {};
      for (const st of ownerStores) {
        const artCount = allProds.filter((p) => p.patron_id === st.id).length;
        const empCount = allEmps.filter(
          (e) => e.patron_id === st.id && e.status !== 'deleted' && !e.is_deleted
        ).length;
        statsMap[st.id] = { articles: artCount, employes: empCount };
      }
      setStoreStats(statsMap);
      setDeviceInfo(getDeviceStoreInfo());
    } catch (err) {
      console.warn('[MesBoutiques] Erreur chargement:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadStoresAndStats();
  }, [mainStoreId]);

  const handleOpenAddModal = () => {
    if (!isPro) {
      if (onOpenSubscriptionModal) {
        onOpenSubscriptionModal('pro', 'Débloquez l’option Mes Boutiques avec l’offre Boutique Pro');
      }
      return;
    }

    if (stores.length >= PRO_MAX_BOUTIQUES) {
      showToast(`Limite Pro atteinte : max ${PRO_MAX_BOUTIQUES} boutiques.`);
      return;
    }

    const nextIndex = stores.length + 1;
    setNewStoreName(`Boutique ${nextIndex}`);
    setCreateError(null);
    setIsAddModalOpen(true);
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStoreName.trim()) {
      setCreateError('Indiquez un nom pour la boutique.');
      return;
    }

    setIsCreating(true);
    setCreateError(null);

    const res = await createSubBoutique({
      mainPatron: patron,
      nom: newStoreName.trim(),
    });

    setIsCreating(false);

    if (res.success && res.boutique) {
      setIsAddModalOpen(false);
      speakFrench(`${res.boutique.nom_boutique} créée avec succès !`);
      showToast(`✅ ${res.boutique.nom_boutique} créée avec succès !`);
      await loadStoresAndStats();
      if (onRefreshData) onRefreshData();
    } else {
      setCreateError(res.error || 'Erreur lors de la création.');
    }
  };

  const handleDeleteStore = async (store: Patron) => {
    if (store.id === mainStoreId) {
      showToast('Impossible de supprimer la boutique principale.');
      return;
    }

    if (
      !confirm(
        `Confirmez-vous la suppression de "${store.nom_boutique}" ? Ses articles et vendeurs seront retirés.`
      )
    ) {
      return;
    }

    const res = await deleteSubBoutique(store.id, mainStoreId);
    if (res.success) {
      showToast(`Boutique "${store.nom_boutique}" supprimée.`);
      speakFrench(`Boutique ${store.nom_boutique} supprimée.`);
      await loadStoresAndStats();
      if (onRefreshData) onRefreshData();
    } else {
      showToast(res.error || 'Erreur lors de la suppression.');
    }
  };

  const handleLockDevice = (store: Patron) => {
    setDeviceStore(store.id, store.nom_boutique);
    setDeviceInfo(getDeviceStoreInfo());
    speakFrench(`Cet appareil est maintenant verrouillé sur ${store.nom_boutique}`);
    showToast(`📱 Appareil verrouillé sur "${store.nom_boutique}"`);
    onSelectStoreToView(store.id);
  };

  const handleUnlockDevice = () => {
    clearDeviceStore();
    setDeviceInfo(getDeviceStoreInfo());
    speakFrench('Appareil déverrouillé. Mode libre patron.');
    showToast('Appareil déverrouillé.');
    onSelectStoreToView(mainStoreId);
  };

  return (
    <div className="space-y-6 pb-28 select-none relative pt-2">
      {/* Toast Notification */}
      {toastMsg && (
        <div className="fixed top-4 right-4 z-50 p-3.5 bg-gray-900 text-white rounded-2xl shadow-2xl flex items-center gap-2.5 text-xs sm:text-sm font-bold border border-gray-700 animate-in fade-in">
          <Check className="w-4 h-4 text-emerald-400 stroke-[3]" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* Bouton retour mobile */}
      <BoutonRetour onBack={onBack} />

      {/* Header */}
      <div className="flex items-center justify-between gap-3 pl-14 sm:pl-0">
        <button
          type="button"
          onClick={onBack}
          className="btn hidden sm:inline-flex items-center justify-center gap-2 px-4 py-2 min-h-[44px] rounded-2xl bg-gray-200 hover:bg-gray-300 font-bold text-gray-800 transition"
        >
          <ArrowLeft className="w-5 h-5" />
          <span>Retour</span>
        </button>

        <div className="flex items-center gap-2 text-right">
          <div className="w-10 h-10 rounded-2xl bg-purple-100 text-[#6C5CE7] flex items-center justify-center font-black">
            <Store className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xl sm:text-2xl font-black text-gray-900 flex items-center justify-end gap-1.5">
              <span>MES BOUTIQUES</span>
              <span className="px-2 py-0.5 rounded-full bg-amber-400 text-slate-950 text-xs font-black uppercase">
                PRO
              </span>
            </h2>
            <p className="text-xs font-bold text-gray-500">
              Gère jusqu'à 3 points de vente avec stock et employés partagés
            </p>
          </div>
        </div>
      </div>

      {/* BANNIÈRE SI NON PRO */}
      {!isPro && (
        <div className="rounded-3xl p-6 bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 shadow-xl space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-2xl bg-white/30 flex items-center justify-center shrink-0">
              <Lock className="w-6 h-6 text-slate-950" />
            </div>
            <div>
              <h3 className="text-lg sm:text-xl font-black">
                FONCTIONNALITÉ RÉSERVÉE À L'OFFRE BOUTIQUE PRO
              </h3>
              <p className="text-xs sm:text-sm font-bold opacity-90 mt-1">
                L'offre Boutique Pro vous permet d'ouvrir jusqu'à 3 boutiques distinctes, de
                répartir vos 300 articles et 10 employés, et de verrouiller chaque téléphone sur son
                point de vente.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() =>
              onOpenSubscriptionModal &&
              onOpenSubscriptionModal('pro', 'Débloquez l’option Mes Boutiques')
            }
            className="w-full sm:w-auto px-6 py-3.5 rounded-2xl bg-slate-950 hover:bg-slate-900 active:scale-95 text-amber-300 font-black text-sm flex items-center justify-center gap-2 shadow-lg transition"
          >
            <Crown className="w-5 h-5 fill-amber-300" />
            <span>Passer à Boutique Pro (Dès 50.000 F)</span>
          </button>
        </div>
      )}

      {/* CARTES STATS RÉSUMÉ DU FORFAIT PRO RÉPARTI */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* 1. Total Articles Réunis <= 300 */}
        <div className="p-5 rounded-3xl bg-white border-2 border-orange-200 shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase tracking-wider text-orange-600 flex items-center gap-1.5">
              <Package className="w-4 h-4" />
              <span>Articles Partagés</span>
            </span>
            <span className="text-xs font-mono font-black text-gray-500">
              Max {PRO_MAX_ARTICLES}
            </span>
          </div>

          <div className="flex items-baseline justify-between">
            <p className="text-2xl sm:text-3xl font-black text-gray-900">
              {totalArticles} <span className="text-sm font-bold text-gray-400">/ {PRO_MAX_ARTICLES}</span>
            </p>
            <span
              className={`text-xs font-black px-2 py-0.5 rounded-full ${
                totalArticles >= PRO_MAX_ARTICLES
                  ? 'bg-red-100 text-red-700'
                  : 'bg-emerald-100 text-emerald-700'
              }`}
            >
              {totalArticles >= PRO_MAX_ARTICLES ? 'Plafond atteint' : `${PRO_MAX_ARTICLES - totalArticles} restants`}
            </span>
          </div>

          {/* Barre progression */}
          <div className="w-full bg-gray-100 h-2.5 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all rounded-full ${
                totalArticles >= PRO_MAX_ARTICLES
                  ? 'bg-red-500'
                  : totalArticles >= 250
                  ? 'bg-amber-500'
                  : 'bg-emerald-500'
              }`}
              style={{
                width: `${Math.min(100, Math.round((totalArticles / PRO_MAX_ARTICLES) * 100))}%`,
              }}
            />
          </div>
        </div>

        {/* 2. Total Employés Réunis <= 10 */}
        <div className="p-5 rounded-3xl bg-white border-2 border-purple-200 shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase tracking-wider text-purple-700 flex items-center gap-1.5">
              <Users className="w-4 h-4" />
              <span>Employés Réunis</span>
            </span>
            <span className="text-xs font-mono font-black text-gray-500">
              Max {PRO_MAX_EMPLOYEES}
            </span>
          </div>

          <div className="flex items-baseline justify-between">
            <p className="text-2xl sm:text-3xl font-black text-gray-900">
              {totalEmployees} <span className="text-sm font-bold text-gray-400">/ {PRO_MAX_EMPLOYEES}</span>
            </p>
            <span
              className={`text-xs font-black px-2 py-0.5 rounded-full ${
                totalEmployees >= PRO_MAX_EMPLOYEES
                  ? 'bg-red-100 text-red-700'
                  : 'bg-purple-100 text-purple-700'
              }`}
            >
              {PRO_MAX_EMPLOYEES - totalEmployees} places
            </span>
          </div>

          {/* Barre progression */}
          <div className="w-full bg-gray-100 h-2.5 rounded-full overflow-hidden">
            <div
              className="h-full bg-purple-600 transition-all rounded-full"
              style={{
                width: `${Math.min(100, Math.round((totalEmployees / PRO_MAX_EMPLOYEES) * 100))}%`,
              }}
            />
          </div>
        </div>

        {/* 3. Boutiques Actives <= 3 */}
        <div className="p-5 rounded-3xl bg-white border-2 border-emerald-200 shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase tracking-wider text-emerald-700 flex items-center gap-1.5">
              <Store className="w-4 h-4" />
              <span>Boutiques Ouvertes</span>
            </span>
            <span className="text-xs font-mono font-black text-gray-500">
              Max {PRO_MAX_BOUTIQUES}
            </span>
          </div>

          <div className="flex items-baseline justify-between">
            <p className="text-2xl sm:text-3xl font-black text-gray-900">
              {stores.length} <span className="text-sm font-bold text-gray-400">/ {PRO_MAX_BOUTIQUES}</span>
            </p>
            <span className="text-xs font-black px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
              {PRO_MAX_BOUTIQUES - stores.length > 0
                ? `+${PRO_MAX_BOUTIQUES - stores.length} possible`
                : 'Plein'}
            </span>
          </div>

          <div className="w-full bg-gray-100 h-2.5 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-all rounded-full"
              style={{
                width: `${Math.min(100, Math.round((stores.length / PRO_MAX_BOUTIQUES) * 100))}%`,
              }}
            />
          </div>
        </div>
      </div>

      {/* APPAREIL ACTUEL VERROUILLÉ OU NON */}
      <div className="p-4 rounded-3xl bg-slate-900 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-white/20 flex items-center justify-center shrink-0">
            <Smartphone className="w-5 h-5 text-amber-300" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase font-bold text-slate-400">Statut de cet appareil :</span>
              {deviceInfo.isLocked ? (
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/30 text-emerald-300 border border-emerald-400 text-[10px] font-black uppercase">
                  Verrouillé
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full bg-slate-700 text-slate-300 text-[10px] font-bold">
                  Mode Libre Patron
                </span>
              )}
            </div>
            <p className="text-sm sm:text-base font-black text-white">
              📱 {deviceInfo.storeName ? `Point de vente : ${deviceInfo.storeName}` : 'Toutes les boutiques accessibles'}
            </p>
          </div>
        </div>

        {deviceInfo.isLocked && (
          <button
            type="button"
            onClick={handleUnlockDevice}
            className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 font-bold text-xs transition cursor-pointer self-start sm:self-auto"
          >
            Déverrouiller cet appareil
          </button>
        )}
      </div>

      {/* BOUTON GROS : + AJOUTER UNE BOUTIQUE */}
      <div className="flex items-center justify-between pt-2">
        <h3 className="text-lg sm:text-xl font-black text-gray-900">
          Tes points de vente ({stores.length} / {PRO_MAX_BOUTIQUES}) :
        </h3>

        <button
          type="button"
          onClick={handleOpenAddModal}
          disabled={!isPro || stores.length >= PRO_MAX_BOUTIQUES}
          className={`px-5 py-3 rounded-2xl font-black text-sm flex items-center gap-2 shadow-lg transition active:scale-95 cursor-pointer ${
            !isPro || stores.length >= PRO_MAX_BOUTIQUES
              ? 'bg-gray-200 text-gray-400 cursor-not-allowed shadow-none'
              : 'bg-[#6C5CE7] hover:bg-[#5b4cc4] text-white shadow-purple-500/25'
          }`}
        >
          <Plus className="w-5 h-5 stroke-[3]" />
          <span>+ AJOUTER UNE BOUTIQUE</span>
        </button>
      </div>

      {/* LISTE DES BOUTIQUES */}
      <div className="grid grid-cols-1 gap-3.5">
        {stores.map((store, idx) => {
          const isMain = store.type === 'MAIN' || !store.parentId;
          const stats = storeStats[store.id] || { articles: 0, employes: 0 };
          const isCurrentDevice = deviceInfo.storeId === store.id;

          return (
            <div
              key={store.id}
              className={`p-5 rounded-3xl bg-white border-2 shadow-sm transition space-y-4 ${
                isCurrentDevice
                  ? 'border-[#6C5CE7] ring-4 ring-purple-100'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3.5">
                  <div
                    className={`w-14 h-14 rounded-2xl flex items-center justify-center font-black text-xl shrink-0 ${
                      isMain
                        ? 'bg-amber-400 text-amber-950 border-2 border-amber-500 shadow-sm'
                        : 'bg-purple-100 text-[#6C5CE7] border-2 border-purple-200'
                    }`}
                  >
                    <Store className="w-7 h-7" />
                  </div>

                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-xl font-black text-gray-900">
                        {store.nom_boutique}
                      </h4>
                      {isMain ? (
                        <span className="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 text-[11px] font-black uppercase">
                          Boutique Principale
                        </span>
                      ) : (
                        <span className="px-2.5 py-0.5 rounded-full bg-purple-100 text-[#6C5CE7] text-[11px] font-black uppercase">
                          Sous-Boutique #{idx + 1}
                        </span>
                      )}
                      {isCurrentDevice && (
                        <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 text-[10px] font-black">
                          📱 Actif sur ce tel
                        </span>
                      )}
                    </div>
                    <p className="text-xs font-bold text-gray-400 mt-0.5">
                      ID: {store.id} • Responsable : {store.nom}
                    </p>
                  </div>
                </div>

                {/* Actions principales par boutique */}
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => onSelectStoreToView(store.id)}
                    className="px-4 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-800 font-black text-xs flex items-center gap-1.5 transition cursor-pointer"
                    title="Afficher les données de cette boutique"
                  >
                    <span>Afficher</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>

                  <button
                    type="button"
                    onClick={() => handleLockDevice(store)}
                    className={`px-4 py-2.5 rounded-xl font-black text-xs flex items-center gap-1.5 transition cursor-pointer shadow-xs ${
                      isCurrentDevice
                        ? 'bg-emerald-600 text-white'
                        : 'bg-[#6C5CE7] hover:bg-[#5b4cc4] text-white'
                    }`}
                    title="Verrouiller ce téléphone pour ce point de vente"
                  >
                    <Smartphone className="w-3.5 h-3.5" />
                    <span>{isCurrentDevice ? 'Verrouillé ici ✅' : 'Verrouiller ce tél'}</span>
                  </button>

                  {!isMain && (
                    <button
                      type="button"
                      onClick={() => handleDeleteStore(store)}
                      className="p-2.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-bold transition cursor-pointer"
                      title="Supprimer cette sous-boutique"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Badges métriques de la boutique */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 pt-2 border-t border-gray-100">
                <div className="p-2.5 rounded-2xl bg-gray-50 border border-gray-200">
                  <span className="text-[10px] uppercase font-bold text-gray-400 block">Articles en stock</span>
                  <span className="text-base font-black text-gray-900">{stats.articles} articles</span>
                </div>

                <div className="p-2.5 rounded-2xl bg-gray-50 border border-gray-200">
                  <span className="text-[10px] uppercase font-bold text-gray-400 block">Vendeurs affectés</span>
                  <span className="text-base font-black text-gray-900">{stats.employes} vendeurs</span>
                </div>

                <div className="p-2.5 rounded-2xl bg-gray-50 border border-gray-200 col-span-2 sm:col-span-1">
                  <span className="text-[10px] uppercase font-bold text-gray-400 block">Mode de vente</span>
                  <span className="text-xs font-black text-indigo-700">Comptant & Crédit EFA</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* MODAL CRÉATION SOUS-BOUTIQUE */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm animate-in fade-in select-none">
          <div className="w-full max-w-md bg-white rounded-3xl p-6 sm:p-8 shadow-2xl border-4 border-[#6C5CE7] space-y-5">
            <div className="text-center space-y-1">
              <div className="w-14 h-14 rounded-2xl bg-purple-100 text-[#6C5CE7] flex items-center justify-center mx-auto border border-purple-200">
                <Store className="w-7 h-7" />
              </div>
              <h3 className="text-2xl font-black text-gray-900">
                Nouvelle Sous-Boutique
              </h3>
              <p className="text-xs font-bold text-gray-500">
                Point de vente additionnel rattaché à votre compte Pro ({stores.length + 1} / {PRO_MAX_BOUTIQUES})
              </p>
            </div>

            <form onSubmit={handleCreateSubmit} className="space-y-4">
              <div className="space-y-1">
                <label className="block text-xs font-black uppercase text-gray-600">
                  Nom de la boutique
                </label>
                <input
                  type="text"
                  autoFocus
                  value={newStoreName}
                  onChange={(e) => setNewStoreName(e.target.value)}
                  placeholder="Ex : Boutique 2, Dépôt Grand Marché..."
                  className="w-full p-4 rounded-2xl border-2 border-purple-200 focus:border-[#6C5CE7] text-base font-black outline-none"
                />
                {createError && (
                  <p className="text-xs font-black text-red-600">{createError}</p>
                )}
              </div>

              <div className="p-3.5 rounded-2xl bg-purple-50 border border-purple-200 text-xs font-bold text-purple-900 space-y-1">
                <div className="flex items-center gap-1.5 font-black text-[#6C5CE7]">
                  <Sparkles className="w-4 h-4" />
                  <span>Avantage Pro Inclus :</span>
                </div>
                <p>
                  • Stock partagé : pioche dans votre total de {PRO_MAX_ARTICLES} articles.
                </p>
                <p>
                  • Équipe partagée : pioche dans votre total de {PRO_MAX_EMPLOYEES} vendeurs.
                </p>
                <p>
                  • Vous vous connectez sur le téléphone de cette boutique avec votre même code PIN patron.
                </p>
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="flex-1 py-3.5 px-4 rounded-2xl bg-gray-100 text-gray-700 font-black text-sm hover:bg-gray-200 transition"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={isCreating || !newStoreName.trim()}
                  className="flex-1 py-3.5 px-4 rounded-2xl bg-[#6C5CE7] text-white font-black text-sm hover:bg-[#5b4cc4] transition shadow-lg shadow-purple-500/25 disabled:opacity-50"
                >
                  {isCreating ? 'Création...' : 'Créer la boutique'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
export default MesBoutiquesScreen;
