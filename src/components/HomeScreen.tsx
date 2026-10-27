import React from 'react';
import {
  ShoppingCart,
  Wallet,
  PlusCircle,
  Lock,
  Receipt,
  Users,
  Gift,
  Sparkles,
  History,
  Crown,
  ChevronRight,
  ShieldCheck,
  Building2,
  FileCheck2,
  Headset,
  Store,
} from 'lucide-react';
import type { Patron, CurrentUser } from '../lib/types';
import { getAccord } from '../lib/accord';
import { getRemainingTrialDays, isSubscriptionExpired, hasAccess } from '../lib/checkLimits';
import { isProActive } from '../lib/mesBoutiques';

interface HomeScreenProps {
  patron: Patron;
  currentUser: CurrentUser;
  onNavigate: (tab: 'home' | 'vendre' | 'mon-argent' | 'stock' | 'ajouter' | 'employes' | 'ambassadrice' | 'mes-ventes' | 'historique' | 'mes-boutiques') => void;
  onOpenSubscriptionModal?: (plan?: 'populaire' | 'pro', reason?: string) => void;
  onOpenMonAbonnementModal?: () => void;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({
  patron,
  currentUser,
  onNavigate,
  onOpenSubscriptionModal,
  onOpenMonAbonnementModal,
}) => {
  const isPatron = currentUser.role === 'patron';
  const accord = getAccord(currentUser.genre);
  const remainingTrialDays = getRemainingTrialDays(patron);
  const currentPlan = patron.subscription_status || 'trial';
  const isSubStore = patron.type === 'SUB' || Boolean(patron.parentId);
  const isPro = isProActive(patron);

  // MODIF 2: Bienvenue vendeur / vendeuse automatique selon le genre
  const welcomePrefix = isPatron
    ? (patron.genre === 'femme' ? 'Bienvenue patronne' : 'Bienvenu patron')
    : (currentUser.genre === 'femme' ? 'Bienvenue vendeuse' : 'Bienvenu vendeur');

  return (
    <div className="space-y-6 pb-28 select-none">
      {/* MODIF 3: TCA DASHBOARD - OR JAUNE ANIMÉ STYLÉ + ICÔNE ✨ CLIGNOTANTE */}
      <div className="gold-tca-card rounded-3xl p-6 text-[#1E3A8A] shadow-2xl relative overflow-hidden ring-2 ring-amber-300 ring-offset-2">
        <div className="relative z-10">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 mb-2.5">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-amber-400/40 border border-amber-600/30 text-xs font-black uppercase tracking-wider text-[#1E3A8A] w-fit">
              <Sparkles className="w-4 h-4 text-[#1E3A8A] animate-spin" style={{ animationDuration: '4s' }} />
              <span>{patron.nom_boutique || 'Ma Boutique'}</span>
              <Sparkles className="w-3.5 h-3.5 text-amber-900 animate-pulse" />
            </div>

            {/* Scope = role='patron' UNIQUEMENT & Boutique Principale */}
            {isPatron && !isSubStore && (
              <div className="flex flex-wrap items-center gap-2">
                {onOpenMonAbonnementModal && (
                  <button
                    type="button"
                    onClick={onOpenMonAbonnementModal}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-slate-900 hover:bg-slate-800 active:scale-95 text-amber-300 text-[11px] sm:text-xs font-black tracking-wide shadow-md border border-amber-400 transition cursor-pointer touch-manipulation group"
                    title="Mon Abonnement / Forfait Actif"
                  >
                    <Crown className="w-3.5 h-3.5 text-amber-400 fill-amber-400 group-hover:scale-110 transition-transform" />
                    <span>Mon Abonnement</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (typeof window !== 'undefined') {
                      window.history.pushState({}, '', '/ambassadrice');
                    }
                    onNavigate('ambassadrice');
                  }}
                  className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-red-600 hover:bg-red-700 active:scale-95 text-white text-[11px] sm:text-xs font-black tracking-wide shadow-md shadow-red-600/30 border border-red-500 transition cursor-pointer w-fit self-start sm:self-auto touch-manipulation group"
                  title="Gagner 12 mois gratuits - Clique pour savoir plus"
                >
                  <Gift className="w-3.5 h-3.5 text-white shrink-0 animate-bounce" />
                  <span>Gagner 12 mois gratuits</span>
                  <ChevronRight className="w-3.5 h-3.5 text-white/90 group-hover:translate-x-0.5 transition-transform" />
                </button>
              </div>
            )}
          </div>

          <h2 className="text-2xl sm:text-3xl font-black text-[#1E3A8A] tracking-tight">
            {welcomePrefix} {isPatron ? patron.nom : (currentUser.prenom || currentUser.nom)} !
          </h2>

          <p className="text-[#1E3A8A]/90 font-bold text-sm sm:text-base mt-1">
            {isPatron
              ? 'Touche un bouton pour commencer à gérer ta caisse, ou utilise le micro vocal.'
              : 'Enregistre tes ventes facilement. Tes commissions sont calculées automatiquement.'}
          </p>

          {/* SLOGAN DANS CARTE OR JAUNE */}
          <div
            className="mt-4 pt-3 border-t border-amber-600/30 text-center tracking-wide font-black"
            style={{
              fontFamily: "'Dancing Script', cursive",
              fontStyle: 'italic',
              fontSize: '18px',
              color: '#1E3A8A',
            }}
          >
            « avec Efa Aconta, les comptes deviennent faciles »
          </div>
        </div>
      </div>

      {/* CAS 1 : HOME PATRON - 3 GROS BOUTONS GÉANTS >= 80PX */}
      {isPatron ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4">
            {/* 1. VENDRE (vert #00B894, icône panier) */}
            <button
              type="button"
              onClick={() => onNavigate('vendre')}
              className="min-h-[96px] w-full p-6 rounded-3xl bg-[#00B894] hover:bg-[#00a382] active:scale-[0.98] text-white flex items-center justify-between shadow-xl shadow-emerald-500/25 transition border-2 border-emerald-400"
            >
              <div className="flex items-center gap-5 text-left">
                <div className="w-16 h-16 rounded-2xl bg-white/20 flex items-center justify-center">
                  <ShoppingCart className="w-10 h-10 stroke-[2.5]" />
                </div>
                <div>
                  <span className="block text-2xl sm:text-3xl font-black tracking-wide">
                    VENDRE
                  </span>
                  <span className="text-sm sm:text-base font-bold text-emerald-100">
                    Comptant ou Crédit client (Panier)
                  </span>
                </div>
              </div>
              <span className="text-3xl font-black opacity-80">➔</span>
            </button>

            {/* 2. MON ARGENT (bleu #0984E3, wallet) */}
            <button
              type="button"
              onClick={() => onNavigate('mon-argent')}
              className="min-h-[96px] w-full p-6 rounded-3xl bg-[#0984E3] hover:bg-[#0873c4] active:scale-[0.98] text-white flex items-center justify-between shadow-xl shadow-blue-500/25 transition border-2 border-blue-400"
            >
              <div className="flex items-center gap-5 text-left">
                <div className="w-16 h-16 rounded-2xl bg-white/20 flex items-center justify-center">
                  <Wallet className="w-10 h-10 stroke-[2.5]" />
                </div>
                <div>
                  <span className="block text-2xl sm:text-3xl font-black tracking-wide">
                    MON ARGENT
                  </span>
                  <span className="text-sm sm:text-base font-bold text-blue-100">
                    Caisse, Dépenses & Bénéfice
                  </span>
                </div>
              </div>
              <span className="text-3xl font-black opacity-80">➔</span>
            </button>

            {/* 3. STOCK & ARTICLES (orange #E17055, +) */}
            <button
              type="button"
              onClick={() => onNavigate('stock')}
              className="min-h-[96px] w-full p-6 rounded-3xl bg-[#E17055] hover:bg-[#cf634a] active:scale-[0.98] text-white flex items-center justify-between shadow-xl shadow-orange-500/25 transition border-2 border-orange-400"
            >
              <div className="flex items-center gap-5 text-left">
                <div className="w-16 h-16 rounded-2xl bg-white/20 flex items-center justify-center">
                  <PlusCircle className="w-10 h-10 stroke-[2.5]" />
                </div>
                <div>
                  <span className="block text-2xl sm:text-3xl font-black tracking-wide">
                    STOCK & ARTICLES
                  </span>
                  <span className="text-sm sm:text-base font-bold text-orange-100">
                    Modifier, Quantités & Nouveaux produits
                  </span>
                </div>
              </div>
              <span className="text-3xl font-black opacity-80">➔</span>
            </button>
          </div>

          {/* Cartes secondaires pour Patron */}
          {!isSubStore ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
              {/* Carte Mes Boutiques (Pro uniquement, visible sur boutique principale) */}
              {isPro ? (
                <button
                  type="button"
                  onClick={() => onNavigate('mes-boutiques')}
                  className="p-4 sm:p-5 rounded-3xl bg-purple-50 hover:bg-purple-100 border-2 border-purple-300 text-left transition shadow-sm cursor-pointer"
                >
                  <div className="w-11 h-11 rounded-2xl bg-[#6C5CE7] text-white flex items-center justify-center mb-2 shadow-sm">
                    <Store className="w-6 h-6" />
                  </div>
                  <div className="flex items-center gap-1">
                    <h4 className="text-base sm:text-lg font-black text-gray-900">Mes Boutiques</h4>
                    <span className="px-1.5 py-0.2 rounded-full bg-purple-200 text-[#6C5CE7] text-[10px] font-black uppercase">
                      PRO
                    </span>
                  </div>
                  <p className="text-xs font-bold text-purple-700 mt-0.5">
                    3 boutiques max
                  </p>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onOpenSubscriptionModal?.('pro', 'Débloquez l’option Mes Boutiques avec l’offre Boutique Pro (jusqu’à 3 boutiques)')}
                  className="p-4 sm:p-5 rounded-3xl bg-gray-50 hover:bg-amber-50/60 border-2 border-gray-200 hover:border-amber-300 text-left transition shadow-sm cursor-pointer"
                >
                  <div className="w-11 h-11 rounded-2xl bg-gray-200 text-gray-600 flex items-center justify-center mb-2">
                    <Store className="w-6 h-6" />
                  </div>
                  <h4 className="text-base sm:text-lg font-black text-gray-700 flex items-center gap-1">
                    <span>Mes Boutiques</span>
                    <Lock className="w-3.5 h-3.5 text-amber-600" />
                  </h4>
                  <p className="text-xs font-bold text-amber-700 mt-0.5">
                    Débloque avec Pro
                  </p>
                </button>
              )}

              <button
                type="button"
                onClick={() => onNavigate('ambassadrice')}
                className="p-4 sm:p-5 rounded-3xl bg-amber-50 hover:bg-amber-100 border-2 border-amber-300 text-left transition shadow-sm cursor-pointer"
              >
                <div className="w-11 h-11 rounded-2xl bg-amber-400 text-amber-950 flex items-center justify-center mb-2 shadow-sm">
                  <Gift className="w-6 h-6" />
                </div>
                <h4 className="text-base sm:text-lg font-black text-gray-900">Ambassadrice</h4>
                <p className="text-xs font-bold text-amber-700 mt-0.5">
                  Mois gratuits & Parrainage
                </p>
              </button>

              <button
                type="button"
                onClick={() => onNavigate('employes')}
                className="p-4 sm:p-5 rounded-3xl bg-purple-50 hover:bg-purple-100 border-2 border-purple-200 text-left transition shadow-sm cursor-pointer"
              >
                <div className="w-11 h-11 rounded-2xl bg-[#6C5CE7] text-white flex items-center justify-center mb-2 shadow-sm">
                  <Users className="w-6 h-6" />
                </div>
                <h4 className="text-base sm:text-lg font-black text-gray-900">
                  {accord.titrePatron === 'Patronne' ? 'Mes Vendeuses' : 'Mes Vendeurs'}
                </h4>
                <p className="text-xs font-bold text-purple-700 mt-0.5">
                  Accès & Codes PIN
                </p>
              </button>

              {/* MODIF 1: BOUTON HISTORIQUE DES ACTIONS */}
              <button
                type="button"
                onClick={() => onNavigate('historique')}
                className="p-4 sm:p-5 rounded-3xl bg-blue-50 hover:bg-blue-100 border-2 border-blue-200 text-left transition shadow-sm cursor-pointer"
              >
                <div className="w-11 h-11 rounded-2xl bg-[#0984E3] text-white flex items-center justify-center mb-2 shadow-sm">
                  <History className="w-6 h-6" />
                </div>
                <h4 className="text-base sm:text-lg font-black text-gray-900">Historique</h4>
                <p className="text-xs font-bold text-blue-700 mt-0.5">
                  Ventes, stock & audit
                </p>
              </button>
            </div>
          ) : (
            /* SOUS-BOUTIQUE : SEULEMENT ÉQUIPE & HISTORIQUE */
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              <button
                type="button"
                onClick={() => onNavigate('employes')}
                className="p-4 sm:p-5 rounded-3xl bg-purple-50 hover:bg-purple-100 border-2 border-purple-200 text-left transition shadow-sm cursor-pointer"
              >
                <div className="w-11 h-11 rounded-2xl bg-[#6C5CE7] text-white flex items-center justify-center mb-2 shadow-sm">
                  <Users className="w-6 h-6" />
                </div>
                <h4 className="text-base sm:text-lg font-black text-gray-900">
                  {accord.titrePatron === 'Patronne' ? 'Équipe Vendeuses' : 'Équipe Vendeurs'}
                </h4>
                <p className="text-xs font-bold text-purple-700 mt-0.5">
                  Accès & Codes PIN de cette boutique
                </p>
              </button>

              <button
                type="button"
                onClick={() => onNavigate('historique')}
                className="p-4 sm:p-5 rounded-3xl bg-blue-50 hover:bg-blue-100 border-2 border-blue-200 text-left transition shadow-sm cursor-pointer"
              >
                <div className="w-11 h-11 rounded-2xl bg-[#0984E3] text-white flex items-center justify-center mb-2 shadow-sm">
                  <History className="w-6 h-6" />
                </div>
                <h4 className="text-base sm:text-lg font-black text-gray-900">Historique Actions</h4>
                <p className="text-xs font-bold text-blue-700 mt-0.5">
                  Ventes & stock de ce point de vente
                </p>
              </button>
            </div>
          )}

          {/* BANNIÈRE ESSAI 21 JOURS / ABONNEMENT (Uniquement sur boutique principale) */}
          {!isSubStore && (
            <div className="p-4 sm:p-5 rounded-3xl bg-gradient-to-r from-blue-900 via-indigo-900 to-blue-950 text-white shadow-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border border-blue-400/30">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-amber-400/20 border border-amber-400/40 text-amber-300 flex items-center justify-center flex-shrink-0">
                  {currentPlan === 'pro' ? <Crown className="w-6 h-6 text-amber-400" /> : <Sparkles className="w-6 h-6 text-amber-300" />}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="font-black text-base sm:text-lg">
                      {currentPlan === 'pro'
                        ? 'Formule Boutique PRO Active 👑'
                        : currentPlan === 'populaire'
                        ? 'Offre Populaire Active ⭐'
                        : 'Essai Gratuit 21 Jours 🎁'}
                    </h4>
                    <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-black uppercase border border-emerald-400/40">
                      {currentPlan === 'trial' ? `${remainingTrialDays}j restants` : 'Actif'}
                    </span>
                  </div>
                  <p className="text-xs font-bold text-blue-200 mt-0.5">
                    {currentPlan === 'trial'
                      ? 'Profitez de toutes les fonctionnalités. Choisissez un forfait avant la fin des 21 jours.'
                      : 'Abonnement officiel validé par EFA ACONTA Togo.'}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => onOpenSubscriptionModal?.('populaire', 'Passer à un forfait officiel')}
                className="px-4 py-2.5 rounded-2xl bg-amber-400 hover:bg-amber-300 active:scale-95 text-blue-950 font-black text-xs sm:text-sm flex items-center gap-1.5 shadow-md transition whitespace-nowrap cursor-pointer"
              >
                <span>Voir les Forfaits</span>
                <ChevronRight className="w-4 h-4 stroke-[3]" />
              </button>
            </div>
          )}

