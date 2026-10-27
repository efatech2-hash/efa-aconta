import React, { useState, useEffect } from 'react';
import {
  Wifi,
  WifiOff,
  Lock,
  Gift,
  Download,
  Settings,
  RefreshCw,
  Menu,
  X,
  ChevronRight,
  Crown,
  Store,
} from 'lucide-react';
import type { Patron, CurrentUser } from '../lib/types';
import { getAccord } from '../lib/accord';
import { useVoice } from '../lib/VoiceContext';
import { isProActive } from '../lib/mesBoutiques';

interface HeaderNavProps {
  patron: Patron;
  currentUser: CurrentUser;
  isOnline: boolean;
  onOpenLockScreen: () => void;
  onOpenSettings: () => void;
  onLock: () => void;
  onLogout?: () => void;
  onNavigate: (tab: 'home' | 'vendre' | 'mon-argent' | 'stock' | 'ajouter' | 'employes' | 'ambassadrice' | 'mes-ventes' | 'historique' | 'mon-abonnement' | 'mes-boutiques') => void;
  activeTab: string;
  onRefreshData?: () => Promise<void> | void;
  onOpenMonAbonnementModal?: () => void;
  deviceStoreName?: string | null;
  onTriggerChangeDeviceStore?: () => void;
}

export const HeaderNav: React.FC<HeaderNavProps> = ({
  patron,
  currentUser,
  isOnline,
  onOpenLockScreen,
  onOpenSettings,
  onLock,
  onNavigate,
  activeTab,
  onRefreshData,
  onOpenMonAbonnementModal,
  deviceStoreName,
  onTriggerChangeDeviceStore,
}) => {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isInstallable, setIsInstallable] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { isVoiceOn, toggleVoice, speak } = useVoice();

  useEffect(() => {
    const handleBeforeInstallPrompt = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setIsInstallable(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  // Fermer le menu mobile lors d'un appui sur Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsMobileMenuOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Fermer le menu si la fenêtre est agrandie >= 1280px (xl)
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 1280) {
        setIsMobileMenuOpen(false);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsInstallable(false);
    }
  };

  // REFRESH RAPIDE : 2 secondes max
  const handleRefreshApp = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);

    try {
      if (onRefreshData) {
        await onRefreshData();
      } else {
        await new Promise((r) => setTimeout(r, 400));
      }
    } catch (e) {
      console.warn('[Refresh] Erreur actualisation:', e);
    } finally {
      setIsRefreshing(false);
    }
  };

  const isPatron = currentUser.role === 'patron';
  const isOwner = currentUser.role === 'patron' || patron.type === 'MAIN';
  const accord = getAccord(currentUser.genre);
  const isSubStore = patron.type === 'SUB' || Boolean(patron.parentId);
  const isPro = isProActive(patron);

  // Bienvenue vendeur / vendeuse automatique selon le genre
  const welcomePrefix = currentUser.role === 'patron'
    ? (currentUser.genre === 'femme' ? 'Bienvenue patronne' : 'Bienvenu patron')
    : (currentUser.genre === 'femme' ? 'Bienvenue vendeuse' : 'Bienvenu vendeur');

  return (
    <>
      <header className="header-mobile-container sticky top-0 z-40 bg-white border-b-2 border-gray-200 shadow-xs px-2 sm:px-4 py-2 sm:py-2.5 select-none w-full">
        <div className="max-w-5xl mx-auto flex flex-col gap-1.5 sm:gap-2">
          {/* LIGNE 1 : PROFIL / SALUTATION + ACTIONS PRINCIPALES */}
          <div className="flex items-center justify-between gap-1.5 sm:gap-3 min-w-0 w-full">
            {/* Salutation & Boutique avec accord de genre (anti-débordement truncate + min-w-0) */}
            <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1 overflow-hidden">
              <button
                type="button"
                onClick={onOpenLockScreen}
                className="relative focus:outline-none group shrink-0"
                title="Changer d'utilisateur (QUI VEND ?)"
                aria-label="Changer d'utilisateur"
              >
                {currentUser.photo_url ? (
                  <img
                    src={currentUser.photo_url}
                    alt={currentUser.nom}
                    className="w-9 h-9 sm:w-11 sm:h-11 rounded-2xl object-cover border-2 border-[#6C5CE7] shadow-sm group-hover:scale-105 transition"
                  />
                ) : (
                  <div className="w-9 h-9 sm:w-11 sm:h-11 rounded-2xl bg-[#6C5CE7] text-white flex items-center justify-center font-black text-base sm:text-lg shadow-sm border-2 border-[#6C5CE7] group-hover:scale-105 transition">
                    {currentUser.nom.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="absolute -bottom-1 -right-1 bg-gray-900 text-white p-0.5 sm:p-1 rounded-full text-[9px]">
                  <Lock className="w-2.5 h-2.5" />
                </div>
              </button>

              <div
                className="cursor-pointer min-w-0 flex-1 overflow-hidden"
                onClick={() => onNavigate('home')}
              >
                <h1 className="text-xs sm:text-sm md:text-base font-black text-gray-900 leading-tight truncate">
                  {welcomePrefix} {currentUser.prenom || currentUser.nom} !
                </h1>
                <p className="text-[10px] sm:text-xs font-extrabold text-[#6C5CE7] truncate leading-tight mt-0.5">
                  {patron.nom_boutique || 'Ma Boutique'} • {accord.connecte}
                </p>
              </div>
            </div>

            {/* BOUTONS D'ACTION (Adaptatifs : Mobile, Tablette 768px-1024px, Desktop) */}
            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              {/* Statut Connecté / Hors ligne */}
              <div
                className={`inline-flex items-center gap-1 px-2 py-1 sm:px-2.5 sm:py-1.5 rounded-full text-[10px] sm:text-xs font-black tracking-wide border shrink-0 ${
                  isOnline
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                    : 'bg-red-50 text-red-700 border-red-300'
                }`}
                title={isOnline ? 'Connecté (Synchronisation active)' : 'Hors ligne'}
              >
                {isOnline ? (
                  <>
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping inline-block" />
                    <Wifi className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                    <span className="hidden sm:inline">Connecté</span>
                  </>
                ) : (
                  <>
                    <WifiOff className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-red-600" />
                    <span className="hidden sm:inline">Hors ligne</span>
                  </>
                )}
              </div>

              {/* DESKTOP XL UNIQUEMENT (>= 1280px) : Raccourcis complets */}
              <div className="hidden xl:flex items-center gap-2">
                {/* Mes Boutiques (Patron, uniquement sur boutique principale) */}
                {isPatron && !isSubStore && (
                  isPro ? (
                    <button
                      type="button"
                      onClick={() => onNavigate('mes-boutiques')}
                      className={`p-2 rounded-xl border-2 transition flex items-center gap-1 text-xs font-black cursor-pointer ${
                        activeTab === 'mes-boutiques'
                          ? 'bg-purple-100 border-[#6C5CE7] text-[#6C5CE7]'
                          : 'bg-purple-50 border-purple-200 text-[#6C5CE7] hover:bg-purple-100'
                      }`}
                      title="Mes Boutiques (Pro)"
                    >
                      <Store className="w-4 h-4 text-[#6C5CE7]" />
                      <span>Mes Boutiques</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={onOpenMonAbonnementModal}
                      className="p-2 rounded-xl border-2 border-gray-200 bg-gray-50 hover:bg-gray-100 text-gray-500 transition flex items-center gap-1 text-xs font-bold cursor-pointer"
                      title="Mes Boutiques (Débloque avec Pro)"
                    >
                      <Lock className="w-3.5 h-3.5 text-gray-400" />
                      <span>Mes Boutiques</span>
                      <span className="text-[9px] bg-amber-400 text-amber-950 px-1 rounded font-black">PRO</span>
                    </button>
                  )
                )}

                {/* Ambassadrice (Patron seulement, caché en SUB) */}
                {isPatron && !isSubStore && (
                  <button
                    type="button"
                    onClick={() => onNavigate('ambassadrice')}
                    className={`p-2 rounded-xl border-2 transition flex items-center gap-1 text-xs font-black cursor-pointer ${
                      activeTab === 'ambassadrice'
                        ? 'bg-amber-100 border-amber-500 text-amber-900'
                        : 'bg-amber-50 border-amber-300 text-amber-800 hover:bg-amber-100'
                    }`}
                    title="Page Ambassadrice"
                  >
                    <Gift className="w-4 h-4 text-amber-600" />
                    <span>Ambassadrice</span>
                  </button>
                )}

                {/* Mon Abonnement (Patron seulement, caché en SUB) */}
                {isPatron && !isSubStore && (
                  <button
                    type="button"
                    onClick={onOpenMonAbonnementModal}
                    className="px-3 py-2 rounded-xl bg-amber-400 hover:bg-amber-500 text-slate-950 font-black text-xs flex items-center gap-1.5 border border-amber-500 shadow-xs transition active:scale-95 cursor-pointer"
                    title="Mon Abonnement / Forfait Actif"
                  >
                    <Crown className="w-4 h-4 text-slate-950 fill-amber-300" />
                    <span>Mon Abonnement</span>
                  </button>
                )}

                {/* Toggle Voix EFA ON / OFF */}
                <button
                  type="button"
                  onClick={() => {
                    const next = !isVoiceOn;
                    toggleVoice();
                    if (next) {
                      setTimeout(() => speak("Voix activée"), 100);
                    }
                  }}
                  className={`p-2 rounded-xl transition flex items-center gap-1.5 text-xs font-black cursor-pointer ${
                    isVoiceOn
                      ? 'bg-blue-100 hover:bg-blue-200 text-blue-700 border border-blue-300 shadow-xs'
                      : 'bg-gray-100 hover:bg-gray-200 text-gray-500 border border-gray-200'
                  }`}
                  title={isVoiceOn ? 'Voix EFA activée' : 'Voix EFA coupée'}
                >
                  <span className="text-sm">{isVoiceOn ? '🔊' : '🔇'}</span>
                  <span>{isVoiceOn ? 'Voix ON' : 'Voix OFF'}</span>
                </button>
              </div>

              {/* TABLETTE & DESKTOP (>= 768px) : Raccourcis compacts */}
              <div className="hidden md:flex items-center gap-1.5">
                {/* Raccourci rapide Mon Abonnement sur tablette */}
                {isPatron && !isSubStore && (
                  <button
                    type="button"
                    onClick={onOpenMonAbonnementModal}
                    className="xl:hidden p-2 rounded-xl bg-amber-400 hover:bg-amber-500 text-slate-950 flex items-center gap-1 font-black text-xs border border-amber-500 shadow-xs transition active:scale-95 cursor-pointer"
                    title="Mon Abonnement"
                  >
                    <Crown className="w-4 h-4 text-slate-950 fill-amber-300" />
                    <span className="hidden lg:inline">Abonnement</span>
                  </button>
                )}

                {/* Actualiser les données */}
                <button
                  type="button"
                  onClick={handleRefreshApp}
                  disabled={isRefreshing}
                  className={`p-2 rounded-xl transition cursor-pointer ${
                    isRefreshing ? 'bg-indigo-50 text-indigo-600' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                  }`}
                  title="Actualiser la caisse (2s max)"
                  aria-label="Actualiser"
                >
                  <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-indigo-600' : ''}`} />
                </button>

                {/* Paramètres & Sécurité PIN (Patron seulement, caché en SUB) */}
                {isPatron && !isSubStore && (
                  <button
                    type="button"
                    onClick={onOpenSettings}
                    className="p-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 transition cursor-pointer"
                    title="Paramètres & Sécurité PIN"
                    aria-label="Paramètres"
                  >
                    <Settings className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* BOUTON ROUGE : VERROUILLER / CHANGER D'UTILISATEUR (AVEC ICÔNE CADENAS) */}
              <button
                type="button"
                onClick={onLock}
                className="px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-xl bg-red-600 hover:bg-red-700 active:bg-red-800 text-white font-black text-xs flex items-center gap-1.5 shadow-md transition active:scale-95 cursor-pointer shrink-0 border border-red-700"
                title="Verrouiller l'écran / Changer d'utilisateur (Code PIN)"
                aria-label="Verrouiller"
              >
                <Lock className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-white shrink-0" />
                <span className="hidden min-[480px]:inline text-[11px] sm:text-xs uppercase tracking-wider font-black">
                  Verrouiller
                </span>
              </button>

              {/* MENU HAMBURGER (Visible sur tablette & mobile : < 1280px / xl:hidden) */}
              <button
                type="button"
                onClick={() => setIsMobileMenuOpen((prev) => !prev)}
                className={`xl:hidden w-8 h-8 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center border-2 transition active:scale-90 cursor-pointer shadow-xs shrink-0 ${
                  isMobileMenuOpen
                    ? 'bg-[#6C5CE7] text-white border-[#6C5CE7]'
                    : 'bg-indigo-50 hover:bg-indigo-100 text-[#6C5CE7] border-indigo-200'
                }`}
                title={isMobileMenuOpen ? 'Fermer le menu' : 'Ouvrir le menu'}
                aria-label="Menu"
                aria-expanded={isMobileMenuOpen}
              >
                {isMobileMenuOpen ? (
                  <X className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
                ) : (
                  <Menu className="w-4 h-4 sm:w-5 sm:h-5 text-[#6C5CE7]" />
                )}
              </button>
            </div>
          </div>

          {/* LIGNE 2 : BADGE APPAREIL VERROUILLÉ + BOUTON CHANGER (Dédié, anti-débordement) */}
          {deviceStoreName && (
            <div className="flex items-center justify-between gap-2 px-2.5 sm:px-3 py-1 bg-purple-50 rounded-xl border border-purple-200 text-[#6C5CE7] text-[11px] sm:text-xs min-w-0 w-full animate-in fade-in duration-150">
              <div className="flex items-center gap-1.5 min-w-0 truncate font-black">
                <span className="shrink-0">📱 Appareil :</span>
                <span className="truncate underline font-black text-purple-900">{deviceStoreName}</span>
              </div>
              {isOwner && onTriggerChangeDeviceStore && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onTriggerChangeDeviceStore();
                  }}
                  className="shrink-0 px-2.5 py-0.5 rounded-lg bg-white border border-purple-300 text-purple-700 hover:text-purple-900 font-black text-[10px] sm:text-xs shadow-xs cursor-pointer active:scale-95 transition"
                  title="Changer la boutique de cet appareil"
                >
                  Changer
                </button>
              )}
            </div>
          )}
        </div>
      </header>

      {/* DROPDOWN / TIROIR MENU (< 1280px / xl:hidden) */}
      {isMobileMenuOpen && (
        <>
          {/* Backdrop sombre */}
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-xs z-[99] xl:hidden animate-in fade-in duration-150"
            onClick={() => setIsMobileMenuOpen(false)}
            aria-hidden="true"
          />

          {/* Tiroir menu */}
          <div
            className="mobile-nav-drawer fixed top-[60px] sm:top-[68px] right-2 left-2 sm:left-auto sm:right-4 sm:w-88 max-w-sm bg-white rounded-3xl shadow-2xl border-2 border-gray-200 p-4 sm:p-5 z-[100] xl:hidden animate-in fade-in slide-in-from-top-2 duration-200 space-y-3 select-none max-h-[85vh] overflow-y-auto"
            role="dialog"
            aria-label="Menu Navigation EFA ACONTA"
          >
            {/* Header du menu avec profil & fermeture */}
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-10 h-10 rounded-2xl bg-[#6C5CE7] text-white flex items-center justify-center font-black text-lg shadow-xs shrink-0">
                  {currentUser.nom.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 truncate">
                  <div className="font-black text-sm text-gray-900 leading-tight truncate">
                    {currentUser.prenom || currentUser.nom}
                  </div>
                  <div className="text-[11px] font-bold text-[#6C5CE7] truncate">
                    {currentUser.role === 'patron' ? 'Patron' : 'Vendeur'} • {patron.nom_boutique || 'Ma Boutique'}
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsMobileMenuOpen(false)}
                className="w-8 h-8 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-600 flex items-center justify-center active:scale-90 transition cursor-pointer shrink-0"
                aria-label="Fermer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Statut réseau */}
            <div
              className={`flex items-center justify-between p-2.5 rounded-2xl text-xs font-black border ${
                isOnline
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                  : 'bg-red-50 text-red-800 border-red-300'
              }`}
            >
              <div className="flex items-center gap-2">
                {isOnline ? (
                  <>
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping inline-block" />
                    <span>Mode Connecté (Synchronisation active)</span>
                  </>
                ) : (
                  <>
                    <WifiOff className="w-4 h-4 text-red-600" />
                    <span>Mode Hors Ligne (Stockage local)</span>
                  </>
                )}
              </div>
            </div>

            {/* BOUTON VERROUILLER / RETOUR PIN */}
            <button
              type="button"
              onClick={() => {
                setIsMobileMenuOpen(false);
                onLock();
              }}
              className="w-full py-3 px-4 rounded-2xl bg-red-600 hover:bg-red-700 active:bg-red-800 text-white font-black text-xs sm:text-sm flex items-center justify-between shadow-md transition active:scale-98 cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-red-700 text-white flex items-center justify-center shrink-0">
                  <Lock className="w-4 h-4" />
                </div>
                <div className="text-left">
                  <div className="leading-tight font-black text-xs sm:text-sm">
                    Verrouiller l'écran
                  </div>
                  <div className="text-[10px] text-red-100 font-semibold">
                    Retour à l'écran de PIN / Changer d'utilisateur
                  </div>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-white" />
            </button>

            {/* PARAMÈTRES & SÉCURITÉ PIN (Patron seulement, caché en sous-boutique) */}
            {isPatron && !isSubStore && (
              <button
                type="button"
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  onOpenSettings();
                }}
                className="w-full py-3 px-4 rounded-2xl bg-gray-50 hover:bg-gray-100 text-gray-900 font-black text-xs sm:text-sm flex items-center justify-between border-2 border-gray-200 shadow-xs transition active:scale-98 cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-purple-100 text-[#6C5CE7] flex items-center justify-center shrink-0">
                    <Settings className="w-4 h-4" />
                  </div>
                  <div className="text-left">
                    <div className="leading-tight font-black text-xs sm:text-sm text-gray-900">
                      Paramètres & Sécurité PIN
                    </div>
                    <div className="text-[10px] text-gray-500 font-semibold">
                      Code PIN, profil, déconnexion appareil
                    </div>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-gray-400" />
              </button>
            )}

            {/* RACCOURCI MES BOUTIQUES (Patron seulement, uniquement sur boutique principale) */}
            {isPatron && !isSubStore && (
              <button
                type="button"
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  if (isPro) {
                    onNavigate('mes-boutiques');
                  } else {
                    onOpenMonAbonnementModal?.();
                  }
                }}
                className={`w-full py-3 px-4 rounded-2xl border-2 font-black text-xs sm:text-sm flex items-center justify-between transition active:scale-98 cursor-pointer ${
                  isPro
                    ? 'bg-purple-50 hover:bg-purple-100 border-purple-300 text-purple-950'
                    : 'bg-gray-50 hover:bg-gray-100 border-gray-200 text-gray-500'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${isPro ? 'bg-purple-200 text-[#6C5CE7]' : 'bg-gray-200 text-gray-500'}`}>
                    <Store className="w-4 h-4" />
                  </div>
                  <div className="text-left">
                    <div className="leading-tight font-black text-xs sm:text-sm">
                      Mes Boutiques
                    </div>
                    <div className="text-[10px] font-bold">
                      {isPro ? 'Gérer jusqu\'à 3 boutiques distinctes' : '🔒 Débloque avec Pro (jusqu\'à 3)'}
                    </div>
                  </div>
                </div>
                {isPro ? (
                  <ChevronRight className="w-5 h-5 text-[#6C5CE7]" />
                ) : (
                  <span className="px-2 py-0.5 rounded-full bg-amber-400 text-amber-950 text-[10px] font-black uppercase">
                    PRO
                  </span>
                )}
              </button>
            )}

            {/* RACCOURCI MON ABONNEMENT (Patron seulement, caché en sous-boutique) */}
            {isPatron && !isSubStore && (
              <button
                type="button"
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  if (onOpenMonAbonnementModal) {
                    onOpenMonAbonnementModal();
                  } else {
                    onNavigate('mon-abonnement');
                  }
                }}
                className="w-full py-3 px-4 rounded-2xl bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-500 hover:to-amber-600 border-2 border-amber-600 text-slate-950 font-black text-xs sm:text-sm flex items-center justify-between transition active:scale-98 cursor-pointer shadow-xs"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-slate-950 text-amber-300 flex items-center justify-center shadow-xs shrink-0">
                    <Crown className="w-4 h-4 fill-amber-400" />
                  </div>
                  <div className="text-left">
                    <div className="leading-tight font-black text-xs sm:text-sm text-slate-950">
                      Mon Abonnement / Forfait Actif
                    </div>
                    <div className="text-[10px] text-slate-900 font-bold">
                      Jours restants, expiration & renouvellement
                    </div>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-slate-950" />
              </button>
            )}

            {/* TOGGLE VOIX EFA */}
            <button
              type="button"
              onClick={() => {
                const next = !isVoiceOn;
                toggleVoice();
                if (next) {
                  setTimeout(() => speak("Voix activée"), 100);
                }
              }}
              className={`w-full py-2.5 px-4 rounded-2xl border-2 flex items-center justify-between transition active:scale-98 cursor-pointer ${
                isVoiceOn
                  ? 'bg-blue-50 border-blue-300 text-blue-900'
                  : 'bg-gray-50 border-gray-200 text-gray-600'
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="text-lg">{isVoiceOn ? '🔊' : '🔇'}</span>
                <div className="text-left">
                  <div className="text-xs sm:text-sm font-black">
                    {isVoiceOn ? 'Voix EFA : Activée' : 'Voix EFA : Coupée'}
                  </div>
                  <div className="text-[10px] text-gray-500">
                    Synthèse vocale des actions
                  </div>
                </div>
              </div>
              <span
                className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                  isVoiceOn ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'
                }`}
              >
                {isVoiceOn ? 'ON' : 'OFF'}
              </span>
            </button>

            {/* RACCOURCI AMBASSADRICE (Patron seulement, caché en sous-boutique) */}
            {isPatron && !isSubStore && (
              <button
                type="button"
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  onNavigate('ambassadrice');
                }}
                className="w-full py-2.5 px-4 rounded-2xl bg-amber-50 hover:bg-amber-100 border-2 border-amber-300 text-amber-900 font-extrabold text-xs sm:text-sm flex items-center justify-between transition active:scale-98 cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-amber-200 text-amber-800 flex items-center justify-center shrink-0">
                    <Gift className="w-4 h-4" />
                  </div>
                  <div className="text-left">
                    <div className="font-extrabold text-xs sm:text-sm">Page Ambassadrice</div>
                    <div className="text-[10px] text-amber-700">Parrainage et récompenses</div>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-amber-400" />
              </button>
            )}

            {/* RACCOURCI INSTALLER L'APPLICATION (PWA) */}
            {isInstallable && (
              <button
                type="button"
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  handleInstallClick();
                }}
                className="w-full py-2.5 px-4 rounded-2xl bg-indigo-50 hover:bg-indigo-100 border-2 border-indigo-200 text-indigo-900 font-extrabold text-xs sm:text-sm flex items-center justify-between transition active:scale-98 cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-indigo-200 text-indigo-800 flex items-center justify-center shrink-0">
                    <Download className="w-4 h-4" />
                  </div>
                  <div className="text-left">
                    <div className="font-extrabold text-xs sm:text-sm">Installer l'application</div>
                    <div className="text-[10px] text-indigo-600">Accès hors ligne sur l'écran d'accueil</div>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-indigo-400" />
              </button>
            )}

            {/* ACTUALISER & VIDER LE CACHE */}
            <button
              type="button"
              onClick={() => {
                setIsMobileMenuOpen(false);
                handleRefreshApp();
              }}
              disabled={isRefreshing}
              className="w-full py-2.5 px-4 rounded-2xl bg-gray-50 hover:bg-gray-100 border-2 border-gray-200 text-gray-700 font-bold text-xs sm:text-sm flex items-center gap-3 transition active:scale-98 cursor-pointer"
            >
              <div className="w-8 h-8 rounded-lg bg-gray-200 text-gray-700 flex items-center justify-center shrink-0">
                <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-indigo-600' : ''}`} />
              </div>
              <div className="text-left">
                <div className="font-extrabold text-xs sm:text-sm">
                  {isRefreshing ? 'Actualisation...' : "Actualiser la caisse"}
                </div>
                <div className="text-[10px] text-gray-500">
                  {isRefreshing ? 'Synchronisation rapide...' : 'Rafraîchir en 2s max'}
                </div>
              </div>
            </button>
          </div>
        </>
      )}
    </>
  );
};
