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
import { isSubscriptionExpired, syncEmployeesSubscription, isBoutiquePro, checkCanAddProduct } from './lib/checkLimits';
import { speakFrench } from './lib/speech';
import { supabase } from './lib/supabase';
import { getIsPickingPhoto } from './lib/camera';
import { App as CapacitorApp } from '@capacitor/app';
import {
  withTimeout,
  ensurePatronExistsInSupabase,
  resolveMainPatronId,
  buildCreditSupabasePayload,
  buildDepenseSupabasePayload,
  safeSupabaseWrite,
  upsertProduitSafely,
  atomicDecrementProductStock,
} from './lib/supabaseHelper';
import CheckAbonnement from './components/CheckAbonnement';
import { WelcomeAuthScreen } from './components/WelcomeAuthScreen';
import { getCurrentBoutiqueId, getActiveBoutiqueId, boutiqueToPatron } from './lib/deviceAuth';
import { generatePrefixedId } from './lib/uuid';
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
import { useDailyNotif, showNotif } from './lib/dailyNotification';

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
    }, 3900);
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
      return localStorage.getItem('efa_aconta_locked') === 'true';
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
        const clean = urlRef.trim().toUpperCase();
        (window as any).__efa_ref_code = clean;
        localStorage.setItem('efa_aconta_ref', clean);
      }
      if (window.location.hash.includes('ref=')) {
        const hashIdx = window.location.hash.indexOf('?');
        if (hashIdx !== -1) {
          const hashParams = new URLSearchParams(window.location.hash.substring(hashIdx));
          const hashRef = hashParams.get('ref');
          if (hashRef) {
            const clean = hashRef.trim().toUpperCase();
            (window as any).__efa_ref_code = clean;
            localStorage.setItem('efa_aconta_ref', clean);
          }
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
  const [bottomToast, setBottomToast] = useState<string | null>(null);

  const showToast = useCallback((message: string, type: 'success' | 'warning' | 'info' = 'info') => {
    setToastNotification({ message, type });
    const timer = setTimeout(() => setToastNotification(null), 3500);
    return () => clearTimeout(timer);
  }, []);

  const showToastBottom = useCallback((msg: string) => {
    setBottomToast(msg);
    const timer = setTimeout(() => setBottomToast(null), 6000);
    return () => clearTimeout(timer);
  }, []);

  // RAPPEL QUOTIDIEN 9H (HEURE LOMÉ UTC+0) - NOTIFICATION ANDROID / SERVICE WORKER & CATCH-UP
  useDailyNotif(showToastBottom);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      // 1. Demande permission Notification si besoin
      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
      }
      // 2. Enregistre sw.js
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').catch(() => {});
      }
    }
  }, []);

  useEffect(() => {
    const handleToastEvent = (e: any) => {
      if (e.detail?.message) {
        showToastBottom(e.detail.message);
      }
    };
    window.addEventListener('efa_toast_notif', handleToastEvent);
    return () => window.removeEventListener('efa_toast_notif', handleToastEvent);
  }, [showToastBottom]);

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
          // RÈGLE : Ne vérifie JAMAIS subscription_status dans patrons, elle est toujours à trial.
          // Le vrai PRO est dans boutiques : plan (pro, pro_annuel, populaire) + status = active + subscription_end_date.
          // Quand on se connecte, lis boutiques WHERE id = boutique active, si plan != trial et status = active, affiche PRO.
          let bDataRecord: any = null;

          const { data: bData } = await withTimeout(
            supabase.from('boutiques').select('*').eq('id', currentBoutiqueId).limit(1).maybeSingle(),
            4000
          );
          if (bData) {
            bDataRecord = bData;
          } else {
            // Recherche par téléphone ou nom dans boutiques
            const searchPhone = currentPatron?.telephone;
            const searchNom = currentPatron?.nom_boutique;
            if (searchPhone || searchNom) {
              const orCond = [
                searchPhone ? `telephone.eq.${searchPhone}` : null,
                searchNom ? `nom_boutique.ilike.%${searchNom}%` : null,
              ].filter(Boolean).join(',');
              const { data: bAlt } = await supabase.from('boutiques').select('*').or(orCond).limit(1).maybeSingle();
              if (bAlt) bDataRecord = bAlt;
            }
          }

          // Rechargement direct depuis Supabase à chaque ouverture (patrons + boutiques, jamais cache local seul)
          const mainIdCandidate =
            bDataRecord?.patron_id ||
            currentPatron?.parentId ||
            currentPatron?.ownerId ||
            (currentPatron as any)?.patron_id ||
            currentBoutiqueId;

          let remotePatron: any = null;
          try {
            const { data: rp }: any = await withTimeout(
              supabase.from('patrons').select('*').eq('id', mainIdCandidate).limit(1).maybeSingle(),
              4000
            );
            if (rp) remotePatron = rp;
          } catch {}

          const pickLatestDate = (...candidates: any[]): string | undefined => {
            let bestDate: Date | null = null;
            let bestRaw: string | undefined;
            for (const c of candidates) {
              if (!c || typeof c !== 'string') continue;
              const d = new Date(c);
              if (!isNaN(d.getTime()) && (!bestDate || d > bestDate)) {
                bestDate = d;
                bestRaw = c;
              }
            }
            return bestRaw;
          };

          const classifyRemotePlan = (row1?: any, row2?: any) => {
            const candidates = [
              row1?.plan,
              row1?.forfait,
              row2?.plan,
              row2?.forfait,
              row2?.subscription_status,
            ]
              .map((v) => (typeof v === 'string' ? v.trim() : ''))
              .filter(Boolean);
            const paidCandidate = candidates.find((p) => {
              const low = p.toLowerCase();
              return low !== 'essai' && low !== 'trial' && low !== 'expired';
            });
            const rawPlan = (paidCandidate || candidates[0] || '').toLowerCase();
            const maxAmt = Math.max(
              Number(row1?.last_payment_amount) || 0,
              Number(row2?.last_payment_amount) || 0
            );
            const isPop =
              rawPlan === 'populaire' ||
              rawPlan.includes('populaire') ||
              rawPlan.includes('16500') ||
              rawPlan.includes('prolonge') ||
              (maxAmt === 16500 && !rawPlan.includes('pro'));
            const isPr =
              !isPop &&
              (rawPlan === 'pro' ||
                rawPlan.startsWith('pro_') ||
                (rawPlan.includes('pro') && !rawPlan.includes('prolonge')) ||
                row1?.isProActive === true ||
                row2?.isProActive === true ||
                maxAmt >= 50000);
            return { isPopulaire: isPop, isPro: isPr, rawPlan: paidCandidate || candidates[0] || 'essai' };
          };

          if (bDataRecord) {
            const { isPopulaire, isPro, rawPlan: bestPlanRaw } = classifyRemotePlan(bDataRecord, remotePatron);
            const rawStatus = (bDataRecord.status || bDataRecord.statut || '').toLowerCase().trim();
            const subEndDate = pickLatestDate(
              bDataRecord.subscription_end_date,
              bDataRecord.subscription_end,
              bDataRecord.fin_abonnement,
              remotePatron?.subscription_end_date,
              remotePatron?.subscription_end,
              remotePatron?.fin_abonnement,
              remotePatron?.abonnement_expire
            );
            const isStatusActive = rawStatus === 'active' || rawStatus === 'actif' || rawStatus === '';

            const converted = boutiqueToPatron(bDataRecord);
            const mainDateInscription =
              remotePatron?.date_inscription ||
              remotePatron?.created_at ||
              currentPatron?.date_inscription ||
              (!converted.parentId ? bDataRecord.created_at : undefined) ||
              converted.created_at;
            const freshPatronPhoto = remotePatron
              ? (remotePatron.photo_url || remotePatron.photo_profil || undefined)
              : (currentPatron?.photo_url || currentPatron?.photo_profil || undefined);
            const freshReferralCode =
              remotePatron?.code_parrainage ||
              remotePatron?.referral_code ||
              bDataRecord.code_parrainage ||
              bDataRecord.referral_code ||
              converted.referral_code;
            const freshReferredBy =
              remotePatron?.referred_by ??
              bDataRecord.referred_by ??
              bDataRecord.referred_by_code ??
              null;

            const freshGenre: 'homme' | 'femme' =
              remotePatron?.genre === 'homme' || remotePatron?.genre === 'femme'
                ? remotePatron.genre
                : bDataRecord?.genre === 'homme' || bDataRecord?.genre === 'femme'
                ? bDataRecord.genre
                : currentPatron?.genre === 'homme'
                ? 'homme'
                : 'femme';

            if (currentPatron) {
              const resolvedParent = converted.parentId || currentPatron.parentId || null;
              const resolvedOwner = resolvedParent || converted.ownerId || currentPatron.ownerId || currentPatron.id;
              currentPatron = {
                ...currentPatron,
                ...converted,
                nom: (!resolvedParent && remotePatron?.nom) ? remotePatron.nom : converted.nom,
                genre: freshGenre,
                parentId: resolvedParent,
                ownerId: resolvedOwner,
                patron_id: resolvedOwner,
                type: converted.type || (resolvedParent ? 'SUB' : currentPatron.type),
                photo_url: freshPatronPhoto,
                photo_profil: freshPatronPhoto,
                referral_code: freshReferralCode,
                code_parrainage: freshReferralCode,
                referred_by: freshReferredBy,
                date_inscription: mainDateInscription,
                trial_start_date: mainDateInscription,
                subscription_status: isPro ? 'pro' : isPopulaire ? 'populaire' : converted.subscription_status,
                current_plan: isPro ? 'pro' : isPopulaire ? 'populaire' : converted.current_plan,
                forfait: isPopulaire ? 'populaire' : isPro ? bestPlanRaw : converted.forfait,
                isProActive: isPro,
                statut: isStatusActive ? 'ACTIF' : currentPatron.statut,
                subscription_end_date: subEndDate || currentPatron.subscription_end_date,
                abonnement_expire: subEndDate || currentPatron.abonnement_expire,
                fin_abonnement: subEndDate || currentPatron.fin_abonnement,
                pin_code: currentPatron.pin_code || converted.pin_code,
                code_pin: currentPatron.code_pin || converted.code_pin,
              };
            } else {
              currentPatron = {
                ...converted,
                nom: (!converted.parentId && remotePatron?.nom) ? remotePatron.nom : converted.nom,
                genre: freshGenre,
                photo_url: freshPatronPhoto,
                photo_profil: freshPatronPhoto,
                referral_code: freshReferralCode,
                code_parrainage: freshReferralCode,
                referred_by: freshReferredBy,
                date_inscription: mainDateInscription,
                trial_start_date: mainDateInscription,
                subscription_status: isPro ? 'pro' : isPopulaire ? 'populaire' : converted.subscription_status,
                current_plan: isPro ? 'pro' : isPopulaire ? 'populaire' : converted.current_plan,
                forfait: isPopulaire ? 'populaire' : isPro ? bestPlanRaw : converted.forfait,
                subscription_end_date: subEndDate || converted.subscription_end_date,
                abonnement_expire: subEndDate || converted.abonnement_expire,
                fin_abonnement: subEndDate || converted.fin_abonnement,
                isProActive: isPro,
              };
            }
            await db.patrons.put(currentPatron);
          } else if (remotePatron) {
            const realPin =
              remotePatron.pin_code ||
              remotePatron.code_pin ||
              remotePatron.mot_de_passe ||
              remotePatron.password;
            const freshPatronPhoto = remotePatron.photo_url || remotePatron.photo_profil || undefined;
            const freshReferralCode = remotePatron.code_parrainage || remotePatron.referral_code || undefined;
            const mainDateInscription = remotePatron.date_inscription || remotePatron.created_at || currentPatron?.date_inscription;
            const { isPopulaire: rIsPop, isPro: rIsPro, rawPlan: rRawPlan } = classifyRemotePlan(remotePatron, currentPatron);
            const rSubEnd = pickLatestDate(
              remotePatron.subscription_end_date,
              remotePatron.subscription_end,
              remotePatron.fin_abonnement,
              remotePatron.abonnement_expire,
              currentPatron?.subscription_end_date,
              currentPatron?.abonnement_expire
            );
            const rSubStatus: 'trial' | 'populaire' | 'pro' = rIsPro ? 'pro' : rIsPop ? 'populaire' : 'trial';

            if (currentPatron) {
              currentPatron = {
                ...currentPatron,
                nom: remotePatron.nom || currentPatron.nom,
                nom_boutique: remotePatron.nom_boutique || currentPatron.nom_boutique,
                genre: remotePatron.genre === 'homme' ? 'homme' : (remotePatron.genre === 'femme' ? 'femme' : currentPatron.genre),
                photo_url: freshPatronPhoto,
                photo_profil: freshPatronPhoto,
                code_parrainage: freshReferralCode,
                referral_code: freshReferralCode,
                referred_by: remotePatron.referred_by ?? null,
                date_inscription: mainDateInscription || currentPatron.created_at,
                trial_start_date: mainDateInscription || currentPatron.trial_start_date,
                solde: typeof remotePatron.solde === 'number' ? remotePatron.solde : (currentPatron.solde ?? 0),
                pin_code: realPin !== undefined ? realPin : currentPatron.pin_code,
                code_pin: realPin !== undefined ? realPin : currentPatron.code_pin,
                pin_hash: remotePatron.pin_hash || currentPatron.pin_hash,
                abonnement_expire: rSubEnd || remotePatron.abonnement_expire || currentPatron.abonnement_expire,
                subscription_end_date: rSubEnd || currentPatron.subscription_end_date,
                fin_abonnement: rSubEnd || currentPatron.fin_abonnement,
                subscription_status: rSubStatus !== 'trial' ? rSubStatus : currentPatron.subscription_status,
                current_plan: rSubStatus !== 'trial' ? rSubStatus : currentPatron.current_plan,
                forfait: rSubStatus !== 'trial' ? rRawPlan : currentPatron.forfait,
                isProActive: rIsPro || Boolean(currentPatron.isProActive),
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
                photo_url: freshPatronPhoto,
                photo_profil: freshPatronPhoto,
                code_parrainage: freshReferralCode,
                referral_code: freshReferralCode,
                referred_by: remotePatron.referred_by ?? null,
                date_inscription: mainDateInscription || new Date().toISOString(),
                trial_start_date: mainDateInscription || new Date().toISOString(),
                pin_code: realPin || '',
                code_pin: realPin || '',
                pin_hash: remotePatron.pin_hash || '',
                genre: remotePatron.genre || 'femme',
                role: 'patron',
                solde: Number(remotePatron.solde) || 0,
                abonnement_expire:
                  rSubEnd ||
                  remotePatron.abonnement_expire ||
                  remotePatron.subscription_end_date ||
                  new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString(),
                subscription_end_date: rSubEnd,
                fin_abonnement: rSubEnd,
                subscription_status: rSubStatus,
                current_plan: rSubStatus,
                forfait: rSubStatus !== 'trial' ? rRawPlan : 'essai',
                isProActive: rIsPro,
                created_at: remotePatron.created_at || new Date().toISOString(),
              };
            }
            if (currentPatron) {
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

        const lowStatus = String(currentPatron.subscription_status || '').toLowerCase();
        const lowPlan = String(currentPatron.current_plan || '').toLowerCase();
        const lowForfait = String(currentPatron.forfait || '').toLowerCase();
        const isPopulaireActive =
          lowStatus.includes('populaire') ||
          lowPlan.includes('populaire') ||
          lowForfait.includes('populaire') ||
          lowForfait.includes('16500') ||
          lowStatus.includes('prolonge') ||
          lowPlan.includes('prolonge') ||
          lowForfait.includes('prolonge');
        const isProActiveFlag =
          !isPopulaireActive &&
          (currentPatron.isProActive ||
            lowStatus === 'pro' ||
            lowStatus.startsWith('pro_') ||
            lowPlan === 'pro' ||
            lowPlan.startsWith('pro_') ||
            (lowForfait.includes('pro') && !lowForfait.includes('prolonge')));

        // RÈGLE : Si PRO actif ou POPULAIRE actif, ne JAMAIS forcer trial !
        if (isProActiveFlag) {
          currentPatron.subscription_status = 'pro';
          currentPatron.current_plan = 'pro';
          currentPatron.isProActive = true;
          currentPatron.statut = 'ACTIF';
        } else if (isPopulaireActive) {
          currentPatron.subscription_status = 'populaire';
          currentPatron.current_plan = 'populaire';
          currentPatron.isProActive = false;
          currentPatron.statut = 'ACTIF';
        } else {
          // Calcul strict des 21 jours d'essai depuis patrons.date_inscription (et respecter tout bonus +60j déjà accordé)
          const inscriptionSource =
            currentPatron.date_inscription ||
            currentPatron.trial_start_date ||
            (!currentPatron.parentId ? currentPatron.created_at : undefined) ||
            new Date().toISOString();
          const created = new Date(inscriptionSource);
          const trialEnd = new Date(created.getTime() + 21 * 24 * 60 * 60 * 1000);
          const existingSubEnd = currentPatron.subscription_end_date ? new Date(currentPatron.subscription_end_date) : null;
          const effectiveTrialEnd =
            existingSubEnd && !isNaN(existingSubEnd.getTime()) && existingSubEnd > trialEnd
              ? existingSubEnd
              : trialEnd;
          currentPatron.date_inscription = created.toISOString();
          currentPatron.trial_start_date = created.toISOString();
          currentPatron.trial_end_date = effectiveTrialEnd.toISOString();
          currentPatron.subscription_end_date = currentPatron.subscription_end_date || effectiveTrialEnd.toISOString();
          if (now > effectiveTrialEnd) {
            currentPatron.subscription_status = 'expired';
            patronNeedsUpdate = true;
          } else if (currentPatron.subscription_status !== 'trial') {
            currentPatron.subscription_status = 'trial';
            patronNeedsUpdate = true;
          }
        }

        const resolvedCode = currentPatron.code_parrainage || currentPatron.referral_code;
        if (!resolvedCode) {
          const generatedCode = generateReferralCode();
          currentPatron.referral_code = generatedCode;
          currentPatron.code_parrainage = generatedCode;
          patronNeedsUpdate = true;
          if (typeof navigator !== 'undefined' && navigator.onLine) {
            const codeTargetId = currentPatron.parentId || currentPatron.patron_id || currentPatron.id;
            safeSupabaseWrite(
              'patrons',
              'update',
              { code_parrainage: generatedCode, referral_code: generatedCode },
              { column: 'id', value: codeTargetId }
            ).catch(() => {});
            safeSupabaseWrite(
              'boutiques',
              'update',
              { code_parrainage: generatedCode, referral_code: generatedCode },
              { column: 'id', value: currentPatron.id }
            ).catch(() => {});
          }
        } else {
          currentPatron.referral_code = resolvedCode;
          currentPatron.code_parrainage = resolvedCode;
        }

        if (patronNeedsUpdate) {
          await db.patrons.put(currentPatron);
        }
        setPatron(currentPatron);
        if (typeof window !== 'undefined') localStorage.setItem('entreprise_id', currentPatron.id);
        syncEmployeesSubscription(currentPatron.id, currentPatron.subscription_status || 'trial').catch(() => {});

        // 4. Synchronisation 100% Supabase au démarrage / login / vidage cache
        if (typeof navigator !== 'undefined' && navigator.onLine) {
          try {
            // A. Si sous-boutique ou boutique 2/3 du même patron_id, hérite du forfait PRO et expiration du parent
            // RÈGLE PARRAINAGE : Une boutique parrainée est TOUJOURS une boutique principale indépendante, jamais une sous-boutique
            const isReferredShop = Boolean(
              currentPatron.referred_by ||
              (currentPatron as any).referred_by_code
            );

            const patronOwnerId = currentPatron.parentId || (currentPatron as any).patron_id;
            if (!isReferredShop && patronOwnerId && patronOwnerId !== currentPatron.id) {
              const { data: parentBtq } = await supabase
                .from('boutiques')
                .select('*')
                .eq('id', patronOwnerId)
                .maybeSingle();
              const pParentPlan = (parentBtq?.plan || '').toLowerCase().trim();
              const isParentBtqPro =
                Boolean(parentBtq) &&
                !pParentPlan.includes('populaire') &&
                !pParentPlan.includes('prolonge') &&
                !pParentPlan.includes('16500') &&
                (pParentPlan === 'pro' ||
                  pParentPlan.startsWith('pro_') ||
                  Number(parentBtq?.last_payment_amount) >= 50000 ||
                  isProActive(parentBtq as any));
              if (isParentBtqPro && parentBtq) {
                currentPatron.subscription_status = 'pro';
                currentPatron.current_plan = 'pro';
                currentPatron.isProActive = true;
                currentPatron.type = 'SUB';
                currentPatron.parentId = patronOwnerId;
                currentPatron.isSubOfPro = true;
                currentPatron.subBadgeText = 'PRO - Incluse dans Principale';
                currentPatron.subscription_end_date = parentBtq.subscription_end_date || parentBtq.subscription_end;
                currentPatron.abonnement_expire = parentBtq.subscription_end_date || parentBtq.subscription_end;
                currentPatron.has_paid_annuel = Boolean(parentBtq.has_paid_annuel);
                currentPatron.statut = 'ACTIF';
                await db.patrons.put(currentPatron);
              }
            } else if (!isReferredShop && currentPatron.telephone) {
              // Vérifie par téléphone/WhatsApp si boutique 2 ou 3 créée sous le même patron (hors compte parrainé)
              const { data: siblings } = await supabase
                .from('boutiques')
                .select('*')
                .or(`telephone.eq.${currentPatron.telephone},whatsapp_number.eq.${currentPatron.telephone}`)
                .order('created_at', { ascending: true });
              if (siblings && siblings.length > 1) {
                const mainSibling = siblings[0];
                const sibPlan = (mainSibling.plan || '').toLowerCase().trim();
                const isMainPro =
                  !sibPlan.includes('populaire') &&
                  !sibPlan.includes('prolonge') &&
                  !sibPlan.includes('16500') &&
                  (sibPlan === 'pro' ||
                    sibPlan.startsWith('pro_') ||
                    Number(mainSibling.last_payment_amount) >= 50000);
                if (isMainPro && mainSibling.id !== currentPatron.id) {
                  currentPatron.subscription_status = 'pro';
                  currentPatron.current_plan = 'pro';
                  currentPatron.isProActive = true;
                  currentPatron.type = 'SUB';
                  currentPatron.parentId = mainSibling.id;
                  currentPatron.ownerId = mainSibling.id;
                  currentPatron.patron_id = mainSibling.id;
                  currentPatron.isSubOfPro = true;
                  currentPatron.subBadgeText = 'PRO - Incluse dans Principale';
                  currentPatron.subscription_end_date = mainSibling.subscription_end_date || mainSibling.subscription_end;
                  currentPatron.abonnement_expire = mainSibling.subscription_end_date || mainSibling.subscription_end;
                  currentPatron.has_paid_annuel = Boolean(mainSibling.has_paid_annuel);
                  currentPatron.statut = 'ACTIF';
                  await db.patrons.put(currentPatron);
                }
              }
            }

            const resolvedMainPatronId = getMainStoreId(currentPatron);

            // Détermine le filtre Supabase par boutique active pour produits & employés
            const btqFilter = currentBoutiqueId && currentBoutiqueId !== currentPatron.id
              ? `boutique_id.eq.${currentBoutiqueId}`
              : `boutique_id.eq.${currentPatron.id},and(boutique_id.is.null,patron_id.eq.${currentPatron.id})`;

            // B. Rechargement des produits depuis Supabase (sans jamais effacer le cache local si Supabase est vide)
            const { data: remoteProds, error: prodErr } = await supabase
              .from('produits')
              .select('*')
              .or(btqFilter)
              .order('created_at', { ascending: false });

            if (!prodErr && remoteProds && remoteProds.length > 0) {
              const activeRemoteProds = remoteProds.filter(
                (p: any) => p.status !== 'deleted' && p.is_deleted !== true
              );
              if (activeRemoteProds.length > 0) {
                await db.produits.bulkPut(
                  activeRemoteProds.map((p: any) => ({
                    id: p.id,
                    boutique_id: p.boutique_id || currentBoutiqueId,
                    patron_id: p.patron_id || resolvedMainPatronId,
                    nom: p.nom,
                    prix_achat: Number(p.prix_achat) || 0,
                    prix_vente: Number(p.prix_vente) || 0,
                    stock_qte: Number(p.stock_qte) || 0,
                    seuil_alerte: Number(p.seuil_alerte) ?? 5,
                    categorie: p.categorie || 'Général',
                    photo_url: p.photo_url || '',
                    status: p.status || 'active',
                    is_deleted: Boolean(p.is_deleted),
                    synced: true,
                    created_at: p.created_at || new Date().toISOString(),
                  }))
                );
              }
            }

            // C. Rechargement des employés depuis Supabase (sans jamais effacer le cache local si Supabase est vide)
            const { data: remoteEmps, error: empErr } = await supabase
              .from('employes')
              .select('*')
              .or(btqFilter)
              .order('created_at', { ascending: false });
            if (!empErr && remoteEmps && remoteEmps.length > 0) {
              await db.employes.bulkPut(
                remoteEmps.map((e) => ({
                  id: e.id,
                  boutique_id: e.boutique_id || currentBoutiqueId,
                  patron_id: e.patron_id || resolvedMainPatronId,
                  nom: e.nom,
                  role: (e.role as any) || 'vendeuse',
                  telephone: e.telephone || '',
                  phone_country: e.phone_country || '+228',
                  phone_number: e.phone_number || '',
                  phone_full: e.phone_full || e.telephone || '',
                  pin_hash: e.pin_hash || '',
                  pin_code: e.code_pin || e.pin_code || '',
                  code_pin: e.code_pin || e.pin_code || '',
                  status: e.status || 'active',
                  is_active: e.is_active !== false,
                  genre: e.genre || 'femme',
                  photo_url: e.photo_url,
                  subscription_status: currentPatron.subscription_status || 'trial',
                  created_at: e.created_at || new Date().toISOString(),
                }))
              );
            }

            // D. Rechargement des ventes depuis Supabase (table 'ventes' ET 'transactions')
            // RÈGLE 3 : Toujours filtrer avec .eq('boutique_id', currentBoutiqueId)
            const fetchedVentesMap = new Map<string, any>();

            try {
              const { data: remoteVentes } = await supabase
                .from('ventes')
                .select('*')
                .eq('boutique_id', currentBoutiqueId);
              if (remoteVentes && remoteVentes.length > 0) {
                for (const v of remoteVentes) {
                  fetchedVentesMap.set(v.id, v);
                }
              }
            } catch (err) {
              console.warn('[App] Erreur select ventes Supabase:', err);
            }

            // Vérifier également la table 'transactions' car les ventes y sont envoyées
            try {
              const { data: remoteTrans } = await supabase
                .from('transactions')
                .select('*')
                .eq('boutique_id', currentBoutiqueId);
              if (remoteTrans && remoteTrans.length > 0) {
                for (const t of remoteTrans) {
                  if (!fetchedVentesMap.has(t.id)) {
                    fetchedVentesMap.set(t.id, t);
                  }
                }
              }
            } catch (err) {
              console.warn('[App] Erreur select transactions Supabase:', err);
            }

            // RÈGLE CRUCIALE 2 : NE JAMAIS ÉCRASER LE CACHE LOCAL PAR SUPABASE VIDE
            if (fetchedVentesMap.size > 0) {
              // Récupérer les ventes hors-ligne créées localement pas encore synchronisées pour cette boutique
              const localUnsynced = await db.ventes
                .filter(
                  (v) =>
                    v.synced === false &&
                    (v.boutique_id ? v.boutique_id === currentBoutiqueId : v.patron_id === currentBoutiqueId)
                )
                .toArray();

              const listToSave: Vente[] = Array.from(fetchedVentesMap.values()).map((v) => ({
                id: v.id,
                ticket_id: v.ticket_id || v.id,
                patron_id: v.patron_id || resolvedMainPatronId,
                boutique_id: v.boutique_id || currentBoutiqueId,
                produit_id: v.produit_id || '',
                produit_nom: v.produit_nom || '',
                qte: Number(v.qte || v.quantite) || 1,
                montant_total: Number(v.montant_total || v.montant) || 0,
                client_nom: v.client_nom || '',
                est_credit: Boolean(v.est_credit),
                reste_a_payer: Number(v.reste_a_payer) || 0,
                status: v.status || 'active',
                is_deleted: Boolean(v.is_deleted),
                vendu_par_id: v.vendu_par_id || v.employee_id || currentPatron.id,
                employee_id: v.employee_id ?? null,
                vendu_par_nom: v.vendu_par_nom || currentPatron.nom,
                vendu_par_genre: v.vendu_par_genre || 'femme',
                date: v.date || v.created_at || new Date().toISOString(),
                synced: true,
              }));

              await db.ventes.bulkPut(listToSave);
              if (localUnsynced.length > 0) {
                await db.ventes.bulkPut(localUnsynced);
              }
            }

            // E. Rechargement des dépenses depuis Supabase avec .eq('boutique_id', currentBoutiqueId)
            const { data: remoteDep, error: depErr } = await supabase
              .from('depenses')
              .select('*')
              .eq('boutique_id', currentBoutiqueId);
            if (!depErr && remoteDep && remoteDep.length > 0) {
              const localUnsyncedDep = await db.depenses
                .filter(
                  (d) =>
                    d.synced === false &&
                    (d.boutique_id ? d.boutique_id === currentBoutiqueId : d.patron_id === currentBoutiqueId)
                )
                .toArray();

              await db.depenses.bulkPut(
                remoteDep.map((d) => ({
                  id: d.id,
                  patron_id: d.patron_id || resolvedMainPatronId,
                  boutique_id: d.boutique_id || currentBoutiqueId,
                  type: d.type || 'autre',
                  montant: Number(d.montant) || 0,
                  description: d.description || '',
                  cree_par: d.cree_par || currentPatron.nom,
                  date: d.date || new Date().toISOString(),
                  synced: true,
                }))
              );
              if (localUnsyncedDep.length > 0) {
                await db.depenses.bulkPut(localUnsyncedDep);
              }
            }

            // F. Rechargement des crédits depuis Supabase avec .eq('boutique_id', currentBoutiqueId)
            const { data: remoteCred, error: credErr } = await supabase
              .from('credits')
              .select('*')
              .eq('boutique_id', currentBoutiqueId);
            if (!credErr && remoteCred && remoteCred.length > 0) {
              const localUnsyncedCred = await db.credits
                .filter(
                  (c) =>
                    c.synced === false &&
                    (c.boutique_id ? c.boutique_id === currentBoutiqueId : c.patron_id === currentBoutiqueId)
                )
                .toArray();

              await db.credits.bulkPut(
                remoteCred.map((c) => {
                  const totalVal = Number(c.montant_total ?? c.montant_initial ?? c.reste_a_payer) || 0;
                  const resteVal = Number(c.reste_a_payer) || 0;
                  const payeVal = Number(c.montant_paye ?? Math.max(0, totalVal - resteVal)) || 0;
                  const computedStatus = c.status || c.statut || (resteVal <= 0 ? 'payé' : 'en_cours');
                  return {
                    id: c.id,
                    sale_id: c.sale_id || '',
                    patron_id: c.patron_id || resolvedMainPatronId,
                    boutique_id: c.boutique_id || currentBoutiqueId,
                    client_nom: c.client_nom || '',
                    montant_initial: totalVal,
                    montant_total: totalVal,
                    montant_paye: payeVal,
                    reste_a_payer: resteVal,
                    telephone: c.telephone || '',
                    dernier_paiement: c.dernier_paiement || new Date().toISOString(),
                    status: computedStatus,
                    statut: computedStatus,
                    synced: true,
                  };
                })
              );
              if (localUnsyncedCred.length > 0) {
                await db.credits.bulkPut(localUnsyncedCred);
              }
            }
          } catch (syncErr) {
            console.warn('[App] Erreur sync entités Supabase:', syncErr);
          }
        }

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

        // Filtrage STRICT par boutique courante (currentBoutiqueId) pour éviter tout mélange entre boutiques
        const [empList, prodList, ventList, depList, credList, parrList] = await Promise.all([
          db.employes.filter((e) => (e.boutique_id ? e.boutique_id === currentBoutiqueId : e.patron_id === currentBoutiqueId)).toArray(),
          db.produits
            .filter(
              (p) =>
                p.status !== 'deleted' &&
                p.is_deleted !== true &&
                (p.boutique_id ? p.boutique_id === currentBoutiqueId : p.patron_id === currentBoutiqueId)
            )
            .toArray(),
          db.ventes.filter((v) => (v.boutique_id ? v.boutique_id === currentBoutiqueId : v.patron_id === currentBoutiqueId)).toArray(),
          db.depenses.filter((d) => (d.boutique_id ? d.boutique_id === currentBoutiqueId : d.patron_id === currentBoutiqueId)).toArray(),
          db.credits.filter((c) => (c.boutique_id ? c.boutique_id === currentBoutiqueId : c.patron_id === currentBoutiqueId)).toArray(),
          db.parrainage.where('parrain_id').equals(getMainStoreId(currentPatron)).toArray(),
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
        } else if (currentUser.role === 'patron') {
          // Garder nom, photo et genre patron à jour après rechargement Supabase
          const patronGenre = currentPatron.genre || 'femme';
          if (
            currentUser.nom !== currentPatron.nom ||
            currentUser.photo_url !== currentPatron.photo_url ||
            currentUser.genre !== patronGenre
          ) {
            setCurrentUser({
              ...currentUser,
              nom: currentPatron.nom,
              photo_url: currentPatron.photo_url,
              genre: patronGenre,
            });
          }
        } else {
          const refreshedEmp = empList.find((e) => e.id === currentUser.id);
          if (
            refreshedEmp &&
            (currentUser.nom !== refreshedEmp.nom || currentUser.photo_url !== refreshedEmp.photo_url)
          ) {
            setCurrentUser({
              ...currentUser,
              nom: refreshedEmp.nom,
              photo_url: refreshedEmp.photo_url,
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

  // Synchronisation automatique en temps réel multi-appareils (Supabase Realtime)
  useEffect(() => {
    if (!patron?.id || typeof navigator === 'undefined' || !navigator.onLine) return;

    const channel = supabase
      .channel(`app_realtime_${patron.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, () => {
        loadDatabase();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'credits' }, () => {
        loadDatabase();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'historique_actions' }, () => {
        loadDatabase();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ventes' }, () => {
        loadDatabase();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'produits' }, () => {
        loadDatabase();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'employes' }, () => {
        loadDatabase();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'depenses' }, () => {
        loadDatabase();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'boutiques' }, () => {
        loadDatabase();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [patron?.id, loadDatabase]);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      processSyncQueue().then((res) => {
        loadDatabase();
        if (res.syncedCount > 0) {
          showToast(`${res.syncedCount} vente(s) hors-ligne synchronisée(s)`, 'success');
        }
      }).catch(console.error);
    };

    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Synchronisation périodique
    const interval = setInterval(() => {
      if (typeof navigator !== 'undefined' && navigator.onLine) {
        processSyncQueue().then((res) => {
          if (res.syncedCount > 0) {
            console.log(`[Sync] ${res.syncedCount} synchronisé(s)`);
            loadDatabase();
          }
        });
      }
    }, 15000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
    };
  }, [loadDatabase, showToast]);

  const lockApp = useCallback(() => {
    if (getIsPickingPhoto()) return;
    if (!patron) return;
    localStorage.setItem('efa_aconta_locked', 'true');
    setIsPinLocked(true);
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
    const handlePopState = () => {
      if (typeof window !== 'undefined' && localStorage.getItem('efa_aconta_locked') === 'true') {
        setIsPinLocked(true);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const handleUnlockPin = (unlockedUser: CurrentUser) => {
    localStorage.setItem('efa_aconta_locked', 'false');
    setCurrentUser(unlockedUser);
    localStorage.setItem('efa_active_user_id', unlockedUser.id);
    setIsPinLocked(false);
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
    if (tab === 'mon-argent' || tab === 'stock' || tab === 'vendre' || tab === 'home') {
      loadDatabase();
    }
    if (typeof window !== 'undefined') {
      if (tab === 'ambassadrice') window.history.pushState({}, '', '/ambassadrice');
      else if (tab === 'mon-abonnement') window.history.pushState({}, '', '/mon-abonnement');
      else if (tab === 'mes-boutiques') window.history.pushState({}, '', '/mes-boutiques');
      else if (tab === 'home') window.history.pushState({}, '', '/');
    }
  }, [currentUser, showToast, loadDatabase]);

  const triggerPostActionPrompt = () => { if (patron?.auto_logout_after_action !== false) setIsAutoLogoutPromptOpen(true); };

  const handleConfirmVoiceAction = async () => {
    if (!pendingVoiceAction || !patron || !currentUser) return;
    const action = pendingVoiceAction;
    setPendingVoiceAction(null);
    const activeBoutiqueId = getActiveBoutiqueId(patron);
    const mainPatronId = (await resolveMainPatronId(patron)) || patron.id;
    const isOnlineNow = typeof navigator !== 'undefined' && navigator.onLine;

    try {
      if (isOnlineNow && (action.type === 'vente' || action.type === 'depense')) {
        await ensurePatronExistsInSupabase(mainPatronId, patron);
      }

      if (action.type === 'vente') {
        const saleData = action.data;
        // RÈGLE : Réservation atomique du stock AVANT toute écriture vente/caisse
        const stockRes = await atomicDecrementProductStock({
          productId: saleData.produit_id,
          boutiqueId: activeBoutiqueId,
          qty: Number(saleData.qte) || 1,
          productName: saleData.produit_nom,
        });
        if (!stockRes.success) {
          const errMsg = stockRes.error || `Stock insuffisant pour ${saleData.produit_nom}.`;
          showToast(errMsg, 'warning');
          speakFrench(errMsg);
          await loadDatabase();
          return;
        }

        // RÈGLE : ID unique neuf avec crypto.randomUUID()
        const saleId = generatePrefixedId('vte');
        const nowIso = new Date().toISOString();
        const saleRecord: Vente = { id: saleId, patron_id: mainPatronId, boutique_id: activeBoutiqueId, produit_id: saleData.produit_id, produit_nom: saleData.produit_nom, qte: saleData.qte, montant_total: saleData.montant_total, client_nom: saleData.client_nom, est_credit: saleData.est_credit, reste_a_payer: saleData.reste_a_payer, vendu_par_id: currentUser.id, employee_id: currentUser.role === 'patron' ? null : currentUser.id, vendu_par_nom: currentUser.nom, vendu_par_genre: currentUser.genre, date: nowIso, synced: isOnlineNow };

        const currentProd = products.find((p) => p.id === saleData.produit_id);
        const newStock = typeof stockRes.newStock === 'number'
          ? stockRes.newStock
          : Math.max(0, (currentProd?.stock_qte ?? 0) - saleData.qte);
        const rowTx = {
          id: saleId,
          ticket_id: saleId,
          patron_id: mainPatronId,
          boutique_id: activeBoutiqueId,
          produit_id: saleData.produit_id,
          produit_nom: saleData.produit_nom,
          qte: saleData.qte,
          quantite: saleData.qte,
          montant: saleData.montant_total,
          montant_total: saleData.montant_total,
          client_nom: saleData.client_nom,
          est_credit: saleData.est_credit,
          type: 'vente',
          vendu_par_nom: currentUser.nom,
          date: nowIso,
        };

        let venteSaved = false;
        if (isOnlineNow) {
          try {
            const resVente: any = await supabase.from('ventes').upsert([{ ...saleRecord, boutique_id: activeBoutiqueId }], { onConflict: 'id' });
            if (resVente?.status === 409 || resVente?.error?.code === '23505') {
              console.log('[Sync 409 Déjà présent]', 'ventes', saleId);
            }
            const resTx: any = await supabase.from('transactions').upsert([rowTx], { onConflict: 'id' });
            if (!resTx?.error || resTx?.status === 409 || resTx?.error?.code === '23505') {
              venteSaved = true;
              if (resTx?.status === 409 || resTx?.error?.code === '23505') {
                console.log('[Sync 409 Déjà présent]', 'transactions', saleId);
              }
            }
          } catch (vErr) {
            console.error('[VoiceSale] Erreur Supabase:', vErr);
          }
        }

        if (!venteSaved) {
          saleRecord.synced = false;
          await queueSyncItem('ventes', 'insert', saleId, { ...saleRecord, boutique_id: activeBoutiqueId });
          await queueSyncItem('transactions', 'insert', saleId, rowTx);
          if (stockRes.offlineQueued || !isOnlineNow) {
            await queueSyncItem('produits', 'update', saleData.produit_id, { stock_qte: newStock });
          }
        }

        await db.ventes.put(saleRecord);
        if (currentProd) {
          await db.produits.update(currentProd.id, { stock_qte: newStock });
        }
        if (saleData.est_credit && (Number(saleData.reste_a_payer) || 0) > 0) {
          const creditId = saleId;
          const resteVal = Number(saleData.reste_a_payer) || 0;
          const totalVal = Number(saleData.montant_total) || resteVal;
          const payeVal = Math.max(0, totalVal - resteVal);
          const supabaseCreditPayload = buildCreditSupabasePayload({
            id: creditId,
            patron_id: mainPatronId,
            boutique_id: activeBoutiqueId,
            client_nom: saleData.client_nom || 'Client crédit',
            montant_total: totalVal,
            montant_paye: payeVal,
            reste_a_payer: resteVal,
            dernier_paiement: nowIso,
          });
          const creditRecord: Credit = {
            id: creditId,
            sale_id: saleId,
            patron_id: mainPatronId,
            boutique_id: activeBoutiqueId,
            client_nom: saleData.client_nom || 'Client crédit',
            montant_initial: totalVal,
            montant_total: totalVal,
            montant_paye: payeVal,
            reste_a_payer: resteVal,
            dernier_paiement: nowIso,
            status: 'en_cours',
            statut: 'en_cours',
            synced: isOnlineNow,
          };
          let credSaved = false;
          if (isOnlineNow) {
            try {
              const resCred: any = await supabase.from('credits').upsert([supabaseCreditPayload], { onConflict: 'id' });
              if (!resCred?.error || resCred?.status === 409 || resCred?.error?.code === '23505') {
                credSaved = true;
                if (resCred?.status === 409 || resCred?.error?.code === '23505') {
                  console.log('[Sync 409 Déjà présent]', 'credits', creditId);
                }
              }
            } catch {
              // ignore
            }
          }
          if (!credSaved) {
            creditRecord.synced = false;
            await queueSyncItem('credits', 'insert', creditId, supabaseCreditPayload);
          }
          await db.credits.put(creditRecord);
        }

        // CAISSE INDÉPENDANTE : Mise à jour STRICTEMENT sur activeBoutiqueId
        const cashReceived = saleData.est_credit
          ? Math.max(0, (Number(saleData.montant_total) || 0) - (Number(saleData.reste_a_payer) || 0))
          : (Number(saleData.montant_total) || 0);
        if (cashReceived > 0) {
          let newVoiceSolde = (Number(patron.solde) || 0) + cashReceived;
          if (isOnlineNow) {
            try {
              const { data: btqData } = await supabase.from('boutiques').select('solde').eq('id', activeBoutiqueId).maybeSingle();
              let curS = btqData?.solde !== null && btqData?.solde !== undefined && !isNaN(Number(btqData.solde))
                ? Number(btqData.solde)
                : NaN;
              if (isNaN(curS)) {
                const { data: pData } = await supabase.from('patrons').select('solde').eq('id', activeBoutiqueId).maybeSingle();
                curS = pData?.solde !== null && pData?.solde !== undefined && !isNaN(Number(pData.solde)) ? Number(pData.solde) : 0;
              }
              newVoiceSolde = curS + cashReceived;
              await supabase.from('boutiques').update({ solde: newVoiceSolde }).eq('id', activeBoutiqueId);
              await supabase.from('patrons').update({ solde: newVoiceSolde }).eq('id', activeBoutiqueId);
            } catch {}
          }
          patron.solde = newVoiceSolde;
          try {
            await db.patrons.update(activeBoutiqueId, { solde: newVoiceSolde });
            if (patron.id !== activeBoutiqueId) await db.patrons.update(patron.id, { solde: newVoiceSolde });
          } catch {}
        }

        await logAction({ patron_id: mainPatronId, boutique_id: activeBoutiqueId, user_id: currentUser.id, employe_id: currentUser.role === 'patron' ? null : currentUser.id, employe_nom: currentUser.role === 'patron' ? undefined : (currentUser.prenom || currentUser.nom), action_type: 'vente', description: `Vente vocale ${saleData.qte}x ${saleData.produit_nom} (${saleData.montant_total}F) par ${currentUser.role === 'patron' ? 'Patron' : (currentUser.prenom || currentUser.nom)}`, montant: saleData.montant_total }).catch(console.error);
        await loadDatabase(); triggerPostActionPrompt();
      } else if (action.type === 'depense') {
        const depData = action.data;
        // RÈGLE : ID unique neuf avec crypto.randomUUID()
        const depId = generatePrefixedId('dep');
        const nowIso = new Date().toISOString();
        const depPayload = buildDepenseSupabasePayload({
          id: depId,
          patron_id: mainPatronId,
          boutique_id: activeBoutiqueId,
          type: depData.type,
          montant: depData.montant,
          description: depData.description,
          cree_par: currentUser.nom,
          date: nowIso,
        });
        const depRecord: Depense = { id: depId, patron_id: mainPatronId, boutique_id: activeBoutiqueId, type: depData.type, montant: depData.montant, description: depData.description, cree_par: currentUser.nom, date: nowIso, synced: isOnlineNow };
        const rowTxDep = {
          id: depId,
          ticket_id: depId,
          patron_id: mainPatronId,
          boutique_id: activeBoutiqueId,
          produit_id: 'depense',
          produit_nom: `Dépense: ${depData.type}`,
          qte: 1,
          quantite: 1,
          montant: depData.montant,
          montant_total: depData.montant,
          type: 'depense',
          status: 'active',
          is_deleted: false,
          vendu_par_nom: currentUser.nom,
          date: nowIso,
        };
        let depSaved = false;
        let txSaved = false;
        if (isOnlineNow) {
          try {
            const resDep: any = await supabase.from('depenses').upsert([depPayload], { onConflict: 'id' });
            if (!resDep?.error || resDep?.status === 409 || resDep?.error?.code === '23505') {
              depSaved = true;
              if (resDep?.status === 409 || resDep?.error?.code === '23505') {
                console.log('[Sync 409 Déjà présent]', 'depenses', depId);
              }
            }
            try {
              const resTx: any = await supabase.from('transactions').upsert([rowTxDep], { onConflict: 'id' });
              if (!resTx?.error || resTx?.status === 409 || resTx?.error?.code === '23505') {
                txSaved = true;
              }
            } catch {}
            // CAISSE INDÉPENDANTE : Déduire STRICTEMENT sur activeBoutiqueId
            const depAmount = Number(depData.montant) || 0;
            if (depAmount > 0) {
              const { data: btqData } = await supabase.from('boutiques').select('solde').eq('id', activeBoutiqueId).maybeSingle();
              let curS = btqData?.solde !== null && btqData?.solde !== undefined && !isNaN(Number(btqData.solde))
                ? Number(btqData.solde)
                : NaN;
              if (isNaN(curS)) {
                const { data: pData } = await supabase.from('patrons').select('solde').eq('id', activeBoutiqueId).maybeSingle();
                curS = pData?.solde !== null && pData?.solde !== undefined && !isNaN(Number(pData.solde)) ? Number(pData.solde) : 0;
              }
              const newVoiceSolde = Math.max(0, curS - depAmount);
              await supabase.from('boutiques').update({ solde: newVoiceSolde }).eq('id', activeBoutiqueId);
              await supabase.from('patrons').update({ solde: newVoiceSolde }).eq('id', activeBoutiqueId);
              patron.solde = newVoiceSolde;
              try {
                await db.patrons.update(activeBoutiqueId, { solde: newVoiceSolde });
                if (patron.id !== activeBoutiqueId) await db.patrons.update(patron.id, { solde: newVoiceSolde });
              } catch {}
            }
          } catch {
            // ignore
          }
        }
        if (!depSaved) {
          depRecord.synced = false;
          await queueSyncItem('depenses', 'insert', depId, depPayload);
        }
        if (!txSaved) {
          await queueSyncItem('transactions', 'insert', depId, rowTxDep);
        }
        await db.depenses.put(depRecord);
        await logAction({ patron_id: mainPatronId, boutique_id: activeBoutiqueId, user_id: currentUser.id, employe_id: currentUser.role === 'patron' ? null : currentUser.id, employe_nom: currentUser.role === 'patron' ? undefined : (currentUser.prenom || currentUser.nom), action_type: 'depense', description: `Dépense vocale ${depData.type}: ${depData.montant}F (${depData.description || 'Sans détail'}) par ${currentUser.nom}`, montant: depData.montant }).catch(console.error);
        await loadDatabase(); triggerPostActionPrompt();
      } else if (action.type === 'produit') {
        const quotaCheck = await checkCanAddProduct(patron);
        if (!quotaCheck.allowed) {
          const limitMsg =
            quotaCheck.message ||
            `Limite de produits atteinte pour votre abonnement (${quotaCheck.maxLimit}/${quotaCheck.maxLimit}). Supprimez un produit ou passez à un plan supérieur.`;
          showToastBottom(limitMsg);
          speakFrench(limitMsg);
          if (quotaCheck.plan !== 'pro') {
            handleOpenSubscriptionModal(quotaCheck.plan === 'essai' ? 'populaire' : 'pro', limitMsg);
          }
          return;
        }
        const prodData = action.data;
        const prodId = 'prod-vocal-' + Date.now();
        const prodRecord: Produit = { id: prodId, patron_id: mainPatronId || patron.id, boutique_id: activeBoutiqueId, nom: prodData.nom, photo_url: 'https://images.unsplash.com/photo-1578587018452-892bacefd3f2?auto=format&fit=crop&w=400&q=80', prix_achat: prodData.prix_achat, prix_vente: prodData.prix_vente, stock_qte: prodData.stock_qte, seuil_alerte: 5, created_at: new Date().toISOString() };
        if (typeof navigator !== 'undefined' && navigator.onLine) {
          try {
            const { error: prodErr, resolvedPatronId } = await upsertProduitSafely(prodRecord, patron);
            if (prodErr && String(prodErr?.message || '').includes('Limite de produits atteinte')) {
              showToastBottom(String(prodErr.message));
              speakFrench(String(prodErr.message));
              return;
            }
            prodRecord.patron_id = resolvedPatronId || patron.id;
          } catch {
            // ignore
          }
        }
        await db.produits.put(prodRecord);
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
              photo_url: newPatron.photo_url || newPatron.photo_profil,
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
        {bottomToast && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[99999] max-w-[92vw] w-full sm:w-auto animate-in fade-in slide-in-from-bottom-5 duration-300">
            <div className="px-5 py-3.5 rounded-2xl bg-amber-500 text-white font-black text-xs sm:text-sm shadow-2xl flex items-center gap-3 border border-amber-300/80 backdrop-blur-md">
              <span className="text-xl shrink-0">👑</span>
              <p className="flex-1 leading-snug">{bottomToast}</p>
              <button
                type="button"
                onClick={() => setBottomToast(null)}
                className="p-1 hover:bg-white/20 rounded-lg text-white font-black cursor-pointer shrink-0"
              >
                ✕
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (isPinLocked && !getIsPickingPhoto()) {
    return (
      <>
        <PinLockScreen patron={patron} employes={employes} currentUser={currentUser} onUnlock={handleUnlockPin} />
        {bottomToast && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[99999] max-w-[92vw] w-full sm:w-auto animate-in fade-in slide-in-from-bottom-5 duration-300">
            <div className="px-5 py-3.5 rounded-2xl bg-amber-500 text-white font-black text-xs sm:text-sm shadow-2xl flex items-center gap-3 border border-amber-300/80 backdrop-blur-md">
              <span className="text-xl shrink-0">👑</span>
              <p className="flex-1 leading-snug">{bottomToast}</p>
              <button
                type="button"
                onClick={() => setBottomToast(null)}
                className="p-1 hover:bg-white/20 rounded-lg text-white font-black cursor-pointer shrink-0"
              >
                ✕
              </button>
            </div>
          </div>
        )}
      </>
    );
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
        {bottomToast && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[99999] max-w-[92vw] w-full sm:w-auto animate-in fade-in slide-in-from-bottom-5 duration-300">
            <div className="px-5 py-3.5 rounded-2xl bg-amber-500 text-white font-black text-xs sm:text-sm shadow-2xl flex items-center gap-3 border border-amber-300/80 backdrop-blur-md">
              <span className="text-xl shrink-0">👑</span>
              <p className="flex-1 leading-snug">{bottomToast}</p>
              <button
                type="button"
                onClick={() => setBottomToast(null)}
                className="p-1 hover:bg-white/20 rounded-lg text-white font-black cursor-pointer shrink-0"
              >
                ✕
              </button>
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
          {activeTab === 'mes-ventes' && currentUser && <MesVentesScreen currentUser={currentUser} ventes={ventes} boutiqueId={getActiveBoutiqueId(patron)} onBack={() => setActiveTab('home')} />}
          {activeTab === 'mes-boutiques' && currentUser && currentUser.role === 'patron' && (
            <MesBoutiquesScreen
              patron={patron}
              onBack={() => setActiveTab('home')}
              onSelectStoreToView={(storeId) => {
                const targetStore = ownerStores.find((s) => s.id === storeId);
                if (targetStore) {
                  setDeviceStore(targetStore.id, targetStore.nom_boutique);
                  setDeviceStoreInfo(getDeviceStoreInfo());
                  localStorage.setItem('currentBoutiqueId', targetStore.id);
                  setProducts([]);
                  setEmployes([]);
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
            onPatronUpdated={(updated) => {
              setPatron(updated);
              if (updated.nom_boutique) {
                localStorage.setItem('currentBoutiqueName', updated.nom_boutique);
                if (localStorage.getItem('deviceStoreId')) {
                  localStorage.setItem('deviceStoreName', updated.nom_boutique);
                  setDeviceStoreInfo(getDeviceStoreInfo());
                }
              }
              if (currentUser?.role === 'patron') {
                setCurrentUser((prev) =>
                  prev
                    ? {
                        ...prev,
                        nom: updated.nom,
                        photo_url: updated.photo_url,
                        genre: updated.genre || prev.genre,
                      }
                    : prev
                );
              }
              syncEmployeesSubscription(updated.id, updated.subscription_status || 'trial').catch(console.error);
            }}
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
              localStorage.setItem('currentBoutiqueId', selected.id);
              setProducts([]);
              setEmployes([]);
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