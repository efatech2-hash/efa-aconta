/**
 * EFA ACONTA - Version Finale BOSS
 * @license Apache-2.0
 * ENTRÉE : Conditions + PIN 4 chiffres (Pour mamans marché Lomé)
 * INTÉRIEUR : Ton code original 100% intact (Employés, Vendeuse, Patron, etc)
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { db } from './lib/db';
import type {
  Patron,
  Employe,
  Produit,
  Vente,
  Depense,
  Credit,
  Parrainage,
  ParsedVoiceCommand,
  CurrentUser,
} from './lib/types';
import { processSyncQueue, queueSyncItem } from './lib/sync';
import { HeaderNav } from './components/HeaderNav';
import { HomeScreen } from './components/HomeScreen';
import { VendreScreen } from './components/VendreScreen';
import { MonArgentScreen } from './components/MonArgentScreen';
import { AjouterStockScreen } from './components/AjouterStockScreen';
import { StockScreen } from './components/StockScreen';
import { EmployesScreen } from './components/EmployesScreen';
import { AmbassadriceScreen } from './components/AmbassadriceScreen';
import { MonAbonnementScreen } from './components/MonAbonnementScreen';
import { MesVentesScreen } from './components/MesVentesScreen';
import { WhoIsSellingModal } from './components/WhoIsSellingModal';
import { EFAVoiceAssistant } from './components/EFAVoiceAssistant';
import { ConfirmationModal } from './components/ConfirmationModal';
import { SettingsModal } from './components/SettingsModal';
import { AutoLogoutPromptModal } from './components/AutoLogoutPromptModal';
import { InviteLandingScreen } from './components/InviteLandingScreen';
import { HistoriqueScreen } from './components/HistoriqueScreen';
import { SubscriptionModal } from './components/SubscriptionModal';
import { PinLockScreen } from './components/PinLockScreen';
import { logAction } from './lib/historique';
import { isSubscriptionExpired, syncEmployeesSubscription, isBoutiquePro } from './lib/checkLimits';
import { speakFrench } from './lib/speech';
import { supabase } from './lib/supabase';
import { getIsPickingPhoto } from './lib/camera';
import { App as CapacitorApp } from '@capacitor/app';
import { withTimeout } from './lib/supabaseHelper';
import CheckAbonnement from './components/CheckAbonnement';
import { WelcomeAuthScreen } from './components/WelcomeAuthScreen';
import { getCurrentBoutiqueId, boutiqueToPatron } from './lib/deviceAuth';
import { SuperAdminScreen } from './components/SuperAdminScreen';
import EfaAdmin from './pages/EfaAdmin';
import { MonAbonnementModal } from './components/MonAbonnementModal';
import { SplashScreen } from './components/SplashScreen';
import { generateReferralCode } from './lib/ambassadeur';
import { MesBoutiquesScreen } from './components/MesBoutiquesScreen';
import { DeviceStoreSelectModal } from './components/DeviceStoreSelectModal';
import {
  isProActive,
  getOwnerStores,
  getMainStoreId,
  getDeviceStoreInfo,
  setDeviceStore,
  clearDeviceStore,
} from './lib/mesBoutiques';

function checkIsAdminRoute(): boolean {
  if (typeof window === 'undefined') return false;
  const p = window.location.pathname.toLowerCase();
  const hash = window.location.hash.toLowerCase();
  const search = window.location.search.toLowerCase();
  return (
    p === '/efa-admin' ||
    p === '/efa-admin/' ||
    p === '/admin-efa' ||
    p === '/admin-efa/' ||
    hash.startsWith('#/efa-admin') ||
    hash.startsWith('#/admin-efa') ||
    hash === '#efa-admin' ||
    hash === '#admin' ||
    search.includes('page=efa-admin') ||
    search.includes('admin=1')
  );
}

export default function App() {
  const [showSplash, setShowSplash] = useState(true);
  const [isInitializing, setIsInitializing] = useState(true);
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);

  useEffect(() => {
    const splashTimer = setTimeout(() => {
      setShowSplash(false);
    }, 3000);
    return () => clearTimeout(splashTimer);
  }, []);

  // Données boutique
  const [patron, setPatron] = useState<Patron | null>(null);
  const [employes, setEmployes] = useState<Employe[]>([]);
  const [products, setProducts] = useState<Produit[]>([]);
  const [ventes, setVentes] = useState<Vente[]>([]);
  const [depenses, setDepenses] = useState<Depense[]>([]);
  const [credits, setCredits] = useState<Credit[]>([]);
  const [parrainages, setParrainages] = useState<Parrainage[]>([]);

  // Utilisateur actif & navigation
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [activeTab, setActiveTab] = useState<'home' | 'vendre' | 'mon-argent' | 'stock' | 'ajouter' | 'employes' | 'ambassadrice' | 'mes-ventes' | 'historique' | 'mon-abonnement' | 'mes-boutiques'>('home');
  const [isLockScreenOpen, setIsLockScreenOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // État Verrouillage Appareil & Mes Boutiques (Pro)
  const [deviceStoreInfo, setDeviceStoreInfo] = useState<{
    storeId: string | null;
    storeName: string | null;
    isLocked: boolean;
  }>(() => getDeviceStoreInfo());
  const [ownerStores, setOwnerStores] = useState<Patron[]>([]);
  const [isDeviceSelectModalOpen, setIsDeviceSelectModalOpen] = useState(false);
  const [isDeviceChangeMode, setIsDeviceChangeMode] = useState(false);

  const [isPinLocked, setIsPinLocked] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return (
        localStorage.getItem('efa_aconta_locked') === 'true' ||
        window.location.pathname === '/pin-lock'
      );
    }
    return false;
  });

  const [subscriptionModal, setSubscriptionModal] = useState<{
    isOpen: boolean;
    isBlocking: boolean;
    plan?: 'populaire' | 'pro' | null;
    reason?: string;
  }>({
    isOpen: false,
    isBlocking: false,
    plan: 'populaire',
  });

  const handleOpenSubscriptionModal = (plan?: 'populaire' | 'pro', reason?: string) => {
    setSubscriptionModal({
      isOpen: true,
      isBlocking: false,
      plan: plan || 'populaire',
      reason,
    });
  };

  const [isAutoLogoutPromptOpen, setIsAutoLogoutPromptOpen] = useState(false);
  const [isMonAbonnementModalOpen, setIsMonAbonnementModalOpen] = useState(false);
  const [previewInviteSlug, setPreviewInviteSlug] = useState<string | null>(null);
  const [pendingVoiceAction, setPendingVoiceAction] = useState<ParsedVoiceCommand | null>(null);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const [isAdminRoute, setIsAdminRoute] = useState<boolean>(() => checkIsAdminRoute());

  useEffect(() => {
    if (typeof window !== 'undefined') {
      // 1. Capture du code parrain (?ref=EFA-XXXXX)
      const searchParams = new URLSearchParams(window.location.search);
      const urlRef = searchParams.get('ref');
      if (urlRef) {
        localStorage.setItem('efa_aconta_ref', urlRef.trim().toUpperCase());
      }
      if (window.location.hash.includes('ref=')) {
        const hashIdx = window.location.hash.indexOf('?');
        if (hashIdx !== -1) {
          const hashParams = new URLSearchParams(window.location.hash.substring(hashIdx));
          const hashRef = hashParams.get('ref');
          if (hashRef) localStorage.setItem('efa_aconta_ref', hashRef.trim().toUpperCase());
        }
      }

      const pathname = window.location.pathname;
      const hash = window.location.hash.toLowerCase();
      const urlInvite = searchParams.get('invite');
      if (pathname.includes('/invite/')) {
        const slug = pathname.split('/invite/')[1]?.split('/')[0];
        if (slug) setPreviewInviteSlug(slug);
      } else if (urlInvite) {
        setPreviewInviteSlug(urlInvite);
      } else if (checkIsAdminRoute()) {
        setIsAdminRoute(true);
      } else if (
        pathname === '/ambassadrice' ||
        pathname === '/ambassadrice/' ||
        pathname === '/parrainage' ||
        pathname === '/parrainage/' ||
        hash.startsWith('#/parrainage') ||
        hash === '#parrainage' ||
        hash.startsWith('#/ambassadrice') ||
        hash === '#ambassadrice'
      ) {
        setActiveTab('ambassadrice');
      } else if (pathname === '/mon-abonnement' || pathname === '/mon-abonnement/' || hash.startsWith('#/mon-abonnement')) {
        setActiveTab('mon-abonnement');
      } else if (
        pathname === '/mes-boutiques' ||
        pathname === '/mes-boutiques/' ||
        pathname === '/dashboard/mes-boutiques' ||
        pathname === '/dashboard/mes-boutiques/' ||
        hash.startsWith('#/mes-boutiques') ||
        hash === '#mes-boutiques'
      ) {
        setActiveTab('mes-boutiques');
      } else if (
        pathname === '/lock' ||
        pathname === '/lock/' ||
        pathname === '/pin-lock' ||
        pathname === '/pin-lock/' ||
        hash.startsWith('#/lock') ||
        hash === '#lock' ||
        hash.startsWith('#/pin-lock') ||
        hash === '#pin-lock'
      ) {
        setIsPinLocked(true);
      } else if (pathname === '/dashboard/parametres' || pathname === '/parametres' || hash === '#parametres') {
        setIsSettingsOpen(true);
      }

      const handleRouteChange = () => {
        // Re-vérifier ref si URL change
        const currentSearch = new URLSearchParams(window.location.search);
        const r = currentSearch.get('ref');
        if (r) localStorage.setItem('efa_aconta_ref', r.trim().toUpperCase());

        const isAdmin = checkIsAdminRoute();
        setIsAdminRoute(isAdmin);
        if (!isAdmin) {
          const path = window.location.pathname;
          const currentHash = window.location.hash.toLowerCase();
          if (
            path === '/ambassadrice' ||
            path === '/ambassadrice/' ||
            path === '/parrainage' ||
            path === '/parrainage/' ||
            currentHash.startsWith('#/parrainage') ||
            currentHash === '#parrainage' ||
            currentHash.startsWith('#/ambassadrice') ||
            currentHash === '#ambassadrice'
          ) {
            setActiveTab('ambassadrice');
          } else if (path === '/mon-abonnement' || path === '/mon-abonnement/' || currentHash.startsWith('#/mon-abonnement')) {
            setActiveTab('mon-abonnement');
          } else if (
            path === '/mes-boutiques' ||
            path === '/mes-boutiques/' ||
            path === '/dashboard/mes-boutiques' ||
            path === '/dashboard/mes-boutiques/' ||
            currentHash.startsWith('#/mes-boutiques') ||
            currentHash === '#mes-boutiques'
          ) {
            setActiveTab('mes-boutiques');
          } else if (
            path === '/lock' ||
            path === '/lock/' ||
            path === '/pin-lock' ||
            path === '/pin-lock/' ||
            currentHash.startsWith('#/lock') ||
            currentHash === '#lock' ||
            currentHash.startsWith('#/pin-lock') ||
            currentHash === '#pin-lock'
          ) {
            setIsPinLocked(true);
          } else if (path === '/dashboard/parametres' || path === '/parametres' || currentHash === '#parametres') {
            setIsSettingsOpen(true);
          } else if (path === '/' || path === '' || path === '/login' || path === '/login/') {
            setActiveTab('home');
          }
        }
      };
      window.addEventListener('popstate', handleRouteChange);
      window.addEventListener('hashchange', handleRouteChange);
      return () => {
        window.removeEventListener('popstate', handleRouteChange);
        window.removeEventListener('hashchange', handleRouteChange);
      };
    }
  }, []);

  const isLoadingDatabaseRef = useRef(false);
  const [toastNotification, setToastNotification] = useState<{ message: string; type: 'success' | 'warning' | 'info'; } | null>(null);

  const showToast = useCallback((message: string, type: 'success' | 'warning' | 'info' = 'info') => {
    setToastNotification({ message, type });
    const timer = setTimeout(() => setToastNotification(null), 3500);
    return () => clearTimeout(timer);
  }, []);

  const loadDatabase = useCallback(async () => {
    if (isLoadingDatabaseRef.current) return;
    isLoadingDatabaseRef.current = true;
    try {
      // 1. Récupération de l'ID de la boutique courante
      const currentBoutiqueId = getCurrentBoutiqueId();
      if (!currentBoutiqueId) {
        setPatron(null);
        setCurrentUser(null);
        setEmployes([]);
        setProducts([]);
        setVentes([]);
        setDepenses([]);
        setCredits([]);
        setParrainages([]);
        return;
      }

      // 2. Recherche locale dans Dexie pour la boutique courante
      const patronsList = await db.patrons.toArray();
      let currentPatron: Patron | null =
        patronsList.find((p) => p.id === currentBoutiqueId) || null;

      // 3. Synchronisation distante si en ligne
      if (typeof navigator !== 'undefined' && navigator.onLine) {
        try {
          // Essai dans table efa_boutiques (Zéro Email)
          const { data: bData } = await withTimeout(
            supabase.from('efa_boutiques').select('*').eq('id', currentBoutiqueId).limit(1).maybeSingle(),
            4000
          );
          if (bData) {
            const converted = boutiqueToPatron(bData);
            if (currentPatron) {
              currentPatron = {
                ...currentPatron,
                ...converted,
                pin_code: currentPatron.pin_code || converted.pin_code,
                code_pin: currentPatron.code_pin || converted.code_pin,
              };
            } else {
              currentPatron = converted;
            }
            await db.patrons.put(currentPatron);
          } else {
            // Fallback table patrons
            const query = supabase
              .from('patrons')
              .select('*')
              .eq('id', currentBoutiqueId)
              .limit(1)
              .maybeSingle();
            const { data: remotePatron }: any = await withTimeout(query, 4000);
            if (remotePatron) {
              const realPin =
                remotePatron.pin_code ||
                remotePatron.code_pin ||
                remotePatron.mot_de_passe ||
                remotePatron.password;
              if (currentPatron) {
                currentPatron = {
                  ...currentPatron,
                  nom: remotePatron.nom || currentPatron.nom,
                  nom_boutique: remotePatron.nom_boutique || currentPatron.nom_boutique,
                  pin_code: realPin !== undefined ? realPin : currentPatron.pin_code,
                  code_pin: realPin !== undefined ? realPin : currentPatron.code_pin,
                  pin_hash: remotePatron.pin_hash || currentPatron.pin_hash,
                };
              } else {
                currentPatron = {
                  id: remotePatron.id || currentBoutiqueId,
                  nom: remotePatron.nom || 'Patron',
                  telephone: remotePatron.telephone || '',
                  phone_country: remotePatron.phone_country || '+228',
                  phone_number: remotePatron.phone_number || '',
                  phone_full: remotePatron.phone_full || remotePatron.telephone || '',
                  nom_boutique: remotePatron.nom_boutique || 'Ma Boutique',
                  pin_code: realPin || '',
                  code_pin: realPin || '',
                  pin_hash: remotePatron.pin_hash || '',
                  genre: remotePatron.genre || 'femme',
                  role: 'patron',
                  abonnement_expire: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString(),
                  subscription_status: remotePatron.subscription_status || 'trial',
                  created_at: remotePatron.created_at || new Date().toISOString(),
                };
              }
              await db.patrons.put(currentPatron);
            }
          }
        } catch (syncErr) {
          console.warn('[Sync] timeout:', syncErr);
        }
      }

      if (currentPatron) {
        if (currentPatron.pin_code === '1234' || currentPatron.pin_code === '123') {
          currentPatron.pin_code = currentPatron.code_pin || '';
        }
        const now = new Date();
        let patronNeedsUpdate = false;
        if (!currentPatron.trial_start_date) {
          const created = new Date(currentPatron.created_at || Date.now());
          const trialEnd = new Date(created.getTime() + 21 * 24 * 60 * 60 * 1000);
          currentPatron.trial_start_date = created.toISOString();
          currentPatron.trial_end_date = trialEnd.toISOString();
          currentPatron.subscription_status = 'trial';
          currentPatron.subscription_end_date = trialEnd.toISOString();
          patronNeedsUpdate = true;
        }
        if (
          (currentPatron.subscription_status === 'trial' || !currentPatron.subscription_status) &&
          currentPatron.trial_end_date &&
          now > new Date(currentPatron.trial_end_date)
        ) {
          currentPatron.subscription_status = 'expired';
          patronNeedsUpdate = true;
        }

        if (!currentPatron.referral_code) {
          currentPatron.referral_code = generateReferralCode();
          patronNeedsUpdate = true;
        }

        if (patronNeedsUpdate) {
          await db.patrons.put(currentPatron);
          await queueSyncItem('patrons', 'update', currentPatron.id, currentPatron);
        }
        setPatron(currentPatron);
        if (typeof window !== 'undefined') localStorage.setItem('entreprise_id', currentPatron.id);
        syncEmployeesSubscription(currentPatron.id, currentPatron.subscription_status || 'trial').catch(() => {});

        // Boutiques du propriétaire & vérification verrouillage appareil
        try {
          const mainId = getMainStoreId(currentPatron);
          const stores = await getOwnerStores(mainId);
          setOwnerStores(stores);
          const currentDev = getDeviceStoreInfo();
          setDeviceStoreInfo(currentDev);

          // Si Pro et plusieurs boutiques et appareil pas encore assigné
          if (isProActive(currentPatron) && stores.length > 1 && !currentDev.storeId) {
            setIsDeviceChangeMode(false);
            setIsDeviceSelectModalOpen(true);
          }
        } catch (stErr) {
          console.warn('[App] Erreur getOwnerStores:', stErr);
        }

        // Filtrage strict par currentPatron.id (boutique_id)
        const [empList, prodList, ventList, depList, credList, parrList] = await Promise.all([
          db.employes.where('patron_id').equals(currentPatron.id).toArray(),
          db.produits.where('patron_id').equals(currentPatron.id).toArray(),
          db.ventes.where('patron_id').equals(currentPatron.id).toArray(),
          db.depenses.where('patron_id').equals(currentPatron.id).toArray(),
          db.credits.where('patron_id').equals(currentPatron.id).toArray(),
          db.parrainage.where('parrain_id').equals(currentPatron.id).toArray(),
        ]);
        setEmployes(empList);
        setProducts(prodList);
        setVentes(ventList);
        setDepenses(depList);
        setCredits(credList);
        setParrainages(parrList);

        const savedUserId = localStorage.getItem('efa_active_user_id');
        if (!currentUser) {
          if (savedUserId && savedUserId !== currentPatron.id) {
            const foundEmp = empList.find((e) => e.id === savedUserId);
            const isEmpBlocked =
              foundEmp &&
              (foundEmp.is_blocked ||
                foundEmp.status === 'blocked' ||
                foundEmp.is_active === false ||
                foundEmp.is_deleted ||
                foundEmp.status === 'deleted');
            if (foundEmp && !isEmpBlocked) {
              setCurrentUser({
                id: foundEmp.id,
                nom: foundEmp.nom,
                role: 'vendeuse',
                genre: foundEmp.genre || 'femme',
                photo_url: foundEmp.photo_url,
              });
            } else {
              localStorage.setItem('efa_active_user_id', currentPatron.id);
              setCurrentUser({
                id: currentPatron.id,
                nom: currentPatron.nom,
                role: 'patron',
                genre: currentPatron.genre || 'femme',
                photo_url: currentPatron.photo_url,
              });
            }
          } else {
            setCurrentUser({
              id: currentPatron.id,
              nom: currentPatron.nom,
              role: 'patron',
              genre: currentPatron.genre || 'femme',
              photo_url: currentPatron.photo_url,
            });
          }
        }
      } else {
        setPatron(null);
        setCurrentUser(null);
      }
    } catch (err) {
      console.error('Erreur chargement base locale:', err);
    } finally {
      isLoadingDatabaseRef.current = false;
      setIsInitializing(false);
    }
  }, [currentUser]);

  const handleFastRefresh = useCallback(async () => {
    const t0 = performance.now();
    try {
      await loadDatabase();
      if (typeof navigator !== 'undefined' && navigator.onLine) {
        processSyncQueue().catch(() => {});
        const durationSec = Math.max(0.1, (performance.now() - t0) / 1000).toFixed(1);
        showToast(`Caisse actualisée (${durationSec}s)`, 'success');
      } else showToast('Pas de connexion (Mode hors-ligne actif)', 'warning');
    } catch { showToast('Pas de connexion - Données locales conservées', 'warning'); }
  }, [loadDatabase, showToast]);

  useEffect(() => { loadDatabase(); }, [loadDatabase]);

  useEffect(() => {
    if (!isOnline) return;
    const interval = setInterval(() => {
      processSyncQueue().then((res) => { if (res.syncedCount > 0) console.log(`[Sync] ${res.syncedCount} synchronisé(s)`); });
    }, 30000);
    return () => clearInterval(interval);
  }, [isOnline]);

  const lockApp = useCallback(() => {
    if (getIsPickingPhoto()) return;
    if (!patron) return;
    localStorage.setItem('efa_aconta_locked', 'true');
    setIsPinLocked(true);
    if (typeof window !== 'undefined' && window.location.pathname !== '/pin-lock') window.history.pushState(null, '', '/pin-lock');
  }, [patron]);

  useEffect(() => {
    if (!patron) return;
    const handleVisibility = () => { if (getIsPickingPhoto()) return; if (document.hidden) lockApp(); };
    const handleBlur = () => { if (getIsPickingPhoto()) return; lockApp(); };
    const handlePageHide = () => { if (getIsPickingPhoto()) return; lockApp(); };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('pagehide', handlePageHide);
    let appStateHandle: any = null;
    try { CapacitorApp.addListener('appStateChange', (state) => { if (getIsPickingPhoto()) return; if (!state.isActive) lockApp(); }).then((handle) => { appStateHandle = handle; }).catch(() => {}); } catch {}
    let t: NodeJS.Timeout;
    const reset = () => { clearTimeout(t); t = setTimeout(() => { if (getIsPickingPhoto()) return; lockApp(); }, 120000); };
    const activityEvents = ['touchstart', 'mousemove', 'keydown', 'pointerdown'];
    activityEvents.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('pagehide', handlePageHide);
      if (appStateHandle && typeof appStateHandle.remove === 'function') appStateHandle.remove();
      activityEvents.forEach((e) => window.removeEventListener(e, reset));
      clearTimeout(t);
    };
  }, [patron, lockApp]);

  useEffect(() => {
    const handlePopState = () => { if (window.location.pathname === '/pin-lock') setIsPinLocked(true); };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const handleUnlockPin = (unlockedUser: CurrentUser) => {
    localStorage.setItem('efa_aconta_locked', 'false');
    setCurrentUser(unlockedUser);
    localStorage.setItem('efa_active_user_id', unlockedUser.id);
    setIsPinLocked(false);
    if (typeof window !== 'undefined' && (window.location.pathname === '/pin-lock' || window.location.pathname === '/lock')) {
      window.history.pushState(null, '', '/');
    }
    setActiveTab('home');
  };

  const handleLockOrSwitchUser = useCallback(() => {
    // Supprime le localStorage de session vendeur seulement, PAS le deviceStoreId ni les infos de la boutique
    try {
      localStorage.removeItem('efa_active_user_id');
      localStorage.removeItem('current_user');
      localStorage.removeItem('efa_current_seller');
      localStorage.setItem('efa_aconta_locked', 'true');
    } catch (e) {
      console.warn('Erreur suppression session vendeur:', e);
    }
    setIsPinLocked(true);
    setIsLockScreenOpen(false);
    setIsSettingsOpen(false);
    setIsAutoLogoutPromptOpen(false);
    if (typeof window !== 'undefined' && window.location.pathname !== '/lock' && window.location.pathname !== '/pin-lock') {
      window.history.pushState(null, '', '/lock');
    }
  }, []);

  const handleLogout = useCallback(() => {
    setIsAutoLogoutPromptOpen(false);
    setIsSettingsOpen(false);
    setIsLockScreenOpen(false);
    setIsPinLocked(false);

    // Désactiver la session de cet appareil dans Supabase si présente
    try {
      const currentBoutiqueId = localStorage.getItem('currentBoutiqueId') || localStorage.getItem('entreprise_id');
      const deviceId = localStorage.getItem('efa_device_id');
      if (currentBoutiqueId && deviceId) {
        Promise.resolve(
          supabase
            .from('efa_devices')
            .update({ is_active: false })
            .eq('boutique_id', currentBoutiqueId)
            .eq('device_id', deviceId)
        ).catch(() => {});
      }
    } catch {}

    // Nettoyer tous les stockages client
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch (e) {
      console.warn('Erreur clear storage:', e);
    }

    // Invalidation du token d'authentification Supabase
    try {
      supabase.auth.signOut().catch(() => {});
    } catch {}

    setPatron(null);
    setCurrentUser(null);
    setEmployes([]);
    setProducts([]);
    setVentes([]);
    setDepenses([]);
    setCredits([]);
    setParrainages([]);

    // Rediriger vers /login
    if (typeof window !== 'undefined') {
      window.location.href = '/login';
    }
  }, []);

  const handleNavigate = useCallback((tab: 'home' | 'vendre' | 'mon-argent' | 'stock' | 'ajouter' | 'employes' | 'ambassadrice' | 'mes-ventes' | 'historique' | 'mon-abonnement' | 'mes-boutiques') => {
    // SÉCURITÉ FORTERESSE : Garde de rôle strict (IDOR Prevention)
    const isPatronOnlyTab = ['mon-argent', 'stock', 'ajouter', 'employes', 'ambassadrice', 'historique', 'mon-abonnement', 'mes-boutiques'].includes(tab);
    if (isPatronOnlyTab && currentUser && currentUser.role !== 'patron') {
      showToast('Accès restreint au compte Patron uniquement', 'warning');
      setActiveTab('vendre');
      return;
    }
    setActiveTab(tab);
    if (typeof window !== 'undefined') {
      if (tab === 'ambassadrice') window.history.pushState({}, '', '/ambassadrice');
      else if (tab === 'mon-abonnement') window.history.pushState({}, '', '/mon-abonnement');
      else if (tab === 'mes-boutiques') window.history.pushState({}, '', '/mes-boutiques');
      else if (tab === 'home') window.history.pushState({}, '', '/');
    }
  }, [currentUser, showToast]);

  const triggerPostActionPrompt = () => { if (patron?.auto_logout_after_action !== false) setIsAutoLogoutPromptOpen(true); };

  const handleConfirmVoiceAction = async () => {
    if (!pendingVoiceAction || !patron || !currentUser) return;
    const action = pendingVoiceAction;
    setPendingVoiceAction(null);
    try {
      if (action.type === 'vente') {
        const saleData = action.data;
        const saleId = 'vente-vocal-' + Date.now();
        const nowIso = new Date().toISOString();
        const saleRecord: Vente = { id: saleId, patron_id: patron.id, produit_id: saleData.produit_id, produit_nom: saleData.produit_nom, qte: saleData.qte, montant_total: saleData.montant_total, client_nom: saleData.client_nom, est_credit: saleData.est_credit, reste_a_payer: saleData.reste_a_payer, vendu_par_id: currentUser.id, vendu_par_nom: currentUser.nom, vendu_par_genre: currentUser.genre, date: nowIso, synced: false };
        await db.ventes.put(saleRecord);
        await queueSyncItem('ventes', 'insert', saleId, saleRecord);
        const currentProd = products.find((p) => p.id === saleData.produit_id);
        if (currentProd) {
          const newStock = Math.max(0, currentProd.stock_qte - saleData.qte);
          await db.produits.update(currentProd.id, { stock_qte: newStock });
          await queueSyncItem('produits', 'update', currentProd.id, { stock_qte: newStock });
        }
        if (saleData.est_credit) {
          const creditId = 'credit-vocal-' + Date.now();
          const creditRecord: Credit = { id: creditId, patron_id: patron.id, client_nom: saleData.client_nom || 'Client crédit', montant_initial: saleData.montant_total, reste_a_payer: saleData.reste_a_payer, dernier_paiement: nowIso, synced: false };
          await db.credits.put(creditRecord);
          await queueSyncItem('credits', 'insert', creditId, creditRecord);
        }
        logAction({ patron_id: patron.id, user_id: currentUser.id, employe_id: currentUser.role === 'patron' ? null : currentUser.id, employe_nom: currentUser.role === 'patron' ? undefined : (currentUser.prenom || currentUser.nom), action_type: 'vente', description: `Vente vocale ${saleData.qte}x ${saleData.produit_nom} (${saleData.montant_total}F) par ${currentUser.role === 'patron' ? 'Patron' : (currentUser.prenom || currentUser.nom)}`, montant: saleData.montant_total }).catch(console.error);
        await loadDatabase(); triggerPostActionPrompt();
      } else if (action.type === 'depense') {
        const depData = action.data;
        const depId = 'dep-vocal-' + Date.now();
        const depRecord: Depense = { id: depId, patron_id: patron.id, type: depData.type, montant: depData.montant, description: depData.description, cree_par: currentUser.nom, date: new Date().toISOString(), synced: false };
        await db.depenses.put(depRecord);
        await queueSyncItem('depenses', 'insert', depId, depRecord);
        await loadDatabase(); triggerPostActionPrompt();
      } else if (action.type === 'produit') {
        const prodData = action.data;
        const prodId = 'prod-vocal-' + Date.now();
        const prodRecord: Produit = { id: prodId, patron_id: patron.id, nom: prodData.nom, photo_url: 'https://images.unsplash.com/photo-1578587018452-892bacefd3f2?auto=format&fit=crop&w=400&q=80', prix_achat: prodData.prix_achat, prix_vente: prodData.prix_vente, stock_qte: prodData.stock_qte, seuil_alerte: 5, created_at: new Date().toISOString() };
        await db.produits.put(prodRecord);
        await queueSyncItem('produits', 'insert', prodId, prodRecord);
        await loadDatabase(); triggerPostActionPrompt();
      } else if (action.type === 'navigation') setActiveTab(action.data.target);
    } catch (err) { console.error('Erreur exécution vocale:', err); }
  };

  const handleCancelVoiceAction = () => setPendingVoiceAction(null);

  // ROUTE CACHÉE SUPER ADMIN : /efa-admin ou /admin-efa
  if (isAdminRoute) {
    return (
      <EfaAdmin
        onNavigateToClient={() => {
          window.history.pushState({}, '', '/');
          setIsAdminRoute(false);
        }}
      />
    );
  }

  if (showSplash || isInitializing) {
    return <SplashScreen onFinish={() => setShowSplash(false)} />;
  }

  if (previewInviteSlug && patron) {
    return <InviteLandingScreen patron={patron} slug={previewInviteSlug} onAcceptInvite={(slug) => { localStorage.setItem('efa_invite_code', slug); setPreviewInviteSlug(null); speakFrench(`Code d'invitation ${slug} activé !`); }} onBack={() => setPreviewInviteSlug(null)} />;
  }

  // Objectif ZÉRO EMAIL : Écran d'accueil [CRÉER MA BOUTIQUE] et [J'AI DÉJÀ UN COMPTE]
  if (!patron) {
    return (
      <div className="relative min-h-screen">
        <WelcomeAuthScreen
          onSuccess={(newPatron) => {
            setPatron(newPatron);
            const user: CurrentUser = {
              id: newPatron.id,
              nom: newPatron.nom,
              role: 'patron',
              genre: newPatron.genre || 'femme',
              photo_url: newPatron.photo_url,
            };
            setCurrentUser(user);
            localStorage.setItem('efa_active_user_id', user.id);
            localStorage.setItem('entreprise_id', newPatron.id);
            localStorage.setItem('currentBoutiqueId', newPatron.id);
            loadDatabase();
          }}
          onOpenSubscriptionModal={handleOpenSubscriptionModal}
        />
        <EFAVoiceAssistant isOnline={isOnline} products={products} onCommandParsed={(cmd) => setPendingVoiceAction(cmd)} />
        <ConfirmationModal isOpen={!!pendingVoiceAction} summary={pendingVoiceAction?.summary || ''} transcript={pendingVoiceAction?.raw_transcript || ''} onConfirm={handleConfirmVoiceAction} onCancel={handleCancelVoiceAction} />
      </div>
    );
  }

  if (isPinLocked && !getIsPickingPhoto()) {
    return <PinLockScreen patron={patron} employes={employes} currentUser={currentUser} onUnlock={handleUnlockPin} />;
  }

  return (
    <CheckAbonnement entreprise_id={patron?.id}>
      <div className="min-h-screen bg-[#F8F9FA] text-gray-900 select-none">
        {toastNotification && (
          <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[99999] max-w-[92vw] pointer-events-none animate-in fade-in slide-in-from-top-4 duration-200">
            <div className={`px-4 py-2.5 rounded-2xl shadow-2xl flex items-center gap-2.5 text-xs sm:text-sm font-bold border backdrop-blur-md ${toastNotification.type === 'success' ? 'bg-emerald-900/95 text-emerald-100 border-emerald-500/40' : toastNotification.type === 'warning' ? 'bg-amber-900/95 text-amber-100 border-amber-500/40' : 'bg-slate-900/95 text-slate-100 border-slate-700/40'}`}>
              <div className={`w-2.5 h-2.5 rounded-full ${toastNotification.type === 'success' ? 'bg-emerald-400 animate-pulse' : toastNotification.type === 'warning' ? 'bg-amber-400 animate-pulse' : 'bg-blue-400'}`} />
              <span>{toastNotification.message}</span>
            </div>
          </div>
        )}
        {currentUser && (
          <HeaderNav
            patron={patron}
            currentUser={currentUser}
            isOnline={isOnline}
            onOpenLockScreen={() => setIsLockScreenOpen(true)}
            onOpenSettings={() => setIsSettingsOpen(true)}
            onLock={handleLockOrSwitchUser}
            onLogout={handleLogout}
            onNavigate={handleNavigate}
            activeTab={activeTab}
            onRefreshData={handleFastRefresh}
            onOpenMonAbonnementModal={() => setIsMonAbonnementModalOpen(true)}
            deviceStoreName={deviceStoreInfo.storeName}
            onTriggerChangeDeviceStore={() => {
              setIsDeviceChangeMode(true);
              setIsDeviceSelectModalOpen(true);
            }}
          />
        )}
        <main className="max-w-4xl mx-auto p-4 sm:p-6">
          {activeTab === 'home' && currentUser && (
            <HomeScreen
              patron={patron}
              currentUser={currentUser}
              onNavigate={handleNavigate}
              onOpenSubscriptionModal={handleOpenSubscriptionModal}
              onOpenMonAbonnementModal={() => setIsMonAbonnementModalOpen(true)}
            />
          )}
          {activeTab === 'vendre' && currentUser && <VendreScreen patron={patron} currentUser={currentUser} products={products} onBack={() => setActiveTab('home')} onGoToStock={() => setActiveTab('stock')} onOpenSubscriptionModal={handleOpenSubscriptionModal} onSaleCompleted={() => { loadDatabase(); triggerPostActionPrompt(); }} />}
          {activeTab === 'mon-argent' && currentUser && currentUser.role === 'patron' && <MonArgentScreen patron={patron} currentUser={currentUser} ventes={ventes} depenses={depenses} credits={credits} products={products} onBack={() => setActiveTab('home')} onDataRefresh={() => loadDatabase()} />}
          {(activeTab === 'stock' || activeTab === 'ajouter') && currentUser && currentUser.role === 'patron' && <StockScreen patron={patron} products={products} onBack={() => setActiveTab('home')} onRefresh={() => loadDatabase()} onOpenSubscriptionModal={handleOpenSubscriptionModal} />}
          {activeTab === 'employes' && currentUser && currentUser.role === 'patron' && <EmployesScreen patron={patron} employes={employes} onBack={() => setActiveTab('home')} onRefresh={loadDatabase} onOpenSubscriptionModal={handleOpenSubscriptionModal} />}
          {activeTab === 'ambassadrice' && currentUser && currentUser.role === 'patron' && <AmbassadriceScreen patron={patron} parrainages={parrainages} onBack={() => setActiveTab('home')} onRefresh={loadDatabase} onPreviewInvite={(slug) => setPreviewInviteSlug(slug)} />}
          {activeTab === 'historique' && currentUser && currentUser.role === 'patron' && <HistoriqueScreen patron={patron} employes={employes} onBack={() => setActiveTab('home')} onOpenSubscriptionModal={handleOpenSubscriptionModal} />}
          {activeTab === 'mon-abonnement' && currentUser && currentUser.role === 'patron' && patron && <MonAbonnementScreen patron={patron} onBack={() => handleNavigate('home')} onOpenSubscriptionModal={handleOpenSubscriptionModal} onRefreshPatron={loadDatabase} />}
          {activeTab === 'mes-ventes' && currentUser && <MesVentesScreen currentUser={currentUser} ventes={ventes} onBack={() => setActiveTab('home')} />}
          {activeTab === 'mes-boutiques' && currentUser && currentUser.role === 'patron' && (
            <MesBoutiquesScreen
              patron={patron}
              onBack={() => setActiveTab('home')}
              onSelectStoreToView={(storeId) => {
                const targetStore = ownerStores.find((s) => s.id === storeId);
                if (targetStore) {
                  setDeviceStore(targetStore.id, targetStore.nom_boutique);
                  setDeviceStoreInfo(getDeviceStoreInfo());
                  loadDatabase();
                  setActiveTab('home');
                }
              }}
              onOpenSubscriptionModal={handleOpenSubscriptionModal}
              onRefreshData={handleFastRefresh}
            />
          )}
        </main>
        <EFAVoiceAssistant isOnline={isOnline} products={products} plan={patron.subscription_status} isPro={isBoutiquePro(patron)} onOpenSubscriptionModal={handleOpenSubscriptionModal} onCommandParsed={(cmd) => setPendingVoiceAction(cmd)} />
        <ConfirmationModal isOpen={!!pendingVoiceAction} summary={pendingVoiceAction?.summary || ''} transcript={pendingVoiceAction?.raw_transcript || ''} onConfirm={handleConfirmVoiceAction} onCancel={handleCancelVoiceAction} />
        {currentUser && <AutoLogoutPromptModal isOpen={isAutoLogoutPromptOpen} currentUser={currentUser} onStay={() => setIsAutoLogoutPromptOpen(false)} onLock={handleLockOrSwitchUser} />}
        {currentUser && (
          <SettingsModal
            isOpen={isSettingsOpen}
            onClose={() => setIsSettingsOpen(false)}
            patron={patron}
            currentUser={currentUser}
            employes={employes}
            onLogout={handleLogout}
            onPatronUpdated={(updated) => { setPatron(updated); syncEmployeesSubscription(updated.id, updated.subscription_status || 'trial').catch(console.error); }}
            onOpenSubscriptionModal={handleOpenSubscriptionModal}
            onDataRefresh={loadDatabase}
            onNavigate={handleNavigate}
            onOpenMonAbonnementModal={() => setIsMonAbonnementModalOpen(true)}
          />
        )}
        <SubscriptionModal isOpen={subscriptionModal.isOpen || isSubscriptionExpired(patron)} isBlocking={isSubscriptionExpired(patron)} patron={patron} highlightPlan={subscriptionModal.plan} featureReason={subscriptionModal.reason} onClose={() => setSubscriptionModal((prev) => ({ ...prev, isOpen: false }))} />
        <WhoIsSellingModal isOpen={isLockScreenOpen} patron={patron} employes={employes} currentUser={currentUser} canClose={true} onSelectUser={(user) => { setCurrentUser(user); localStorage.setItem('efa_active_user_id', user.id); setIsLockScreenOpen(false); setActiveTab('home'); }} onClose={() => setIsLockScreenOpen(false)} />
        {patron && (
          <MonAbonnementModal
            isOpen={isMonAbonnementModalOpen}
            onClose={() => setIsMonAbonnementModalOpen(false)}
            patron={patron}
          />
        )}
        {patron && (
          <DeviceStoreSelectModal
            isOpen={isDeviceSelectModalOpen}
            patron={patron}
            stores={ownerStores.length > 0 ? ownerStores : [patron]}
            currentDeviceStoreId={deviceStoreInfo.storeId}
            isChangeMode={isDeviceChangeMode}
            onSelectStore={(selected) => {
              setDeviceStore(selected.id, selected.nom_boutique);
              setDeviceStoreInfo(getDeviceStoreInfo());
              setIsDeviceSelectModalOpen(false);
              loadDatabase();
            }}
            onClose={() => setIsDeviceSelectModalOpen(false)}
          />
        )}
      </div>
    </CheckAbonnement>
  );
}