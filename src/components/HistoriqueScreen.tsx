import React, { useState, useMemo, useEffect } from 'react';
import {
  ArrowLeft,
  FileSpreadsheet,
  Filter,
  Calendar,
  User,
  Search,
  ShoppingCart,
  PackagePlus,
  Edit3,
  Trash2,
  LogIn,
  LogOut,
  UserPlus,
  ShieldAlert,
  Sparkles,
  Lock,
  Download,
  Clock,
} from 'lucide-react';
import type { Patron, Employe, HistoriqueAction, ActionType } from '../lib/types';
import { getHistoriqueActions, formatLocalDate, exportHistoriqueCSV } from '../lib/historique';
import { hasAccess } from '../lib/checkLimits';
import { BoutonRetour } from './BoutonRetour';

interface HistoriqueScreenProps {
  patron: Patron;
  employes: Employe[];
  onBack: () => void;
  onOpenSubscriptionModal: (plan?: 'populaire' | 'pro', reason?: string) => void;
}

export const HistoriqueScreen: React.FC<HistoriqueScreenProps> = ({
  patron,
  employes,
  onBack,
  onOpenSubscriptionModal,
}) => {
  const [actions, setActions] = useState<HistoriqueAction[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Filtres
  const [selectedType, setSelectedType] = useState<string>('all');
  const [selectedActor, setSelectedActor] = useState<string>('all');
  const [selectedPeriod, setSelectedPeriod] = useState<string>('all'); // all, today, 7days, 30days
  const [searchQuery, setSearchQuery] = useState('');

  // Charger les actions depuis Dexie
  useEffect(() => {
    let isMounted = true;
    getHistoriqueActions(patron.id).then((list) => {
      if (isMounted) {
        setActions(list);
        setIsLoading(false);
      }
    });
    return () => {
      isMounted = false;
    };
  }, [patron.id]);

  // Filtrage
  const filteredActions = useMemo(() => {
    return actions.filter((act) => {
      // 1. Type
      if (selectedType !== 'all' && act.action_type !== selectedType) {
        return false;
      }

      // 2. Acteur (patron ou employé)
      if (selectedActor === 'patron') {
        if (act.employe_id) return false;
      } else if (selectedActor !== 'all') {
        if (act.employe_id !== selectedActor) return false;
      }

      // 3. Période
      if (selectedPeriod !== 'all') {
        const actDate = new Date(act.created_at);
        const now = new Date();
        if (selectedPeriod === 'today') {
          if (
            actDate.getDate() !== now.getDate() ||
            actDate.getMonth() !== now.getMonth() ||
            actDate.getFullYear() !== now.getFullYear()
          ) {
            return false;
          }
        } else if (selectedPeriod === '7days') {
          const limit7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          if (actDate < limit7) return false;
        } else if (selectedPeriod === '30days') {
          const limit30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          if (actDate < limit30) return false;
        }
      }

      // 4. Recherche texte
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const descMatch = act.description.toLowerCase().includes(query);
        const actorMatch = (act.employe_nom || 'Patron').toLowerCase().includes(query);
        const typeMatch = act.action_type.toLowerCase().includes(query);
        if (!descMatch && !actorMatch && !typeMatch) return false;
      }

      return true;
    });
  }, [actions, selectedType, selectedActor, selectedPeriod, searchQuery]);

  // Export CSV
  const handleExportCSV = () => {
    exportHistoriqueCSV(filteredActions, patron.nom_boutique || 'Efa');
  };

  // Export Compta Avancé (Feature Pro)
  const handleAdvancedExport = () => {
    if (!hasAccess(patron, 'advanced_export')) {
      onOpenSubscriptionModal('pro', 'Export comptable avancé avec journal des écritures & TVA');
      return;
    }
    // Si abonné Pro
    exportHistoriqueCSV(actions, (patron.nom_boutique || 'Efa') + '_GrandLivre');
  };

  const getActionBadge = (type: ActionType) => {
    switch (type) {
      case 'vente':
        return {
          label: 'Vente',
          icon: <ShoppingCart className="w-3.5 h-3.5" />,
          color: 'bg-emerald-100 text-emerald-800 border-emerald-300',
        };
      case 'ajout_stock':
        return {
          label: 'Ajout stock',
          icon: <PackagePlus className="w-3.5 h-3.5" />,
          color: 'bg-amber-100 text-amber-800 border-amber-300',
        };
      case 'modif_stock':
        return {
          label: 'Modif stock',
          icon: <Edit3 className="w-3.5 h-3.5" />,
          color: 'bg-blue-100 text-blue-800 border-blue-300',
        };
      case 'suppression':
        return {
          label: 'Suppression',
          icon: <Trash2 className="w-3.5 h-3.5" />,
          color: 'bg-red-100 text-red-800 border-red-300',
        };
      case 'connexion':
        return {
          label: 'Connexion',
          icon: <LogIn className="w-3.5 h-3.5" />,
          color: 'bg-purple-100 text-purple-800 border-purple-300',
        };
      case 'deconnexion':
        return {
          label: 'Déconnexion',
          icon: <LogOut className="w-3.5 h-3.5" />,
          color: 'bg-gray-100 text-gray-800 border-gray-300',
        };
      case 'creation_employe':
        return {
          label: 'Création employé',
          icon: <UserPlus className="w-3.5 h-3.5" />,
          color: 'bg-indigo-100 text-indigo-800 border-indigo-300',
        };
      case 'blocage_employe':
        return {
          label: 'Blocage',
          icon: <ShieldAlert className="w-3.5 h-3.5" />,
          color: 'bg-rose-100 text-rose-800 border-rose-300',
        };
      case 'remboursement_dette':
        return {
          label: 'Dettes',
          icon: <span className="text-xs">💰</span>,
          color: 'bg-emerald-100 text-emerald-900 border-emerald-400 font-black',
        };
      default:
        return {
          label: type,
          icon: <Clock className="w-3.5 h-3.5" />,
          color: 'bg-gray-100 text-gray-800 border-gray-200',
        };
    }
  };

  return (
    <div className="space-y-6 pb-28 select-none relative pt-2">
      {/* CORRECTION 3: Bouton Retour tactile mobile responsive */}
      <BoutonRetour onBack={onBack} />

      {/* En-tête avec bouton retour */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pl-14 sm:pl-0">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="hidden sm:inline-flex min-h-[44px] px-4 py-2 rounded-2xl bg-gray-100 hover:bg-gray-200 active:bg-gray-300 text-gray-800 font-black text-sm items-center gap-2 transition"
          >
            <ArrowLeft className="w-5 h-5" />
            <span>Retour</span>
          </button>
          <div>
            <h2 className="text-xl sm:text-2xl font-black text-gray-900 tracking-tight">
              HISTORIQUE COMPLET DES ACTIONS
            </h2>
            <p className="text-xs sm:text-sm font-bold text-gray-500">
              Traçabilité certifiée : ventes, stock, connexions et suppressions
            </p>
          </div>
        </div>

        {/* Boutons Export CSV & Export Pro */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleExportCSV}
            className="min-h-[44px] px-4 py-2.5 rounded-2xl bg-[#00B894] hover:bg-emerald-600 active:scale-95 text-white font-black text-xs sm:text-sm flex items-center gap-2 shadow-sm transition"
          >
            <Download className="w-4 h-4 stroke-[2.5]" />
            <span>Exporter CSV ({filteredActions.length})</span>
          </button>

          {/* Bouton Export Compta Avancé PRO */}
          <button
            type="button"
            onClick={handleAdvancedExport}
            className="min-h-[44px] px-4 py-2.5 rounded-2xl bg-amber-500/20 hover:bg-amber-500/30 active:scale-95 text-amber-900 border-2 border-amber-400 font-black text-xs sm:text-sm flex items-center gap-1.5 transition opacity-80 hover:opacity-100"
          >
            <Lock className="w-4 h-4 text-amber-700" />
            <span>Export Compta Avancé</span>
            <span className="bg-amber-400 text-amber-950 text-[10px] px-1.5 py-0.2 rounded font-black uppercase">
              PRO
            </span>
          </button>
        </div>
      </div>

      {/* Cartes récapitulatives rapides */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-4 rounded-2xl bg-white border border-gray-200 shadow-sm">
          <span className="text-xs font-black text-gray-400 uppercase">Total actions</span>
          <p className="text-2xl font-black text-gray-900 mt-1">{actions.length}</p>
        </div>
        <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 shadow-sm">
          <span className="text-xs font-black text-emerald-700 uppercase">Ventes enregistrées</span>
          <p className="text-2xl font-black text-emerald-800 mt-1">
            {actions.filter((a) => a.action_type === 'vente').length}
          </p>
        </div>
        <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 shadow-sm">
          <span className="text-xs font-black text-amber-700 uppercase">Mouvements Stock</span>
          <p className="text-2xl font-black text-amber-800 mt-1">
            {actions.filter((a) => a.action_type === 'ajout_stock' || a.action_type === 'modif_stock').length}
          </p>
        </div>
        <div className="p-4 rounded-2xl bg-purple-50 border border-purple-200 shadow-sm">
          <span className="text-xs font-black text-purple-700 uppercase">Équipe & Sécurité</span>
          <p className="text-2xl font-black text-purple-800 mt-1">
            {actions.filter((a) => ['connexion', 'creation_employe', 'blocage_employe'].includes(a.action_type)).length}
          </p>
        </div>
      </div>

      {/* Barre de filtres complets */}
      <div className="bg-white rounded-3xl p-4 sm:p-5 border border-gray-200 shadow-sm space-y-4">
        <div className="flex items-center gap-2 text-sm font-black text-gray-800">
          <Filter className="w-4 h-4 text-[#6C5CE7]" />
          <span>Filtres de recherche :</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Recherche mot-clé */}
          <div className="relative">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Rechercher description..."
              className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-gray-300 text-xs sm:text-sm font-bold text-gray-800 focus:outline-none focus:border-[#6C5CE7]"
            />
          </div>

          {/* Type d'action */}
          <div>
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-gray-300 text-xs sm:text-sm font-bold text-gray-800 bg-white focus:outline-none focus:border-[#6C5CE7]"
            >
              <option value="all">Toutes les actions</option>
              <option value="vente">🛒 Vente</option>
              <option value="remboursement_dette">💰 Dettes</option>
              <option value="ajout_stock">📦 Ajout de stock</option>
              <option value="modif_stock">✏️ Modif stock</option>
              <option value="suppression">🗑️ Suppression</option>
              <option value="connexion">🔑 Connexion</option>
              <option value="creation_employe">👤 Création employé</option>
              <option value="blocage_employe">🚫 Blocage employé</option>
            </select>
          </div>

          {/* Acteur (Qui) */}
          <div>
            <select
              value={selectedActor}
              onChange={(e) => setSelectedActor(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-gray-300 text-xs sm:text-sm font-bold text-gray-800 bg-white focus:outline-none focus:border-[#6C5CE7]"
            >
              <option value="all">Tous les utilisateurs</option>
              <option value="patron">👑 Patron ({patron.nom})</option>
              {employes.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  👤 {emp.nom} ({emp.genre === 'femme' ? 'Vendeuse' : 'Vendeur'})
                </option>
              ))}
            </select>
          </div>

          {/* Période */}
          <div>
            <select
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-gray-300 text-xs sm:text-sm font-bold text-gray-800 bg-white focus:outline-none focus:border-[#6C5CE7]"
            >
              <option value="all">Toutes les dates</option>
              <option value="today">Aujourd'hui</option>
              <option value="7days">7 derniers jours</option>
              <option value="30days">30 derniers jours</option>
            </select>
          </div>
        </div>
      </div>

      {/* TABLEAU DES ACTIONS */}
      <div className="bg-white rounded-3xl border border-gray-200 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-gray-400 font-bold">
            Chargement de l'historique...
          </div>
        ) : filteredActions.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <Clock className="w-10 h-10 text-gray-300 mx-auto" />
            <p className="text-base font-black text-gray-600">Aucune action trouvée</p>
            <p className="text-xs font-bold text-gray-400">
              Les ventes, mouvements de stock et connexions apparaîtront automatiquement ici.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs sm:text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-gray-600 font-black uppercase text-[11px] tracking-wider">
                  <th className="py-3 px-4">Date & Heure</th>
                  <th className="py-3 px-3">Action</th>
                  <th className="py-3 px-4">Qui</th>
                  <th className="py-3 px-4">Description</th>
                  <th className="py-3 px-4 text-right">Montant</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 font-medium">
                {filteredActions.map((act) => {
                  const badge = getActionBadge(act.action_type);
                  const isPatronActor = !act.employe_id;

                  return (
                    <tr key={act.id} className="hover:bg-gray-50/80 transition">
                      {/* Date exacte synchronisée locale */}
                      <td className="py-3.5 px-4 font-mono font-bold text-gray-700 whitespace-nowrap">
                        {formatLocalDate(act.created_at)}
                      </td>

                      {/* Type d'action */}
                      <td className="py-3.5 px-3 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-black border ${badge.color}`}
                        >
                          {badge.icon}
                          <span>{badge.label}</span>
                        </span>
                      </td>

                      {/* Qui */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-1.5 font-bold">
                          {isPatronActor ? (
                            <span className="inline-flex items-center gap-1 text-amber-700 bg-amber-50 px-2 py-0.5 rounded-lg border border-amber-200">
                              <span>👑 Patron</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-purple-700 bg-purple-50 px-2 py-0.5 rounded-lg border border-purple-200">
                              <span>👤 {act.employe_nom || 'Employé(e)'}</span>
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Description */}
                      <td className="py-3.5 px-4 font-bold text-gray-900 max-w-md">
                        {act.action_type === 'remboursement_dette' ? (
                          <div className="flex items-center gap-1.5 text-emerald-900">
                            <span className="text-base flex-shrink-0">💰</span>
                            <span>{act.description}</span>
                          </div>
                        ) : (
                          act.description
                        )}
                      </td>

                      {/* Montant */}
                      <td className="py-3.5 px-4 text-right whitespace-nowrap font-black">
                        {act.montant !== undefined && act.montant !== null ? (
                          <span className="text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-xl">
                            {act.montant.toLocaleString('fr-FR')} F CFA
                          </span>
                        ) : (
                          <span className="text-gray-300">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
