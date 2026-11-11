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
import { getCurrentBoutiqueId, getActiveBoutiqueId, boutiqueToPatron } from './lib/deviceAuth';
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

          if (bDataRecord) {
            const rawPlan = (bDataRecord.plan || bDataRecord.forfait || '').toLowerCase().trim();
            const rawStatus = (bDataRecord.status || bDataRecord.statut || '').toLowerCase().trim();
            const subEndDate = bDataRecord.subscription_end_date || bDataRecord.subscription_end || bDataRecord.fin_abonnement;
            const isStatusActive = rawStatus === 'active' || rawStatus === 'actif' || rawStatus === '';
            const isPlanNotTrial = rawPlan !== 'trial' && rawPlan !== 'essai' && rawPlan !== 'free' && rawPlan !== '';
            const isPro = (isPlanNotTrial && isStatusActive) || rawPlan.includes('pro') || rawPlan.includes('populaire') || Number(bDataRecord.last_payment_amount) >= 50000;

            const converted = boutiqueToPatron(bDataRecord);
            if (currentPatron) {
              currentPatron = {
                ...currentPatron,
                ...converted,
                subscription_status: isPro ? 'pro' : converted.subscription_status,
                current_plan: isPro ? 'pro' : converted.current_plan,
                isProActive: isPro,
                statut: isStatusActive ? 'ACTIF' : currentPatron.statut,
                subscription_end_date: subEndDate || currentPatron.subscription_end_date,
                abonnement_expire: subEndDate || currentPatron.abonnement_expire,
                pin_code: currentPatron.pin_code || converted.pin_code,
                code_pin: currentPatron.code_pin || converted.code_pin,
              };
            } else {
              currentPatron = converted;
            }
            await db.patrons.put(currentPatron);
          } else {
            // Fallback table patrons: UNIQUEMENT pour nom/pin/solde, JAMAIS pour subscription_status !
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
                  solde: typeof remotePatron.solde === 'number' ? remotePatron.solde : (currentPatron.solde ?? 0),
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
                  solde: Number(remotePatron.solde) || 0,
                  abonnement_expire: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString(),
                  subscription_status: 'trial',
                  created_at: remotePatron.created_at || new Date().toISOString(),
                };
              }
              if (currentPatron) {
                await db.patrons.put(currentPatron);
              }
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

        // RÈGLE : Si PRO actif (lu depuis boutiques), ne JAMAIS forcer trial ni expiré !
        if (currentPatron.isProActive || currentPatron.subscription_status === 'pro') {
          currentPatron.subscription_status = 'pro';
          currentPatron.current_plan = 'pro';
          currentPatron.isProActive = true;
          currentPatron.statut = 'ACTIF';
        } else {
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
              if (parentBtq && (parentBtq.plan === 'pro' || Number(parentBtq.last_payment_amount) >= 50000 || isProActive(parentBtq as any))) {
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
                const isMainPro = mainSibling.plan === 'pro' || Number(mainSibling.last_payment_amount) >= 50000;
                if (isMainPro && mainSibling.id !== currentPatron.id) {
                  currentPatron.subscription_status = 'pro';
                  currentPatron.current_plan = 'pro';
                  currentPatron.isProActive = true;
                  currentPatron.type = 'SUB';
                  currentPatron.parentId = mainSibling.id;
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

            // Détermine le filtre Supabase par boutique active
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
              await db.produits.bulkPut(
                remoteProds.map((p) => ({
                  id: p.id,
                  boutique_id: currentBoutiqueId,
                  patron_id: currentPatron.id,
                  nom: p.nom,
                  prix_achat: Number(p.prix_achat) || 0,
                  prix_vente: Number(p.prix_vente) || 0,
                  stock_qte: Number(p.stock_qte) || 0,
                  seuil_alerte: Number(p.seuil_alerte) ?? 5,
                  categorie: p.categorie || 'Général',
                  photo_url: p.photo_url || '',
                  created_at: p.created_at || new Date().toISOString(),
                }))
              );
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
                  boutique_id: currentBoutiqueId,
                  patron_id: currentPatron.id,
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
            let fetchedVentesMap = new Map<string, any>();

            try {
              const { data: remoteVentes } = await supabase
                .from('ventes')
                .select('*')
                .or(btqFilter);
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
                .or(btqFilter);
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
              // Récupérer les ventes hors-ligne créées localement pas encore synchronisées
              const localUnsynced = await db.ventes
                .where('patron_id')
                .equals(currentPatron.id)
                .filter((v) => v.synced === false)
                .toArray();

              const listToSave: Vente[] = Array.from(fetchedVentesMap.values()).map((v) => ({
                id: v.id,
                ticket_id: v.ticket_id || v.id,
                patron_id: currentPatron.id,
                boutique_id: currentBoutiqueId,
                produit_id: v.produit_id || '',
                produit_nom: v.produit_nom || '',
                qte: Number(v.qte || v.quantite) || 1,
                montant_total: Number(v.montant_total || v.montant) || 0,
                client_nom: v.client_nom || '',
                est_credit: Boolean(v.est_credit),
                reste_a_payer: Number(v.reste_a_payer) || 0,
                status: v.status || 'active',
                is_deleted: Boolean(v.is_deleted),
                vendu_par_id: v.vendu_par_id || currentPatron.id,
                vendu_par_nom: v.vendu_par_nom || currentPatron.nom,
                vendu_par_genre: v.vendu_par_genre || 'femme',
                date: v.date || v.created_at || new Date().toISOString(),
                synced: true,
              }));

              await db.ventes.bulkPut(listToSave);
              // Ré-insérer les ventes locales non synchronisées
              if (localUnsynced.length > 0) {
                await db.ventes.bulkPut(localUnsynced);
              }
            }

            // E. Rechargement des dépenses depuis Supabase (sans effacer le cache local si Supabase est vide)
            const { data: remoteDep, error: depErr } = await supabase
              .from('depenses')
              .select('*')
              .or(btqFilter);
            if (!depErr && remoteDep && remoteDep.length > 0) {
              await db.depenses.bulkPut(
                remoteDep.map((d) => ({
                  id: d.id,
                  patron_id: currentPatron.id,
                  boutique_id: currentBoutiqueId,
                  type: d.type || 'autre',
                  montant: Number(d.montant) || 0,
                  description: d.description || '',
                  cree_par: d.cree_par || currentPatron.nom,
                  date: d.date || new Date().toISOString(),
                  synced: true,
                }))
              );
            }

            // F. Rechargement des crédits depuis Supabase (sans effacer le cache local si Supabase est vide)
            const { data: remoteCred, error: credErr } = await supabase
              .from('credits')
              .select('*')
              .or(btqFilter);
            if (!credErr && remoteCred && remoteCred.length > 0) {
              await db.credits.bulkPut(
                remoteCred.map((c) => ({
                  id: c.id,
                  sale_id: c.sale_id || '',
                  patron_id: currentPatron.id,
                  boutique_id: currentBoutiqueId,
                  client_nom: c.client_nom || '',
                  montant_initial: Number(c.montant_initial) || 0,
                  reste_a_payer: Number(c.reste_a_payer) || 0,
                  telephone: c.telephone || '',
                  dernier_paiement: c.dernier_paiement || new Date().toISOString(),
                  synced: true,
                }))
              );
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

        // Filtrage par boutique courante (currentBoutiqueId)
        const [empList, prodList, ventList, depList, credList, parrList] = await Promise.all([
          db.employes.filter((e) => e.boutique_id === currentBoutiqueId || e.patron_id === currentBoutiqueId).toArray(),
          db.produits.filter((p) => p.boutique_id === currentBoutiqueId || p.patron_id === currentBoutiqueId).toArray(),
          db.ventes.filter((v) => v.boutique_id === currentBoutiqueId || v.patron_id === currentBoutiqueId).toArray(),
          db.depenses.filter((d) => (d as any).boutique_id === currentBoutiqueId || d.patron_id === currentBoutiqueId).toArray(),
          db.credits.filter((c) => (c as any).boutique_id === currentBoutiqueId || c.patron_id === currentBoutiqueId).toArray(),
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

    try {
      if (action.type === 'vente') {
        const saleData = action.data;
        const saleId = 'vente-vocal-' + Date.now();
        const nowIso = new Date().toISOString();
        const saleRecord: Vente = { id: saleId, patron_id: patron.id, boutique_id: activeBoutiqueId, produit_id: saleData.produit_id, produit_nom: saleData.produit_nom, qte: saleData.qte, montant_total: saleData.montant_total, client_nom: saleData.client_nom, est_credit: saleData.est_credit, reste_a_payer: saleData.reste_a_payer, vendu_par_id: currentUser.id, vendu_par_nom: currentUser.nom, vendu_par_genre: currentUser.genre, date: nowIso, synced: true };

        const currentProd = products.find((p) => p.id === saleData.produit_id);
        const newStock = Math.max(0, (currentProd?.stock_qte ?? 0) - saleData.qte);

        if (typeof navigator !== 'undefined' && navigator.onLine) {
          try {
            await supabase.from('produits').update({ stock_qte: newStock }).eq('id', saleData.produit_id);
            await supabase.from('ventes').upsert([{ ...saleRecord, boutique_id: activeBoutiqueId }], { onConflict: 'id' });
            try {
              await supabase.from('transactions').upsert([{
                id: saleId,
                ticket_id: saleId,
                patron_id: patron.id,
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
              }], { onConflict: 'id' });
            } catch {
              // Ignore transaction mirror failure
            }
          } catch (vErr) {
            console.error('[VoiceSale] Erreur Supabase:', vErr);
          }
        }

        await db.ventes.put(saleRecord);
        if (currentProd) {
          await db.produits.update(currentProd.id, { stock_qte: newStock });
        }
        if (saleData.est_credit) {
          const creditId = 'credit-vocal-' + Date.now();
          const creditRecord: Credit = { id: creditId, patron_id: patron.id, boutique_id: activeBoutiqueId, client_nom: saleData.client_nom || 'Client crédit', montant_initial: saleData.montant_total, reste_a_payer: saleData.reste_a_payer, dernier_paiement: nowIso, synced: true };
          if (typeof navigator !== 'undefined' && navigator.onLine) {
            try {
              await supabase.from('credits').upsert([creditRecord], { onConflict: 'id' });
            } catch {
              // ignore
            }
          }
          await db.credits.put(creditRecord);
        }
        logAction({ patron_id: patron.id, boutique_id: activeBoutiqueId, user_id: currentUser.id, employe_id: currentUser.role === 'patron' ? null : currentUser.id, employe_nom: currentUser.role === 'patron' ? undefined : (currentUser.prenom || currentUser.nom), action_type: 'vente', description: `Vente vocale ${saleData.qte}x ${saleData.produit_nom} (${saleData.montant_total}F) par ${currentUser.role === 'patron' ? 'Patron' : (currentUser.prenom || currentUser.nom)}`, montant: saleData.montant_total }).catch(console.error);
        await loadDatabase(); triggerPostActionPrompt();
      } else if (action.type === 'depense') {
        const depData = action.data;
        const depId = 'dep-vocal-' + Date.now();
        const depRecord: Depense = { id: depId, patron_id: patron.id, boutique_id: activeBoutiqueId, type: depData.type, montant: depData.montant, description: depData.description, cree_par: currentUser.nom, date: new Date().toISOString(), synced: true };
        if (typeof navigator !== 'undefined' && navigator.onLine) {
          try {
            await supabase.from('depenses').upsert([depRecord], { onConflict: 'id' });
            try {
              await supabase.from('transactions').upsert([{
                id: depId,
                ticket_id: depId,
                patron_id: patron.id,
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
                date: depRecord.date,
              }], { onConflict: 'id' });
            } catch {}
          } catch {
            // ignore
          }
        }
        await db.depenses.put(depRecord);
        await loadDatabase(); triggerPostActionPrompt();
      } else if (action.type === 'produit') {
        const prodData = action.data;
        const prodId = 'prod-vocal-' + Date.now();
        const prodRecord: Produit = { id: prodId, patron_id: patron.id, boutique_id: activeBoutiqueId, nom: prodData.nom, photo_url: 'https://images.unsplash.com/photo-1578587018452-892bacefd3f2?auto=format&fit=crop&w=400&q=80', prix_achat: prodData.prix_achat, prix_vente: prodData.prix_vente, stock_qte: prodData.stock_qte, seuil_alerte: 5, created_at: new Date().toISOString() };
        if (typeof navigator !== 'undefined' && navigator.onLine) {
          try {
            await supabase.from('produits').insert([{
              id: prodId,
              patron_id: patron.id,
              boutique_id: activeBoutiqueId,
              nom: prodRecord.nom,
              prix_achat: prodRecord.prix_achat,
              prix_vente: prodRecord.prix_vente,
              stock_qte: prodRecord.stock_qte,
              seuil_alerte: 5,
              photo_url: prodRecord.photo_url,
              created_at: prodRecord.created_at,
            }]);
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