          {/* FONCTIONNALITÉS PRO VISIBLES (Uniquement sur boutique principale) */}
          {!isSubStore && (
            <div className="pt-2">
              <div className="flex items-center justify-between mb-2.5">
                <span className="text-xs font-black uppercase text-gray-500 tracking-wider flex items-center gap-1.5">
                  <Crown className="w-3.5 h-3.5 text-amber-500" />
                  <span>Fonctionnalités Avancées PRO :</span>
                </span>
                <span className="text-[11px] font-black text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                  {isPro ? 'Débloqué' : 'Surclassement disponible'}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* Feature 1: Multi-Boutique */}
                <button
                  type="button"
                  onClick={() => {
                    if (isPro) {
                      onNavigate('mes-boutiques');
                    } else {
                      onOpenSubscriptionModal?.('pro', 'Multi-boutique (jusqu\'à 3 boutiques distinctes)');
                    }
                  }}
                  className={`p-4 rounded-2xl border text-left transition flex items-center justify-between group cursor-pointer ${
                    isPro
                      ? 'bg-purple-50/60 hover:bg-purple-100 border-purple-200'
                      : 'bg-gray-50 hover:bg-amber-50/60 border-gray-200 hover:border-amber-300'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition ${
                      isPro ? 'bg-purple-200 text-[#6C5CE7]' : 'bg-gray-200 group-hover:bg-amber-100 text-gray-600 group-hover:text-amber-800'
                    }`}>
                      <Building2 className="w-5 h-5" />
                    </div>
                    <div>
                      <h5 className="font-black text-sm text-gray-800 flex items-center gap-1">
                        <span>Multi-Boutique</span>
                        {!isPro && <Lock className="w-3.5 h-3.5 text-amber-600" />}
                      </h5>
                      <p className="text-[11px] font-bold text-gray-500">
                        {isPro ? 'Gérer mes 3 boutiques' : '2ème & 3ème boutique'}
                      </p>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded-full bg-amber-400 text-amber-950 text-[10px] font-black uppercase shadow-xs">
                    PRO
                  </span>
                </button>

                {/* Feature 2: Facture Officielle & TVA */}
                <button
                  type="button"
                  onClick={() => onOpenSubscriptionModal?.('pro', 'Facture officielle certifiée avec TVA & Logo d\'entreprise')}
                  className="p-4 rounded-2xl bg-gray-50 hover:bg-amber-50/60 border border-gray-200 hover:border-amber-300 text-left transition flex items-center justify-between group cursor-pointer"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gray-200 group-hover:bg-amber-100 text-gray-600 group-hover:text-amber-800 flex items-center justify-center transition">
                      <FileCheck2 className="w-5 h-5" />
                    </div>
                    <div>
                      <h5 className="font-black text-sm text-gray-800 flex items-center gap-1">
                        <span>Facture Pro PDF</span>
                        <Lock className="w-3.5 h-3.5 text-amber-600" />
                      </h5>
                      <p className="text-[11px] font-bold text-gray-500">Logo & Mentions TVA</p>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded-full bg-amber-400 text-amber-950 text-[10px] font-black uppercase shadow-xs">
                    PRO
                  </span>
                </button>

                {/* Feature 3: Support Prioritaire WhatsApp */}
                <button
                  type="button"
                  onClick={() => onOpenSubscriptionModal?.('pro', 'Support client prioritaire WhatsApp 7j/7')}
                  className="p-4 rounded-2xl bg-gray-50 hover:bg-amber-50/60 border border-gray-200 hover:border-amber-300 text-left transition flex items-center justify-between group cursor-pointer"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gray-200 group-hover:bg-amber-100 text-gray-600 group-hover:text-amber-800 flex items-center justify-center transition">
                      <Headset className="w-5 h-5" />
                    </div>
                    <div>
                      <h5 className="font-black text-sm text-gray-800 flex items-center gap-1">
                        <span>Support VIP 24/7</span>
                        <Lock className="w-3.5 h-3.5 text-amber-600" />
                      </h5>
                      <p className="text-[11px] font-bold text-gray-500">Ligne directe EFA</p>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded-full bg-amber-400 text-amber-950 text-[10px] font-black uppercase shadow-xs">
                    PRO
                  </span>
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* CAS 2 : HOME VENDEUSE / VENDEUR - SEULEMENT 2 BOUTONS + SECTIONS CADENAS */
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4">
            {/* 1. VENDRE vert */}
            <button
              type="button"
              onClick={() => onNavigate('vendre')}
              className="min-h-[96px] w-full p-6 rounded-3xl bg-[#00B894] hover:bg-[#00a382] active:scale-[0.98] text-white flex items-center justify-between shadow-xl shadow-emerald-500/25 transition border-2 border-emerald-400"
            >
              <div className="flex items-center gap-5 text-left">
                <div className="w-16 h-16 rounded-2xl bg-white/20 flex items-center justify-center">
                  <ShoppingCart className="w-10 h-10 stroke-[2.5]" />
                </div>
                <div>
                  <span className="block text-2xl sm:text-3xl font-black tracking-wide">
                    VENDRE
                  </span>
                  <span className="text-sm sm:text-base font-bold text-emerald-100">
                    Enregistrer une vente
                  </span>
                </div>
              </div>
              <span className="text-3xl font-black opacity-80">➔</span>
            </button>

            {/* 2. MES VENTES */}
            <button
              type="button"
              onClick={() => onNavigate('mes-ventes')}
              className="min-h-[96px] w-full p-6 rounded-3xl bg-[#0984E3] hover:bg-[#0873c4] active:scale-[0.98] text-white flex items-center justify-between shadow-xl shadow-blue-500/25 transition border-2 border-blue-400"
            >
              <div className="flex items-center gap-5 text-left">
                <div className="w-16 h-16 rounded-2xl bg-white/20 flex items-center justify-center">
                  <Receipt className="w-10 h-10 stroke-[2.5]" />
                </div>
                <div>
                  <span className="block text-2xl sm:text-3xl font-black tracking-wide">
                    MES VENTES
                  </span>
                  <span className="text-sm sm:text-base font-bold text-blue-100">
                    Mon récapitulatif du jour
                  </span>
                </div>
              </div>
              <span className="text-3xl font-black opacity-80">➔</span>
            </button>
          </div>

          {/* SECTIONS GRISÉES AVEC CADENAS 🔒 */}
          <div className="pt-4 border-t-2 border-dashed border-gray-200">
            <p className="text-xs font-black uppercase text-gray-400 tracking-wider mb-3">
              Espaces réservés à la Direction :
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-4 rounded-2xl bg-gray-100 border border-gray-300 text-gray-400 flex items-center gap-3 cursor-not-allowed">
                <Lock className="w-6 h-6 text-gray-400 flex-shrink-0" />
                <div>
                  <h5 className="font-bold text-sm text-gray-500">
                    Mon Argent {accord.titrePatron} 🔒
                  </h5>
                  <p className="text-xs text-gray-400">Verrouillé</p>
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-gray-100 border border-gray-300 text-gray-400 flex items-center gap-3 cursor-not-allowed">
                <Lock className="w-6 h-6 text-gray-400 flex-shrink-0" />
                <div>
                  <h5 className="font-bold text-sm text-gray-500">Ajouter Stock 🔒</h5>
                  <p className="text-xs text-gray-400">Verrouillé</p>
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-gray-100 border border-gray-300 text-gray-400 flex items-center gap-3 cursor-not-allowed">
                <Lock className="w-6 h-6 text-gray-400 flex-shrink-0" />
                <div>
                  <h5 className="font-bold text-sm text-gray-500">Page Ambassadrice 🔒</h5>
                  <p className="text-xs text-gray-400">Verrouillé</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
