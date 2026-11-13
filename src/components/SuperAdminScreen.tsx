import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Shield,
  Store,
  User,
  KeyRound,
  Search,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  Calendar,
  RefreshCw,
  LogOut,
  Eye,
  EyeOff,
  Check,
  Trash2,
  MessageCircle,
  Phone,
  DollarSign,
  Lock,
  Unlock,
  Sparkles,
  ArrowLeft,
  Crown,
  Award,
  Gift,
  Users,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { db } from '../lib/db';
import {
  checkAndGiveReferralBonus,
  getTotalAnnualReferralsCount,
  getReferralsListCentral,
  type CentralReferralRow,
} from '../lib/ambassadeur';

export interface AdminBoutique {
  id: string;
  nom_personne: string;
  nom_boutique: string;
  patron_id?: string;
  pin_code: string;
  quartier?: string;
  telephone?: string;
  whatsapp_number?: string;
  status: 'actif' | 'bloque' | 'expire' | 'en_attente' | string;
  is_active: boolean;
  subscription_end?: string | null;
  plan?: string;
  last_payment_amount?: number;
  created_at?: string;
  source?: string;
  referral_code?: string;
  referred_by?: string | null;
  parrain_nom?: string;
  referral_bonus_given?: boolean;
  has_paid_annuel?: boolean;
  referrals_count?: number;
  bonus_days_earned?: number;
}

export interface PatronGroupInfo {
  isPrincipale: boolean;
  boutiqueIndex: number;
  totalInGroup: number;
  principale: AdminBoutique;
  isSubOfPro: boolean;
  subBadgeText: string;
}

function cleanDigits(phone?: string): string {
  if (!phone) return '';
  return phone.replace(/\D/g, '');
}

function cleanOwner(name?: string): string {
  if (!name) return '';
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function computeBoutiqueGroups(allBoutiques: AdminBoutique[]): Map<string, PatronGroupInfo> {
  const result = new Map<string, PatronGroupInfo>();
  const n = allBoutiques.length;
  if (n === 0) return result;

  const adj: number[][] = Array.from({ length: n }, () => []);

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = allBoutiques[i];
      const b = allBoutiques[j];

      // RÈGLE PARRAINAGE ABSOLUE : Une boutique parrainée (filleul) est 100% indépendante.
      // Elle ne doit JAMAIS devenir la 2ème boutique de son parrain !
      const refA = a.referred_by ? a.referred_by.toUpperCase() : '';
      const refB = b.referred_by ? b.referred_by.toUpperCase() : '';
      const codeA = a.referral_code ? a.referral_code.toUpperCase() : '';
      const codeB = b.referral_code ? b.referral_code.toUpperCase() : '';
      if ((refA && codeB && refA === codeB) || (refB && codeA && refB === codeA)) {
        continue;
      }

      let isSame = false;
      // 1. Même patron_id explicite de sous-boutique
      if (
        (a.patron_id && a.patron_id === b.id && a.id !== b.id) ||
        (b.patron_id && b.patron_id === a.id && b.id !== a.id) ||
        (a.patron_id && b.patron_id && a.patron_id === b.patron_id && a.patron_id !== a.id && b.patron_id !== b.id)
      ) {
        isSame = true;
      }

      // 2. Même téléphone / WhatsApp réel (au moins 8 chiffres identiques)
      if (!isSame) {
        const phoneA = cleanDigits(a.whatsapp_number || a.telephone);
        const phoneB = cleanDigits(b.whatsapp_number || b.telephone);
        if (phoneA.length >= 8 && phoneB.length >= 8 && phoneA.slice(-8) === phoneB.slice(-8)) {
          // Si l'un des deux est un filleul d'un autre code, ne pas fusionner
          if (!refA && !refB) {
            isSame = true;
          }
        }
      }

      // 3. Même propriétaire réel (au moins 3 caractères, JAMAIS sur le terme générique 'patron')
      if (!isSame) {
        const ownerA = cleanOwner(a.nom_personne);
        const ownerB = cleanOwner(b.nom_personne);
        const isGeneric = !ownerA || ['patron', 'proprietaire', 'admin', 'user', 'test', 'boutique'].includes(ownerA);
        if (!isGeneric && ownerA.length >= 3 && ownerA === ownerB && !refA && !refB) {
          const phoneA = cleanDigits(a.whatsapp_number || a.telephone);
          const phoneB = cleanDigits(b.whatsapp_number || b.telephone);
          if (phoneA.length >= 8 && phoneB.length >= 8 && phoneA.slice(-8) === phoneB.slice(-8)) {
            isSame = true;
          }
        }
      }

      if (isSame) {
        adj[i].push(j);
        adj[j].push(i);
      }
    }
  }

  const visited = new Set<number>();

  for (let i = 0; i < n; i++) {
    if (visited.has(i)) continue;

    const componentIndices: number[] = [];
    const queue = [i];
    visited.add(i);

    while (queue.length > 0) {
      const curr = queue.shift()!;
      componentIndices.push(curr);
      for (const neighbor of adj[curr]) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }

    const groupBoutiques = componentIndices.map((idx) => allBoutiques[idx]);

    // Boutique avec created_at la plus ancienne = Principale
    groupBoutiques.sort((x, y) => {
      const tX = x.created_at ? new Date(x.created_at).getTime() : 0;
      const tY = y.created_at ? new Date(y.created_at).getTime() : 0;
      if (tX !== tY) return tX - tY;
      return x.id.localeCompare(y.id);
    });

    const principale = groupBoutiques[0];
    const pPlan = (principale.plan || '').toLowerCase();
    const pAmt = Number(principale.last_payment_amount) || 0;
    const isPrincipalePro =
      !pPlan.includes('populaire') &&
      !pPlan.includes('prolonge') &&
      !pPlan.includes('16500') &&
      (pPlan === 'pro' || pPlan.startsWith('pro_') || (pPlan.includes('pro') && !pPlan.includes('prolonge')) || pAmt >= 50000);

    groupBoutiques.forEach((btq, index) => {
      const boutiqueIndex = index + 1;
      const isPrincipale = boutiqueIndex === 1;
      const isSubOfPro = !isPrincipale && isPrincipalePro;
      const subBadgeText = `Boutique ${boutiqueIndex} - Incluse PRO Principale`;

      result.set(btq.id, {
        isPrincipale,
        boutiqueIndex,
        totalInGroup: groupBoutiques.length,
        principale,
        isSubOfPro,
        subBadgeText,
      });
    });
  }

  return result;
}

interface SuperAdminScreenProps {
  onNavigateToClient?: () => void;
}

export const SuperAdminScreen: React.FC<SuperAdminScreenProps> = ({ onNavigateToClient }) => {
  // 1. Authentification Super Admin
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('efa_super_admin_logged') === 'true';
    }
    return false;
  });

  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // 2. Données Dashboard
  const [activeView, setActiveView] = useState<'boutiques' | 'referrals'>('boutiques');
  const [boutiques, setBoutiques] = useState<AdminBoutique[]>([]);
  const [referrals, setReferrals] = useState<CentralReferralRow[]>([]);
  const [isLoadingReferrals, setIsLoadingReferrals] = useState(false);
  const [referralsSearch, setReferralsSearch] = useState('');
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'actif' | 'expire' | 'bloque'>('all');
  const [annualReferralsCount, setAnnualReferralsCount] = useState<number>(0);

  // Visibilité des PINs par boutique
  const [visiblePins, setVisiblePins] = useState<Record<string, boolean>>({});

  // Toast notification
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  // Modal Prolongation personnalisée
  const [prolongModal, setProlongModal] = useState<{
    isOpen: boolean;
    boutique: AdminBoutique | null;
    days: number;
  }>({
    isOpen: false,
    boutique: null,
    days: 30,
  });

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const loadReferrals = async () => {
    setIsLoadingReferrals(true);
    try {
      const list = await getReferralsListCentral();
      setReferrals(list);
    } catch (e) {
      console.warn('[SUPER ADMIN] Erreur chargement referrals:', e);
    } finally {
      setIsLoadingReferrals(false);
    }
  };

  const handleValidateReferralBonus = async (ref: CentralReferralRow) => {
    if (!ref.filleul_id || ref.filleul_id.startsWith('btq_sub_')) {
      showToast('Le bonus parrainage ne s’applique qu’au patron principal.', 'error');
      return;
    }
    try {
      const res = await checkAndGiveReferralBonus({
        id: ref.filleul_id,
        nom_boutique: ref.filleul_nom,
        plan: ref.filleul_plan || 'pro_annuel',
        duration_days: 365,
        last_payment_amount: 90000,
        referred_by: ref.parrain_code || ref.parrain_id,
      });

      if (res.success) {
        showToast(
          `Bonus +60 jours validé pour le parrain (${ref.parrain_nom || 'Parrain'}) ! (Filleul paye 11 mois / 12)`,
          'success'
        );
        await Promise.all([loadBoutiques(), loadReferrals()]);
      } else {
        showToast(res.reason || 'Impossible de valider le bonus', 'error');
      }
    } catch (err: any) {
      showToast(err?.message || 'Erreur validation bonus', 'error');
    }
  };

  const adminFetch = (url: string, options: RequestInit = {}) => {
    const token = typeof window !== 'undefined' ? (localStorage.getItem('efa_admin_token') || '') : '';
    const headers = new Headers(options.headers || {});
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
      headers.set('x-admin-token', token);
    }
    return fetch(url, { ...options, headers });
  };

  useEffect(() => {
    // Vérification de validité de la session locale sans appel 404
    const token = typeof window !== 'undefined' ? localStorage.getItem('efa_admin_token') : null;
    if (isAuthenticated && !token) {
      handleLogout();
    }
  }, [isAuthenticated]);

  // Numéro WhatsApp Super Admin depuis variable d'environnement ou fallback
  const whatsappNumber =
    import.meta.env.VITE_WHATSAPP_NUMBER ||
    (typeof process !== 'undefined' && process.env?.WHATSAPP_NUMBER) ||
    '22896100972';

  // ============================================================================
  // LOGIQUE AUTHENTIFICATION SUPER ADMIN SÉPARÉE ET SÉCURISÉE
  // ============================================================================
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    setLoginError(null);

    const emailInput = adminEmail.trim().toLowerCase();
    const passwordInput = adminPassword.trim();

    try {
      const resp = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailInput, password: passwordInput }),
      });
      const data = await resp.json();
      if (resp.ok && (data.token || data.success)) {
        const token = data.token || 'admin_token';
        localStorage.setItem('efa_admin_token', token);
        setIsAuthenticated(true);
        localStorage.setItem('efa_super_admin_logged', 'true');
        localStorage.setItem('efa_super_admin_email', emailInput);
        showToast('Connexion Super Admin réussie !', 'success');
        loadBoutiques();
        return;
      }
      setLoginError(data.error || 'Email ou mot de passe incorrect. Accès refusé.');
    } catch {
      setLoginError('Serveur de sécurité indisponible. Veuillez vérifier votre connexion.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    localStorage.removeItem('efa_super_admin_logged');
    localStorage.removeItem('efa_admin_token');
    localStorage.removeItem('efa_super_admin_email');
    showToast('Déconnexion effectuée', 'info');
  };

  // Helper pour formater les liens directs WhatsApp (wa.me)
  const formatWaLink = (num?: string): string => {
    if (!num) return '';
    const digits = num.replace(/\D/g, '');
    if (!digits) return '';
    const fullNumber = digits.length === 8 ? `228${digits}` : digits;
    return `https://wa.me/${fullNumber}`;
  };

  // Helper pour formater une ligne Supabase en AdminBoutique
  const formatBoutiqueRow = (row: any): AdminBoutique => {
    const subEnd = row.subscription_end || row.date_fin_essai || row.fin_abonnement || row.subscription_end_date || null;
    const now = new Date();
    const isExp = subEnd ? new Date(subEnd) < now : false;
    const status =
      row.is_active === false
        ? 'bloque'
        : isExp
        ? 'expire'
        : (row.status === 'bloque' ? 'bloque' : (row.status || 'actif'));

    const rawWhatsapp = (row.whatsapp_number || '').trim();
    const rawPhone = (row.telephone || row.email || '').trim();

    return {
      id: row.id,
      nom_personne: row.proprietaire || row.nom_patron || row.nom_personne || row.nom || 'Patron',
      nom_boutique: row.nom_boutique || row.nom_affichage || row.nom || 'Ma Boutique',
      patron_id: row.patron_id || row.id,
      pin_code: row.pin_code || row.code_pin || '----',
      quartier: row.quartier || row.adresse || '',
      telephone: rawPhone || rawWhatsapp,
      whatsapp_number: rawWhatsapp || rawPhone,
      status,
      is_active: row.is_active !== false,
      subscription_end: subEnd,
      plan: row.plan || row.forfait || 'essai',
      last_payment_amount: Number(row.last_payment_amount) || 0,
      created_at: row.created_at || new Date().toISOString(),
      source: 'boutiques',
      referral_code: row.referral_code,
      referred_by: row.referred_by || row.referred_by_code || null,
      referral_bonus_given: Boolean(row.referral_bonus_given),
      has_paid_annuel: Boolean(row.has_paid_annuel),
      referrals_count: Number(row.referrals_count) || 0,
      bonus_days_earned: Number(row.bonus_days_earned) || 0,
    };
  };

  const hasMigratedRef = useRef(false);

  // ============================================================================
  // RESTAURATION ANCIENS COMPTES VERS SUPABASE (ONCE ON LOAD)
  // ============================================================================
  const migrateLocalToSupabase = async (): Promise<number> => {
    let restoredCount = 0;
    try {
      console.log('[SuperAdmin Migration] Vérification des anciens comptes locaux...');
      const candidates: any[] = [];

      // 1. Lire localStorage efa_boutiques
      try {
        const raw = localStorage.getItem('efa_boutiques');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) candidates.push(...parsed);
          else if (typeof parsed === 'object' && parsed) candidates.push(parsed);
        }
      } catch (e) {}

      // 2. Lire localStorage boutiques
      try {
        const raw = localStorage.getItem('boutiques');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) candidates.push(...parsed);
          else if (typeof parsed === 'object' && parsed) candidates.push(parsed);
        }
      } catch (e) {}

      // 3. Lire localStorage efa_accounts
      try {
        const raw = localStorage.getItem('efa_accounts');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) candidates.push(...parsed);
          else if (typeof parsed === 'object' && parsed) candidates.push(parsed);
        }
      } catch (e) {}

      // 4. Lire localStorage patron ou efa_device_boutique
      try {
        const raw = localStorage.getItem('efa_device_boutique') || localStorage.getItem('patron');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') {
            if (Array.isArray(parsed)) candidates.push(...parsed);
            else if (parsed.id) candidates.push(parsed);
          }
        }
      } catch (e) {}

      // 5. Lire Dexie local (db.patrons)
      try {
        const dexiePatrons = await db.patrons.toArray();
        if (Array.isArray(dexiePatrons)) candidates.push(...dexiePatrons);
      } catch (e) {}

      if (candidates.length === 0) {
        console.log('[SuperAdmin Migration] Aucun ancien compte local trouvé.');
        return 0;
      }

      // Dédoublonnage par identifiant
      const uniqueMap = new Map<string, any>();
      for (const item of candidates) {
        if (!item) continue;
        const id = item.id || ('btq_' + (item.nom_boutique || item.nom_affichage || item.nom || 'legacy').toLowerCase().replace(/[^a-z0-9]/g, '_'));
        if (!uniqueMap.has(id)) {
          uniqueMap.set(id, { ...item, id });
        }
      }

      console.log(`[SuperAdmin Migration] ${uniqueMap.size} compte(s) candidat(s) à la restauration.`);

      for (const item of uniqueMap.values()) {
        const nowIso = new Date().toISOString();
        const subEnd = item.subscription_end || item.subscription_end_date || item.date_fin_essai || item.fin_abonnement || item.abonnement_expire || nowIso;
        const nomBoutique = item.nom_boutique || item.nom_affichage || item.nom || 'Boutique EFA';
        const proprietaire = item.proprietaire || item.nom_patron || item.nom || 'Patron';

        const whatsappVal = (item.whatsapp_number || item.whatsapp || item.telephone || item.phone || '').trim();
        const phoneVal = (item.telephone || item.phone || whatsappVal).trim();

        // Exact columns list: id, nom_boutique, nom, proprietaire, patron_id, email, telephone, referral_code, referred_by_code, referred_by, subscription_end_date, subscription_end, has_paid_annuel, is_active, last_payment_amount, plan, status, created_at, updated_at, pin_code, whatsapp_number, whatsapp
        const row = {
          id: item.id,
          nom_boutique: nomBoutique,
          nom: nomBoutique,
          proprietaire: proprietaire,
          patron_id: item.id,
          email: item.email || '',
          telephone: phoneVal,
          whatsapp_number: whatsappVal,
          whatsapp: whatsappVal,
          pin_code: item.pin_code || item.code_pin || '0000',
          referral_code: item.referral_code || null,
          referred_by_code: item.referred_by_code || item.referred_by || null,
          referred_by: item.referred_by || item.referred_by_code || null,
          plan: item.plan || item.forfait || 'essai',
          status: item.status || (item.is_active === false ? 'bloque' : 'active'),
          is_active: item.is_active !== false,
          has_paid_annuel: Boolean(item.has_paid_annuel),
          subscription_end_date: subEnd,
          subscription_end: subEnd,
          last_payment_amount: Number(item.last_payment_amount) || Number(item.prix) || 0,
          created_at: item.created_at || nowIso,
          updated_at: nowIso,
        };

        const { error: insErr } = await supabase
          .from('boutiques')
          .upsert(row, { onConflict: 'id', ignoreDuplicates: true });

        if (!insErr) {
          restoredCount++;
          try {
            await supabase.from('profiles').upsert({
              id: row.id,
              user_id: row.id,
              nom: row.proprietaire,
              nom_boutique: row.nom_boutique,
              telephone: row.telephone,
              referral_code: row.referral_code,
              referred_by_code: row.referred_by_code,
              subscription_end_date: row.subscription_end_date,
              created_at: row.created_at,
            }, { onConflict: 'id', ignoreDuplicates: true });
          } catch {}
        } else {
          console.warn('[SuperAdmin Migration] Note insertion compte:', item.id, insErr);
        }
      }

      console.log(`[SuperAdmin Migration] Terminé : ${restoredCount} ancien(s) compte(s) restauré(s).`);
    } catch (migrErr) {
      console.error('[SuperAdmin Migration] Erreur migration:', migrErr);
    }
    return restoredCount;
  };

  // ============================================================================
  // CHARGEMENT CENTRALISÉ DES BOUTIQUES DEPUIS SUPABASE (SANS FILTRE USER_ID)
  // ============================================================================
  const loadBoutiques = async () => {
    setIsLoadingData(true);
    try {
      // Requête unique centrale sur la table Supabase 'boutiques' (SANS AUCUN FILTRE USER_ID)
      const { data: centralData, error: centralErr } = await supabase
        .from('boutiques')
        .select('*')
        .order('created_at', { ascending: false });

      console.log('SUPER ADMIN FETCH', centralData, centralErr);

      if (centralErr) {
        console.error('[SUPER ADMIN] ERREUR FETCH BOUTIQUES:', centralErr);
      }

      // Charger également la table referrals pour synchroniser parrainages et bonus
      let centralReferrals: any[] = [];
      try {
        const { data: refData } = await supabase.from('referrals').select('*');
        if (refData && Array.isArray(refData)) centralReferrals = refData;
      } catch (e) {
        console.warn('[SUPER ADMIN] Note lecture referrals:', e);
      }

      const list: AdminBoutique[] = (centralData || []).map((row: any) => formatBoutiqueRow(row));

      console.log('SUPER ADMIN TOTAL BOUTIQUES REÇUES:', list.length);

      const codeToName = new Map<string, string>();
      for (const item of list) {
        if (item.referral_code) {
          codeToName.set(item.referral_code.toUpperCase(), item.nom_boutique || item.nom_personne);
        }
      }
      for (const item of list) {
        if (item.referred_by) {
          item.parrain_nom = codeToName.get(item.referred_by.toUpperCase());
        }
      }

      // CALCUL DES PARRAINAGES EFFECTUÉS & BONUS REÇUS POUR CHAQUE BOUTIQUE
      for (const item of list) {
        const myCode = item.referral_code ? item.referral_code.toUpperCase() : null;

        // Filleuls parrainés par cette boutique
        const filleulsFromBoutiques = list.filter((other) => {
          if (other.id === item.id) return false;
          const otherRef = other.referred_by ? other.referred_by.toUpperCase() : '';
          return Boolean(myCode && otherRef === myCode);
        });

        const filleulsFromReferralsTable = centralReferrals.filter(
          (r) =>
            (myCode && r.parrain_code && r.parrain_code.toUpperCase() === myCode) ||
            r.parrain_id === item.id
        );

        // Ensemble unique de filleuls (parrainages effectués)
        const uniqueFilleulIds = new Set<string>();
        filleulsFromBoutiques.forEach((f) => uniqueFilleulIds.add(f.id));
        filleulsFromReferralsTable.forEach((r) => uniqueFilleulIds.add(r.filleul_id));
        item.referrals_count = uniqueFilleulIds.size;

        // Filleuls ayant validé leur 1 AN (donnant droit à +60j de bonus)
        const annualFilleulIds = new Set<string>();
        for (const f of filleulsFromBoutiques) {
          const plan = (f.plan || '').toLowerCase();
          const amt = Number(f.last_payment_amount) || 0;
          if (
            !plan.includes('6mois') &&
            !plan.includes('prolonge') &&
            (f.has_paid_annuel || amt === 90000 || amt === 16500 || plan.includes('annuel'))
          ) {
            annualFilleulIds.add(f.id);
          }
        }
        for (const r of filleulsFromReferralsTable) {
          if (r.status === 'paid' || r.reward_given === true) {
            annualFilleulIds.add(r.filleul_id);
          }
        }

        item.bonus_days_earned = annualFilleulIds.size * 60;

        // Statut Bonus Reçu pour cette boutique elle-même (en tant que filleul)
        if (item.referred_by) {
          const itemPlan = (item.plan || '').toLowerCase();
          const itemAmt = Number(item.last_payment_amount) || 0;
          const isAnnualPayment =
            Boolean(item.has_paid_annuel) ||
            (!itemPlan.includes('6mois') &&
              !itemPlan.includes('prolonge') &&
              (itemAmt === 90000 || itemAmt === 16500 || itemPlan.includes('annuel')));
          const isRewardedInTable = centralReferrals.some(
            (r) => r.filleul_id === item.id && (r.status === 'paid' || r.reward_given === true)
          );
          item.referral_bonus_given = isAnnualPayment || isRewardedInTable;
        } else {
          item.referral_bonus_given = false;
        }
      }

      setBoutiques(list);
      getTotalAnnualReferralsCount().then(setAnnualReferralsCount).catch(() => {});
    } catch (err: any) {
      console.error('[SUPER ADMIN] Erreur loadBoutiques:', err);
      showToast('Erreur lors du chargement des boutiques', 'error');
    } finally {
      setIsLoadingData(false);
    }
  };

  // ============================================================================
  // ABONNEMENT REAL-TIME SUPABASE POUR APPARITION INSTANTANÉE SUR TOUS LES APPAREILS
  // ============================================================================
  useEffect(() => {
    if (!isAuthenticated) return;

    const initSuperAdmin = async () => {
      if (!hasMigratedRef.current) {
        hasMigratedRef.current = true;
        const restored = await migrateLocalToSupabase();
        if (restored > 0) {
          showToast(`✅ ${restored} ancien(s) compte(s) restauré(s) dans Supabase !`, 'success');
        }
      }
      await loadBoutiques();
      await loadReferrals();
    };

    initSuperAdmin();

    const channel = supabase
      .channel('boutiques_realtime_changes')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'boutiques' },
        (payload) => {
          console.log('[REALTIME] Nouvelle boutique insérée:', payload.new);
          if (payload.new) {
            const newRow = formatBoutiqueRow(payload.new);
            setBoutiques((prev) => {
              if (prev.some((b) => b.id === newRow.id)) return prev;
              return [newRow, ...prev];
            });
            showToast(`Nouvelle boutique connectée : ${newRow.nom_boutique} !`, 'info');
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'profiles' },
        (payload) => {
          console.log('[REALTIME] Nouveau profile inséré:', payload.new);
          loadBoutiques();
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'boutiques' },
        (payload) => {
          console.log('[REALTIME] Boutique mise à jour:', payload.new);
          if (payload.new) {
            const updatedRow = formatBoutiqueRow(payload.new);
            setBoutiques((prev) =>
              prev.map((b) => (b.id === updatedRow.id ? { ...b, ...updatedRow } : b))
            );
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'boutiques' },
        (payload) => {
          console.log('[REALTIME] Boutique supprimée:', payload.old);
          if (payload.old?.id) {
            setBoutiques((prev) => prev.filter((b) => b.id !== payload.old.id));
          }
        }
      )
      .subscribe();

    // Abonnements Realtime sur les tables 'referrals' et 'parrainage'
    const referralsChannel = supabase
      .channel('referrals_realtime_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'referrals' },
        (payload) => {
          console.log('[REALTIME REFERRALS] Changement détecté:', payload);
          loadReferrals();
          getTotalAnnualReferralsCount().then(setAnnualReferralsCount).catch(() => {});
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'parrainage' },
        (payload) => {
          console.log('[REALTIME PARRAINAGE] Changement détecté:', payload);
          loadReferrals();
          getTotalAnnualReferralsCount().then(setAnnualReferralsCount).catch(() => {});
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      supabase.removeChannel(referralsChannel);
    };
  }, [isAuthenticated]);

  // ============================================================================
  // ACTIONS SUPER ADMIN SUR LES BOUTIQUES
  // ============================================================================

  // Helper badge pour l'affichage du plan dans le tableau
  const getPlanBadge = (b: AdminBoutique, groupInfo?: PatronGroupInfo) => {
    // RÈGLE SUPER ADMIN : Sur les boutiques secondaires, effacer complètement le badge "ESSAI 21J"
    // Elles bénéficient du PRO principal et ne sont pas en essai.
    if (groupInfo && (!groupInfo.isPrincipale || groupInfo.isSubOfPro)) {
      return null;
    }
    const p = (b.plan || '').toLowerCase();
    const amt = b.last_payment_amount || 0;
    if (p.includes('populaire') || amt === 16500) {
      return { label: 'POPULAIRE 1 AN - 16.5K', className: 'bg-yellow-400 text-slate-950 font-black border border-amber-500 shadow-xs' };
    }
    if (p.includes('prolonge')) {
      return { label: 'POPULAIRE PROLONGÉ 30J', className: 'bg-amber-500 text-slate-950 font-black shadow-xs' };
    }
    if (!p.includes('prolonge') && (p.includes('pro_annuel') || p.includes('pro 1 an') || (p.includes('pro') && amt === 90000))) {
      return { label: 'PRO 1 AN - 90K', className: 'bg-blue-600 text-white shadow-xs font-black' };
    }
    if (!p.includes('prolonge') && (p.includes('pro_6mois') || p.includes('pro 6 mois') || (p.includes('pro') && amt === 50000))) {
      return { label: 'PRO 6 MOIS - 50K', className: 'bg-purple-600 text-white shadow-xs font-black' };
    }
    if (p === 'pro') {
      return { label: 'BOUTIQUE PRO', className: 'bg-blue-600 text-white shadow-xs font-black' };
    }
    return { label: 'ESSAI 21J', className: 'bg-slate-100 text-slate-700 font-bold border border-slate-300' };
  };

  // Action : Activer (Pro 1 An 90K, Pro 6 Mois 50K, Populaire 1 An 16.5K)
  const handleActivateBoutique = async (
    boutique: AdminBoutique,
    durationDays: number,
    amount: number,
    planLabel: string,
    planCode: string = 'pro'
  ) => {
    const expiryDate = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();
    const normalizedCode = planCode.toLowerCase().trim();
    const isProCode =
      (normalizedCode === 'pro' || normalizedCode.startsWith('pro_')) &&
      !normalizedCode.includes('prolonge') &&
      !normalizedCode.includes('populaire');
    const targetStatus = isProCode ? 'pro' : 'populaire';

    try {
      // 1. Tenter par l'API backend sécurisée
      try {
        await adminFetch('/api/admin/boutiques/activate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            boutique_id: boutique.id,
            duration_days: durationDays,
            plan: planCode,
            amount,
          }),
        });
      } catch {}

      const isAnnuel = durationDays >= 360 || planCode.includes('annuel') || amount === 90000 || amount === 16500;
      const paymentId = 'pay_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);
      const subId = 'sub_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);
      const nowIso = new Date().toISOString();

      // 1. INSERT dans 'payments'
      try {
        await supabase.from('payments').insert({
          id: paymentId,
          boutique_id: boutique.id,
          patron_id: boutique.id,
          amount,
          montant: amount,
          plan: planCode,
          status: 'completed',
          payment_method: 'admin_manual',
          created_at: nowIso,
        });
      } catch (payErr) {
        console.warn('[SUPER ADMIN] Note insert payments:', payErr);
      }

      // 2. INSERT dans 'subscriptions'
      try {
        await supabase.from('subscriptions').insert({
          id: subId,
          boutique_id: boutique.id,
          patron_id: boutique.id,
          plan: planCode,
          status: 'active',
          expires_at: expiryDate,
          subscription_end_date: expiryDate,
          created_at: nowIso,
          updated_at: nowIso,
        });
      } catch (subErr) {
        console.warn('[SUPER ADMIN] Note insert subscriptions:', subErr);
      }

      // 3. UPDATE boutiques SET subscription_end_date, subscription_end, has_paid_annuel, plan, status, is_active, last_payment_amount, updated_at
      await supabase
        .from('boutiques')
        .update({
          subscription_end_date: expiryDate,
          subscription_end: expiryDate,
          has_paid_annuel: isAnnuel ? true : Boolean(boutique.has_paid_annuel),
          plan: planCode,
          status: 'active',
          is_active: true,
          last_payment_amount: amount,
          updated_at: nowIso,
        })
        .eq('id', boutique.id);

      try {
        await supabase
          .from('profiles')
          .update({
            subscription_end_date: expiryDate,
          })
          .eq('id', boutique.id);
      } catch (e) {}

      await supabase
        .from('patrons')
        .update({
          plan: planCode,
          forfait: planCode,
          subscription_status: targetStatus,
          subscription_end_date: expiryDate,
          subscription_end: expiryDate,
          abonnement_expire: expiryDate,
          fin_abonnement: expiryDate,
          statut: 'ACTIF',
          prix: amount,
          is_active: true,
          last_payment_amount: amount,
        } as any)
        .eq('id', boutique.id);

      // 4. Mettre à jour immédiatement le state local React
      setBoutiques((prev) =>
        prev.map((item) =>
          item.id === boutique.id
            ? {
                ...item,
                subscription_end: expiryDate,
                status: 'actif',
                is_active: true,
                plan: planCode,
                last_payment_amount: amount,
              }
            : item
        )
      );

      showToast(
        `✅ ${boutique.nom_boutique} activée : ${planLabel} (${amount.toLocaleString('fr-FR')} F) !`,
        'success'
      );

      // 5. RÈGLE D'OR AMBASSADEUR : Bonus +60 jours UNIQUEMENT si forfait ANNUEL et PATRON PRINCIPAL (1 seule fois)
      // (Boutique Pro 1 An - 90.000F ou Populaire 1 An - 16.500F)
      const isMainPatronAccount =
        !boutique.id.startsWith('btq_sub_') &&
        (!boutique.patron_id || boutique.patron_id === boutique.id);
      if (isMainPatronAccount && (durationDays >= 365 || planCode === 'pro_annuel' || planCode === 'boutique_pro_annuel' || (planCode === 'populaire' && amount === 16500))) {
        try {
          const bonusRes = await checkAndGiveReferralBonus({
            ...boutique,
            plan: planCode,
            last_payment_amount: amount,
            duration_days: durationDays,
          });
          if (bonusRes.success && bonusRes.parrainNom) {
            setTimeout(() => {
              showToast(
                `🎉 Bonus Ambassadeur : +60j offerts à ${bonusRes.parrainNom} car ${boutique.nom_boutique} a pris 1 AN !`,
                'success'
              );
            }, 1200);
          }
        } catch (bonusErr) {
          console.warn('[SUPER ADMIN] Erreur bonus ambassadeur:', bonusErr);
        }
      }

      await loadBoutiques();
    } catch (err: any) {
      console.error('[SUPER ADMIN] Erreur activation:', err);
      showToast("Erreur lors de l'activation", 'error');
    }
  };

  // Action : Bloquer / Débloquer
  const handleToggleBlockBoutique = async (boutique: AdminBoutique) => {
    const newActiveState = !boutique.is_active;
    try {
      try {
        await adminFetch('/api/admin/boutiques/toggle-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ boutique_id: boutique.id, is_active: newActiveState }),
        });
      } catch {}

      await supabase.from('boutiques').update({ is_active: newActiveState, status: newActiveState ? 'active' : 'bloque', updated_at: new Date().toISOString() }).eq('id', boutique.id);
      await supabase.from('patrons').update({ is_active: newActiveState }).eq('id', boutique.id);

      showToast(
        newActiveState
          ? `Boutique ${boutique.nom_boutique} débloquée`
          : `Boutique ${boutique.nom_boutique} bloquée`,
        'info'
      );
      await loadBoutiques();
    } catch (err: any) {
      showToast('Erreur lors du changement de statut', 'error');
    }
  };

  // Action : Prolonger (+30 jours par défaut)
  const handleProlonger = async (boutique: AdminBoutique, daysToAdd: number = 30) => {
    try {
      const now = new Date();
      let ancienneDateFin: Date;
      if (boutique.subscription_end) {
        ancienneDateFin = new Date(boutique.subscription_end);
        if (isNaN(ancienneDateFin.getTime())) ancienneDateFin = now;
      } else {
        ancienneDateFin = now;
      }

      const baseDate = ancienneDateFin > now ? ancienneDateFin : now;
      const nouvelleDate = new Date(baseDate.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
      const nouvelleDateIso = nouvelleDate.toISOString();
      const dateFrFormatted = nouvelleDate.toLocaleDateString('fr-FR');

      console.log("Prolongation OK", nouvelleDate);

      const existingPlanLower = (boutique.plan || '').toLowerCase().trim();
      const isExistingPro =
        !existingPlanLower.includes('populaire') &&
        !existingPlanLower.includes('prolonge') &&
        !existingPlanLower.includes('16500') &&
        (existingPlanLower === 'pro' ||
          existingPlanLower.startsWith('pro_') ||
          (Number(boutique.last_payment_amount) || 0) >= 50000);
      const preservedPlan = isExistingPro ? (boutique.plan || 'pro') : 'populaire';
      const preservedStatus = isExistingPro ? 'pro' : 'populaire';

      // 1. Update Supabase table boutiques (exact columns only — ne jamais transformer Populaire/Essai en PRO)
      try {
        await supabase
          .from('boutiques')
          .update({
            subscription_end_date: nouvelleDateIso,
            subscription_end: nouvelleDateIso,
            is_active: true,
            status: 'active',
            plan: preservedPlan,
            updated_at: now.toISOString(),
          })
          .eq('id', boutique.id);
      } catch (errB) {}

      // 2. Update Supabase table patrons
      try {
        await supabase
          .from('patrons')
          .update({
            fin_abonnement: nouvelleDateIso,
            subscription_end_date: nouvelleDateIso,
            abonnement_expire: nouvelleDateIso,
            statut: 'ACTIF',
            is_active: true,
            plan: preservedPlan,
            forfait: preservedPlan,
            subscription_status: preservedStatus,
          } as any)
          .eq('id', boutique.id);
      } catch (errP) {}

      // 4. Update Backend API
      try {
        await adminFetch('/api/admin/boutiques/prolong', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            boutique_id: boutique.id,
            add_days: daysToAdd,
            new_end_date: nouvelleDateIso,
          }),
        });
      } catch {}

      // 5. Mise à jour immédiate du state local React (FIN ABONNEMENT et jours restants changent direct)
      setBoutiques((prev) =>
        prev.map((item) =>
          item.id === boutique.id
            ? {
                ...item,
                subscription_end: nouvelleDateIso,
                status: 'actif',
                is_active: true,
                plan: preservedPlan,
              }
            : item
        )
      );

      setProlongModal({ isOpen: false, boutique: null, days: 30 });

      // 6. Toast obligatoire
      showToast(`Prolongé de ${daysToAdd} jours - Nouvelle fin : ${dateFrFormatted}`, 'success');

      // 7. Recharger la liste depuis la base
      await loadBoutiques();
    } catch (err: any) {
      console.error('[SUPER ADMIN] Erreur prolongation:', err);
      showToast('Erreur lors de la prolongation', 'error');
    }
  };

  const handleProlongBoutique = handleProlonger;
  const prolongerAbonnement = handleProlonger;

  // Action : Supprimer
  const handleDeleteBoutique = async (boutique: AdminBoutique) => {
    if (
      !confirm(
        `ATTENTION SUPER ADMIN : Voulez-vous vraiment supprimer définitivement la boutique "${boutique.nom_boutique}" ? Toutes ses données seront effacées.`
      )
    ) {
      return;
    }

    try {
      try {
        await adminFetch(`/api/admin/boutiques/${boutique.id}`, { method: 'DELETE' });
      } catch {}

      await supabase.from('boutiques').delete().eq('id', boutique.id);
      await supabase.from('patrons').delete().eq('id', boutique.id);

      showToast(`Boutique "${boutique.nom_boutique}" supprimée définitivement`, 'info');
      await loadBoutiques();
    } catch (err: any) {
      showToast('Erreur lors de la suppression', 'error');
    }
  };

  // Basculer l'affichage du PIN
  const togglePinVisibility = (id: string) => {
    setVisiblePins((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // ============================================================================
  // CALCUL DES STATS & FILTRES
  // ============================================================================
  const stats = useMemo(() => {
    const total = boutiques.length;
    const now = new Date();
    const actives = boutiques.filter((b) => {
      if (!b.is_active || b.status === 'bloque') return false;
      if (!b.subscription_end) return true;
      return new Date(b.subscription_end) >= now;
    }).length;

    const expirees = boutiques.filter((b) => {
      if (b.status === 'expire') return true;
      if (b.subscription_end && new Date(b.subscription_end) < now) return true;
      return false;
    }).length;

    const revenuTotal = boutiques.reduce((sum, b) => sum + (Number(b.last_payment_amount) || 0), 0);

    return { total, actives, expirees, revenuTotal };
  }, [boutiques]);

  const boutiqueGroupsMap = useMemo(() => {
    return computeBoutiqueGroups(boutiques);
  }, [boutiques]);

  const filteredBoutiques = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const now = new Date();

    return boutiques.filter((b) => {
      // Filtre statut
      if (statusFilter === 'actif') {
        const isExp = b.subscription_end ? new Date(b.subscription_end) < now : false;
        if (!b.is_active || b.status === 'bloque' || isExp) return false;
      } else if (statusFilter === 'expire') {
        const isExp = b.subscription_end ? new Date(b.subscription_end) < now : false;
        if (!isExp && b.status !== 'expire') return false;
      } else if (statusFilter === 'bloque') {
        if (b.is_active && b.status !== 'bloque') return false;
      }

      // Filtre recherche
      if (!q) return true;
      const matchNom = (b.nom_personne || '').toLowerCase().includes(q);
      const matchBoutique = (b.nom_boutique || '').toLowerCase().includes(q);
      const matchQuartier = (b.quartier || '').toLowerCase().includes(q);
      const matchPhone = (b.telephone || '').toLowerCase().includes(q) || (b.whatsapp_number || '').toLowerCase().includes(q);
      const matchPin = (b.pin_code || '').includes(q);

      return matchNom || matchBoutique || matchQuartier || matchPhone || matchPin;
    });
  }, [boutiques, searchQuery, statusFilter]);

  const filteredReferrals = useMemo(() => {
    const q = referralsSearch.trim().toLowerCase();
    if (!q) return referrals;
    return referrals.filter((r) => {
      const pNom = (r.parrain_nom || '').toLowerCase();
      const pCode = (r.parrain_code || '').toLowerCase();
      const fNom = (r.filleul_nom || '').toLowerCase();
      const fCode = (r.filleul_code || '').toLowerCase();
      const st = (r.status || '').toLowerCase();
      return pNom.includes(q) || pCode.includes(q) || fNom.includes(q) || fCode.includes(q) || st.includes(q);
    });
  }, [referrals, referralsSearch]);

  // ============================================================================
  // RENDU 1 : FORMULAIRE DE CONNEXION SUPER ADMIN (SI NON CONNECTÉ)
  // ============================================================================
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 text-white flex flex-col justify-center items-center p-4 select-none">
        {/* Toast */}
        {toast && (
          <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50">
            <div
              className={`px-5 py-3 rounded-2xl shadow-2xl text-sm font-black flex items-center gap-2 ${
                toast.type === 'success'
                  ? 'bg-emerald-600 text-white'
                  : toast.type === 'error'
                  ? 'bg-rose-600 text-white'
                  : 'bg-blue-600 text-white'
              }`}
            >
              <span>{toast.message}</span>
            </div>
          </div>
        )}

        <div className="w-full max-w-md bg-white/10 backdrop-blur-xl border border-white/20 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6">
          {/* Logo et titre */}
          <div className="text-center space-y-2">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-amber-500 to-amber-300 mx-auto flex items-center justify-center text-slate-950 shadow-lg">
              <Shield className="w-9 h-9 stroke-[2.5]" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
              SUPER ADMIN
            </h1>
            <p className="text-xs sm:text-sm font-bold text-amber-300 uppercase tracking-widest">
              EFA ACONTA • DIRECTION EFA TECH
            </p>
            <p className="text-xs text-slate-300">
              Accès confidentiel réservé aux administrateurs.
            </p>
          </div>

          {/* Message d'erreur */}
          {loginError && (
            <div className="p-3.5 rounded-2xl bg-rose-500/20 border border-rose-500/50 text-rose-200 text-xs sm:text-sm font-black flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 shrink-0 text-rose-400" />
              <span>{loginError}</span>
            </div>
          )}

          {/* Formulaire Email + Mot de passe */}
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-black uppercase tracking-wider text-slate-300 mb-1.5">
                Email Super Admin :
              </label>
              <div className="relative">
                <input
                  type="email"
                  required
                  placeholder="admin@efa-aconta.com"
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value)}
                  className="w-full px-4 py-3.5 rounded-2xl bg-white/10 border border-white/20 text-white placeholder-slate-400 font-bold text-base focus:border-amber-400 focus:bg-white/15 outline-none transition"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-black uppercase tracking-wider text-slate-300 mb-1.5">
                Mot de passe :
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  placeholder="••••••••"
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  className="w-full px-4 py-3.5 rounded-2xl bg-white/10 border border-white/20 text-white placeholder-slate-400 font-bold text-base focus:border-amber-400 focus:bg-white/15 outline-none transition pr-12"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition cursor-pointer p-1"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={isLoggingIn}
                className="w-full py-4 rounded-2xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 active:scale-98 text-slate-950 font-black text-base shadow-lg shadow-amber-500/25 transition cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <KeyRound className="w-5 h-5" />
                <span>{isLoggingIn ? 'Vérification...' : 'CONNEXION SUPER ADMIN 🔐'}</span>
              </button>
            </div>
          </form>

          {/* Lien retour client */}
          <div className="pt-2 text-center border-t border-white/10">
            <button
              type="button"
              onClick={() => {
                if (onNavigateToClient) {
                  onNavigateToClient();
                } else {
                  window.history.pushState({}, '', '/');
                  window.location.reload();
                }
              }}
              className="text-xs font-bold text-slate-400 hover:text-amber-300 inline-flex items-center gap-1 transition cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Retour à l'application Caisse EFA</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ============================================================================
  // RENDU 2 : DASHBOARD SUPER ADMIN COMPLET (SI CONNECTÉ)
  // ============================================================================
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 select-none pb-20">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-top-4">
          <div
            className={`px-5 py-3 rounded-2xl shadow-2xl text-sm font-black flex items-center gap-2 ${
              toast.type === 'success'
                ? 'bg-emerald-600 text-white shadow-emerald-500/30'
                : toast.type === 'error'
                ? 'bg-rose-600 text-white shadow-rose-500/30'
                : 'bg-blue-600 text-white shadow-blue-500/30'
            }`}
          >
            <span>{toast.message}</span>
          </div>
        </div>
      )}

      {/* HEADER SUPER ADMIN */}
      <header className="bg-slate-900 text-white sticky top-0 z-40 shadow-md border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 py-3.5 sm:px-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500 flex items-center justify-center text-slate-950 font-black shadow-md">
              <Shield className="w-6 h-6 stroke-[2.5]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base sm:text-xl font-black tracking-tight text-white">
                  SUPER ADMIN - EFA ACONTA
                </h1>
                <span className="px-2 py-0.5 rounded-md bg-amber-500 text-slate-950 text-[10px] font-black uppercase">
                  DIRECTEUR
                </span>
              </div>
              <p className="text-[11px] font-semibold text-slate-400">
                Gestion centrale des boutiques, activations manuelles et codes PIN
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Bouton WhatsApp assistance */}
            <a
              href={`https://wa.me/${whatsappNumber}`}
              target="_blank"
              rel="noreferrer"
              className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-black text-xs flex items-center gap-1.5 shadow-sm transition"
              title="Ouvrir WhatsApp direction"
            >
              <MessageCircle className="w-4 h-4" />
              <span className="hidden sm:inline">WhatsApp</span>
            </a>

            {/* Actualiser */}
            <button
              type="button"
              onClick={loadBoutiques}
              disabled={isLoadingData}
              className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 text-white font-black text-xs flex items-center gap-1.5 border border-slate-700 transition cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${isLoadingData ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Actualiser</span>
            </button>

            {/* Déconnexion */}
            <button
              type="button"
              onClick={handleLogout}
              className="px-3 py-2 rounded-xl bg-rose-600/90 hover:bg-rose-600 active:scale-95 text-white font-black text-xs flex items-center gap-1.5 shadow-sm transition cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              <span>Quitter</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* a) SECTION STATS EN CARTES */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
          {/* Total Boutiques */}
          <div className="bg-white p-4 sm:p-5 rounded-3xl border-2 border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-wider text-slate-500">
                Total Boutiques
              </p>
              <p className="text-2xl sm:text-3xl font-black text-slate-900 mt-1">
                {stats.total}
              </p>
              <span className="text-[11px] font-bold text-slate-400">Boutiques créées</span>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600">
              <Store className="w-6 h-6 stroke-[2.5]" />
            </div>
          </div>

          {/* Boutiques Actives */}
          <div className="bg-white p-4 sm:p-5 rounded-3xl border-2 border-emerald-200 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-wider text-emerald-700">
                Actives
              </p>
              <p className="text-2xl sm:text-3xl font-black text-emerald-600 mt-1">
                {stats.actives}
              </p>
              <span className="text-[11px] font-bold text-emerald-600">En cours de validité</span>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
              <CheckCircle2 className="w-6 h-6 stroke-[2.5]" />
            </div>
          </div>

          {/* Boutiques Expirées */}
          <div className="bg-white p-4 sm:p-5 rounded-3xl border-2 border-rose-200 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-wider text-rose-700">
                Expirées
              </p>
              <p className="text-2xl sm:text-3xl font-black text-rose-600 mt-1">
                {stats.expirees}
              </p>
              <span className="text-[11px] font-bold text-rose-600">À réactiver</span>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-600">
              <AlertTriangle className="w-6 h-6 stroke-[2.5]" />
            </div>
          </div>

          {/* Revenu Total */}
          <div className="bg-white p-4 sm:p-5 rounded-3xl border-2 border-amber-200 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-wider text-amber-800">
                Revenu Total
              </p>
              <p className="text-2xl sm:text-3xl font-black text-amber-600 mt-1">
                {stats.revenuTotal.toLocaleString('fr-FR')} F
              </p>
              <span className="text-[11px] font-bold text-amber-700">Paiements encaissés</span>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600">
              <DollarSign className="w-6 h-6 stroke-[2.5]" />
            </div>
          </div>

          {/* Total Parrainages Annuels Validés */}
          <div className="bg-white p-4 sm:p-5 rounded-3xl border-2 border-indigo-200 shadow-sm flex items-center justify-between col-span-2 sm:col-span-1">
            <div>
              <p className="text-xs font-black uppercase tracking-wider text-indigo-700">
                Parrainages 1 AN
              </p>
              <p className="text-2xl sm:text-3xl font-black text-indigo-600 mt-1">
                {annualReferralsCount}
              </p>
              <span className="text-[11px] font-bold text-indigo-500">Validés (+60j offerts)</span>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-600">
              <Award className="w-6 h-6 stroke-[2.5]" />
            </div>
          </div>
        </div>

        {/* SÉLECTEUR D'ONGLET PRINCIPAL SUPER ADMIN */}
        <div className="flex items-center gap-2 p-1.5 rounded-2xl bg-slate-900 w-fit">
          <button
            type="button"
            onClick={() => setActiveView('boutiques')}
            className={`px-4 py-2.5 rounded-xl text-xs sm:text-sm font-black transition cursor-pointer flex items-center gap-2 ${
              activeView === 'boutiques'
                ? 'bg-amber-400 text-slate-950 shadow-md'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            <Store className="w-4 h-4" />
            <span>Boutiques Réseau ({boutiques.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveView('referrals')}
            className={`px-4 py-2.5 rounded-xl text-xs sm:text-sm font-black transition cursor-pointer flex items-center gap-2 ${
              activeView === 'referrals'
                ? 'bg-amber-400 text-slate-950 shadow-md'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            <Gift className="w-4 h-4" />
            <span>Parrainages & Bonus 2 Mois ({referrals.length})</span>
          </button>
        </div>

        {/* VUE 1 : GESTION DES BOUTIQUES RÉSEAU */}
        {activeView === 'boutiques' && (
          <>
            {/* b) BARRE DE RECHERCHE INSTANTANÉE & FILTRES */}
            <div className="bg-white p-4 rounded-3xl border-2 border-slate-200 shadow-sm space-y-3">
          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
            {/* Barre de recherche */}
            <div className="relative flex-1">
              <Search className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Rechercher par nom personne ou nom boutique..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-11 pr-4 py-3.5 rounded-2xl bg-slate-50 border-2 border-slate-200 text-slate-900 font-bold text-sm focus:border-amber-500 focus:bg-white outline-none transition"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Filtres de statut */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
              <button
                type="button"
                onClick={() => setStatusFilter('all')}
                className={`px-3 py-2 rounded-xl text-xs font-black transition cursor-pointer whitespace-nowrap ${
                  statusFilter === 'all'
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                Tous ({boutiques.length})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('actif')}
                className={`px-3 py-2 rounded-xl text-xs font-black transition cursor-pointer whitespace-nowrap ${
                  statusFilter === 'actif'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                }`}
              >
                Actifs ({stats.actives})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('expire')}
                className={`px-3 py-2 rounded-xl text-xs font-black transition cursor-pointer whitespace-nowrap ${
                  statusFilter === 'expire'
                    ? 'bg-rose-600 text-white'
                    : 'bg-rose-50 text-rose-800 hover:bg-rose-100'
                }`}
              >
                Expirés ({stats.expirees})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('bloque')}
                className={`px-3 py-2 rounded-xl text-xs font-black transition cursor-pointer whitespace-nowrap ${
                  statusFilter === 'bloque'
                    ? 'bg-amber-600 text-white'
                    : 'bg-amber-50 text-amber-800 hover:bg-amber-100'
                }`}
              >
                Bloqués
              </button>
            </div>
          </div>
        </div>

        {/* c) TABLEAU RESPONSIVE DES BOUTIQUES */}
        <div className="bg-white rounded-3xl border-2 border-slate-200 shadow-sm overflow-hidden">
          {isLoadingData ? (
            <div className="p-12 text-center space-y-3">
              <div className="w-10 h-10 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-sm font-black text-slate-600">Chargement des boutiques...</p>
            </div>
          ) : filteredBoutiques.length === 0 ? (
            <div className="p-12 text-center space-y-2">
              <Store className="w-12 h-12 text-slate-300 mx-auto" />
              <p className="text-base font-black text-slate-700">Aucune boutique trouvée</p>
              <p className="text-xs text-slate-400">
                {searchQuery
                  ? `Aucun résultat pour "${searchQuery}"`
                  : 'Aucune boutique enregistrée pour le moment.'}
              </p>
            </div>
          ) : (
            <>
              {/* VUE MOBILE CARTES (< 768px) OPTIMISÉE POUR 360px */}
              <div className="block md:hidden divide-y divide-slate-200">
                {filteredBoutiques.map((b) => {
                  const isPinRevealed = visiblePins[b.id];
                  const now = new Date();
                  const subEnd = b.subscription_end ? new Date(b.subscription_end) : null;
                  const isExpired = subEnd ? subEnd < now : false;
                  let daysRemaining: number | null = null;
                  if (subEnd) {
                    daysRemaining = Math.ceil((subEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                  }

                  const groupInfo = boutiqueGroupsMap.get(b.id) || {
                    isPrincipale: true,
                    boutiqueIndex: 1,
                    totalInGroup: 1,
                    principale: b,
                    isSubOfPro: false,
                    subBadgeText: 'Boutique 1 - Incluse PRO Principale',
                  };

                  return (
                    <div key={`mob-${b.id}`} className="p-4 space-y-3 bg-white">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-black text-slate-900 text-sm block">{b.nom_personne}</span>
                            {groupInfo.isPrincipale ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-amber-500 text-slate-950 shadow-2xs">
                                PRINCIPALE
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-slate-200 text-slate-700">
                                BOUTIQUE {groupInfo.boutiqueIndex}
                              </span>
                            )}
                          </div>
                          <span className="text-xs font-bold text-amber-700 flex items-center gap-1">
                            <Store className="w-3.5 h-3.5 text-amber-600" />
                            <span>{b.nom_boutique}</span>
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap justify-end">
                          {(() => {
                            const badge = getPlanBadge(b, groupInfo);
                            if (!badge) return null;
                            return (
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] uppercase ${badge.className}`}>
                                {badge.label}
                              </span>
                            );
                          })()}
                          {!b.is_active || b.status === 'bloque' ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-800 text-[10px] font-black uppercase">
                              Bloqué
                            </span>
                          ) : isExpired ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900 text-[10px] font-black uppercase">
                              Expiré
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-black uppercase">
                              Actif
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-xs font-semibold text-slate-600 bg-slate-50 p-2.5 rounded-2xl border border-slate-200">
                        <div>
                          <span className="text-[10px] uppercase text-slate-400 font-bold block">Code PIN</span>
                          <div className="inline-flex items-center gap-1">
                            <span className="font-mono font-black text-slate-900 text-xs">
                              {isPinRevealed ? b.pin_code : '••••'}
                            </span>
                            <button
                              type="button"
                              onClick={() => togglePinVisibility(b.id)}
                              className="text-slate-500 hover:text-slate-900 p-0.5 cursor-pointer"
                            >
                              {isPinRevealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                            </button>
                          </div>
                        </div>

                        <div>
                          <span className="text-[10px] uppercase text-slate-400 font-bold block">Fin Abonnement</span>
                          {(() => {
                            const effectiveEnd = (subEnd && groupInfo.isPrincipale) ? subEnd : (groupInfo.principale?.subscription_end ? new Date(groupInfo.principale.subscription_end) : subEnd);
                            const effectiveExpired = effectiveEnd ? now > effectiveEnd : isExpired;
                            const effectiveRemaining = effectiveEnd ? Math.ceil((effectiveEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : daysRemaining;
                            return (
                              <>
                                <span className="font-black text-slate-900 text-xs block">
                                  {effectiveEnd ? effectiveEnd.toLocaleDateString('fr-FR') : 'Pas de date'}
                                </span>
                                <span className={`text-[10px] font-black ${effectiveExpired ? 'text-rose-600' : (effectiveRemaining ?? 0) <= 7 ? 'text-amber-600' : 'text-emerald-600'}`}>
                                  {effectiveEnd
                                    ? effectiveExpired
                                      ? `Expiré il y a ${Math.abs(effectiveRemaining || 0)} j`
                                      : `${effectiveRemaining} jours restants`
                                    : ''}
                                </span>
                              </>
                            );
                          })()}
                        </div>
                      </div>

                      {/* Info Parrainage Mobile */}
                      <div className="bg-indigo-50/50 p-2.5 rounded-2xl border border-indigo-100 text-xs space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] uppercase font-bold text-slate-500">Parrainé par :</span>
                          <span className="font-bold text-slate-800 text-xs">
                            {b.referred_by ? (
                              <span className="text-indigo-700 font-mono font-black">
                                {b.referred_by} {b.parrain_nom ? `(${b.parrain_nom})` : ''}
                              </span>
                            ) : (
                              <span className="text-slate-400 italic">Sans parrain</span>
                            )}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] uppercase font-bold text-slate-500">Filleuls & Bonus :</span>
                          <span className="text-xs font-bold text-slate-700">
                            {b.referrals_count || 0} filleul(s) • <span className="font-black text-emerald-700">+{b.bonus_days_earned || 0}j</span>
                          </span>
                        </div>
                        <div className="flex items-center justify-between pt-0.5">
                          <span className="text-[10px] uppercase font-bold text-slate-500">Statut Bonus :</span>
                          {b.referred_by ? (
                            b.referral_bonus_given ? (
                              <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-black uppercase inline-flex items-center gap-1">
                                <Check className="w-3 h-3 stroke-[3]" /> Bonus Donné
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 text-[10px] font-black uppercase inline-flex items-center gap-1">
                                <Clock className="w-3 h-3" /> En attente 1 AN
                              </span>
                            )
                          ) : (
                            <span className="text-[10px] text-slate-400 italic">Sans parrain</span>
                          )}
                        </div>
                      </div>

                      {/* Contact WhatsApp Direct Mobile */}
                      {(b.whatsapp_number || b.telephone) && (
                        <a
                          href={formatWaLink(b.whatsapp_number || b.telephone)}
                          target="_blank"
                          rel="noreferrer"
                          className="w-full py-2.5 px-3 rounded-2xl bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 text-emerald-800 font-black text-xs flex items-center justify-center gap-2 transition shadow-xs"
                          title="Discuter directement sur WhatsApp"
                        >
                          <MessageCircle className="w-4 h-4 text-emerald-600 fill-emerald-600/20 shrink-0" />
                          <span>WhatsApp : {b.whatsapp_number || b.telephone} (Discuter direct)</span>
                        </a>
                      )}

                      {/* BOUTONS D'ACTION SUR MOBILE */}
                      {groupInfo.isSubOfPro || (!groupInfo.isPrincipale && groupInfo.principale) ? (
                        <div className="w-full py-2.5 px-3 rounded-2xl bg-slate-100 border border-slate-300 text-slate-700 font-black text-xs flex items-center justify-center gap-2 shadow-2xs">
                          <span>{groupInfo.subBadgeText || `Boutique ${groupInfo.boutiqueIndex} - Incluse PRO Principale`}</span>
                        </div>
                      ) : (
                        <div className="space-y-2 pt-1">
                          {/* a) Prolonger 30j (1500F) - Orange */}
                          <button
                            type="button"
                            onClick={() => handleProlonger(b, 30)}
                            className="w-full py-2.5 px-3 rounded-2xl bg-amber-500 hover:bg-amber-600 active:scale-95 text-slate-950 font-black text-xs sm:text-sm flex items-center justify-center gap-2 shadow-md transition border border-amber-600/30 cursor-pointer"
                            title="Prolonger de 30 jours (1.500F)"
                          >
                            <Calendar className="w-4 h-4 stroke-[2.5]" />
                            <span>Prolonger 30j (1.500F)</span>
                          </button>

                          <div className="grid grid-cols-3 gap-1.5">
                            {/* b) Activer 6 mois (50.000F) - Violet */}
                            <button
                              type="button"
                              onClick={() => handleActivateBoutique(b, 180, 50000, 'PRO 6 MOIS (50.000 F)', 'pro_6mois')}
                              className="py-2.5 px-1.5 rounded-xl bg-purple-600 hover:bg-purple-700 active:scale-95 text-white font-black text-[11px] flex items-center justify-center gap-1 shadow-xs transition cursor-pointer text-center leading-tight"
                              title="Activer 6 mois (50.000F)"
                            >
                              <Sparkles className="w-3 h-3 shrink-0" />
                              <span>6 Mois (50K)</span>
                            </button>

                            {/* c) Activer Pro 1 An (90.000F) - Bleu (NOUVEAU) */}
                            <button
                              type="button"
                              onClick={() => handleActivateBoutique(b, 365, 90000, 'PRO 1 AN (90.000 F)', 'pro_annuel')}
                              className="py-2.5 px-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-black text-[11px] flex items-center justify-center gap-1 shadow-xs transition cursor-pointer text-center leading-tight"
                              title="Activer Boutique Pro 1 AN (90.000F)"
                            >
                              <Crown className="w-3 h-3 shrink-0" />
                              <span>Pro 1 An (90K)</span>
                            </button>

                            {/* d) Activer Populaire 1 An (16.500F) - Jaune/GOLD */}
                            <button
                              type="button"
                              onClick={() => handleActivateBoutique(b, 365, 16500, 'POPULAIRE 1 AN (16.500 F)', 'populaire')}
                              className="py-2.5 px-1.5 rounded-xl bg-yellow-400 hover:bg-yellow-500 active:scale-95 text-slate-950 font-black text-[11px] flex items-center justify-center gap-1 shadow-xs transition cursor-pointer border border-amber-500 text-center leading-tight"
                              title="Activer Populaire 1 An (16.500F)"
                            >
                              <Sparkles className="w-3 h-3 shrink-0" />
                              <span>Pop 1 An (16.5K)</span>
                            </button>
                          </div>
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => handleToggleBlockBoutique(b)}
                          className={`py-2 px-2 rounded-xl font-black text-xs flex items-center justify-center gap-1 shadow-xs transition cursor-pointer ${
                            b.is_active && b.status !== 'bloque' ? 'bg-slate-200 text-slate-800' : 'bg-emerald-100 text-emerald-900'
                          }`}
                        >
                          {b.is_active && b.status !== 'bloque' ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                          <span>{b.is_active && b.status !== 'bloque' ? 'Bloquer' : 'Débloquer'}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleDeleteBoutique(b)}
                          className="py-2 px-2 rounded-xl bg-rose-50 text-rose-700 border border-rose-200 font-black text-xs flex items-center justify-center gap-1 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Supprimer</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* VUE TABLEAU DESKTOP (>= 768px) */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-100 border-b border-slate-200 text-[11px] font-black uppercase tracking-wider text-slate-600">
                      <th className="py-4 px-4">Boutique</th>
                      <th className="py-4 px-4">WhatsApp / Contact</th>
                      <th className="py-4 px-4">Parrainé par</th>
                      <th className="py-4 px-3 text-center">Filleuls</th>
                      <th className="py-4 px-3 text-center">Bonus Jours</th>
                      <th className="py-4 px-4">Statut Bonus</th>
                      <th className="py-4 px-4">Fin Abonnement</th>
                      <th className="py-4 px-4 text-right">Actions Super Admin</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs sm:text-sm font-bold text-slate-800">
                    {filteredBoutiques.map((b) => {
                      const isPinRevealed = visiblePins[b.id];
                      const now = new Date();
                      const subEnd = b.subscription_end ? new Date(b.subscription_end) : null;
                      const isExpired = subEnd ? subEnd < now : false;

                      let daysRemaining: number | null = null;
                      if (subEnd) {
                        daysRemaining = Math.ceil(
                          (subEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
                        );
                      }

                      const groupInfo = boutiqueGroupsMap.get(b.id) || {
                        isPrincipale: true,
                        boutiqueIndex: 1,
                        totalInGroup: 1,
                        principale: b,
                        isSubOfPro: false,
                        subBadgeText: 'Boutique 1 - Incluse PRO Principale',
                      };

                      return (
                        <tr
                          key={b.id}
                          className="hover:bg-slate-50/80 transition duration-150"
                        >
                          {/* 1. Boutique */}
                          <td className="py-4 px-4">
                            <div className="flex items-center gap-2.5">
                              <div className="w-8 h-8 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center font-black text-xs shrink-0">
                                <Store className="w-4 h-4 text-amber-600" />
                              </div>
                              <div>
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="font-black text-slate-900 block">
                                    {b.nom_boutique}
                                  </span>
                                  {groupInfo.isPrincipale ? (
                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-amber-500 text-slate-950 shadow-2xs">
                                      PRINCIPALE
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-slate-200 text-slate-700">
                                      BOUTIQUE {groupInfo.boutiqueIndex}
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 text-xs text-slate-500 font-bold">
                                  <span>👤 {b.nom_personne}</span>
                                </div>
                                <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                                  {(() => {
                                    const badge = getPlanBadge(b, groupInfo);
                                    if (!badge) return null;
                                    return (
                                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] uppercase ${badge.className}`}>
                                        {badge.label}
                                      </span>
                                    );
                                  })()}
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-slate-100 border border-slate-200 text-slate-700 font-mono text-[11px]">
                                    PIN: {isPinRevealed ? b.pin_code : '••••'}
                                    <button
                                      type="button"
                                      onClick={() => togglePinVisibility(b.id)}
                                      className="text-slate-400 hover:text-slate-700 p-0.5 cursor-pointer"
                                    >
                                      {isPinRevealed ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                                    </button>
                                  </span>
                                  {b.referral_code && (
                                    <span className="text-[10px] text-slate-400 font-mono">
                                      Code: {b.referral_code}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </td>

                          {/* 2. Contact WhatsApp Direct */}
                          <td className="py-4 px-4 whitespace-nowrap">
                            {b.whatsapp_number || b.telephone ? (
                              <div className="space-y-1">
                                <a
                                  href={formatWaLink(b.whatsapp_number || b.telephone)}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 font-black text-xs transition shadow-2xs"
                                  title={`Discuter directement sur WhatsApp avec ${b.nom_personne}`}
                                >
                                  <MessageCircle className="w-3.5 h-3.5 text-emerald-600 fill-emerald-600/20 shrink-0" />
                                  <span>{b.whatsapp_number || b.telephone}</span>
                                </a>
                                {b.telephone && b.whatsapp_number && b.telephone !== b.whatsapp_number && (
                                  <div className="text-[11px] font-bold text-slate-500 flex items-center gap-1 pl-1">
                                    <Phone className="w-3 h-3 text-slate-400" />
                                    <span>{b.telephone}</span>
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span className="text-xs text-slate-400 italic">Non renseigné</span>
                            )}
                          </td>

                          {/* 3. Parrainé par (code + nom) */}
                          <td className="py-4 px-4 whitespace-nowrap">
                            {b.referred_by ? (
                              <div>
                                <span className="font-mono font-black text-xs text-indigo-700 block">
                                  {b.referred_by}
                                </span>
                                <span className="text-xs font-bold text-slate-600 block">
                                  {b.parrain_nom || 'Parrain EFA'}
                                </span>
                              </div>
                            ) : (
                              <span className="text-xs text-slate-400 italic">Sans parrain</span>
                            )}
                          </td>

                          {/* 3. Filleuls (count) */}
                          <td className="py-4 px-3 text-center">
                            <span className="inline-block px-2.5 py-1 rounded-xl bg-slate-100 font-black text-xs text-slate-900">
                              {b.referrals_count || 0}
                            </span>
                          </td>

                          {/* 4. Bonus Jours */}
                          <td className="py-4 px-3 text-center whitespace-nowrap">
                            {(b.bonus_days_earned || 0) > 0 ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-black text-xs">
                                +{b.bonus_days_earned}j
                              </span>
                            ) : (
                              <span className="text-xs text-slate-400 font-bold">0j</span>
                            )}
                          </td>

                          {/* 5. Statut Bonus */}
                          <td className="py-4 px-4 whitespace-nowrap">
                            {b.referred_by ? (
                              b.referral_bonus_given ? (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-black uppercase">
                                  <Check className="w-3.5 h-3.5 stroke-[3] text-emerald-600" />
                                  <span>Bonus Donné</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-100 text-amber-900 text-[11px] font-black uppercase">
                                  <Clock className="w-3 h-3 text-amber-700" />
                                  <span>En attente 1 AN</span>
                                </span>
                              )
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 text-[10px] font-bold">
                                Sans parrain
                              </span>
                            )}
                          </td>

                          {/* 6. Fin Abonnement */}
                          <td className="py-4 px-4 whitespace-nowrap text-xs">
                            {(() => {
                              const effectiveEnd = (subEnd && groupInfo.isPrincipale) ? subEnd : (groupInfo.principale?.subscription_end ? new Date(groupInfo.principale.subscription_end) : subEnd);
                              const effectiveExpired = effectiveEnd ? now > effectiveEnd : isExpired;
                              const effectiveRemaining = effectiveEnd ? Math.ceil((effectiveEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : daysRemaining;
                              if (!effectiveEnd) return <span className="text-slate-400 italic">Pas de date</span>;
                              return (
                                <div>
                                  <span className="font-black text-slate-800 block">
                                    {effectiveEnd.toLocaleDateString('fr-FR')}
                                  </span>
                                  <span
                                    className={`text-[10px] font-black ${
                                      effectiveExpired
                                        ? 'text-rose-600'
                                        : (effectiveRemaining ?? 0) <= 7
                                        ? 'text-amber-600'
                                        : 'text-emerald-600'
                                    }`}
                                  >
                                    {effectiveExpired
                                      ? `Expiré il y a ${Math.abs(effectiveRemaining || 0)} j`
                                      : `${effectiveRemaining} jours restants`}
                                  </span>
                                  <div className="mt-1">
                                    {!b.is_active || b.status === 'bloque' ? (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 text-[10px] font-black uppercase">
                                        Bloqué
                                      </span>
                                    ) : effectiveExpired ? (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 text-[10px] font-black uppercase">
                                        Expiré
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-black uppercase">
                                        Actif
                                      </span>
                                    )}
                                  </div>
                                </div>
                              );
                            })()}
                          </td>

                          {/* 7. d) Actions Super Admin */}
                          <td className="py-4 px-4 text-right whitespace-nowrap">
                            <div className="inline-flex items-center justify-end gap-1.5 flex-wrap">
                              {groupInfo.isSubOfPro || (!groupInfo.isPrincipale && groupInfo.principale) ? (
                                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 text-slate-700 border border-slate-300 font-black text-xs shadow-2xs">
                                  {groupInfo.subBadgeText || `Boutique ${groupInfo.boutiqueIndex} - Incluse PRO Principale`}
                                </span>
                              ) : (
                                <>
                                  {/* a) Prolonger 30j (1500F) - Orange */}
                                  <button
                                    type="button"
                                    onClick={() => handleProlonger(b, 30)}
                                    className="px-2.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 active:scale-95 text-slate-950 font-black text-xs transition cursor-pointer shadow-xs flex items-center gap-1 border border-amber-600/30"
                                    title="Prolonger de 30 jours (1.500F)"
                                  >
                                    <Calendar className="w-3.5 h-3.5 stroke-[2.5]" />
                                    <span>Prolonger 30j (1500F)</span>
                                  </button>

                                  {/* b) Activer 6 mois (50.000F) - Violet */}
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleActivateBoutique(b, 180, 50000, 'PRO 6 MOIS (50.000 F)', 'pro_6mois')
                                    }
                                    className="px-2.5 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-700 active:scale-95 text-white font-black text-xs transition cursor-pointer shadow-xs flex items-center gap-1"
                                    title="Activer Boutique Pro 6 mois (50.000 F)"
                                  >
                                    <Sparkles className="w-3 h-3" />
                                    <span>Activer 6 mois (50.000F)</span>
                                  </button>

                                  {/* c) Activer Pro 1 An (90.000F) - Bleu (NOUVEAU) */}
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleActivateBoutique(b, 365, 90000, 'PRO 1 AN (90.000 F)', 'pro_annuel')
                                    }
                                    className="px-2.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-black text-xs transition cursor-pointer shadow-xs flex items-center gap-1"
                                    title="Activer Boutique Pro 1 AN (90.000 F)"
                                  >
                                    <Crown className="w-3 h-3" />
                                    <span>Pro 1 An (90.000F)</span>
                                  </button>

                                  {/* d) Activer Populaire 1 An (16.500F) - Jaune/GOLD */}
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleActivateBoutique(b, 365, 16500, 'POPULAIRE 1 AN (16.500 F)', 'populaire')
                                    }
                                    className="px-2.5 py-1.5 rounded-xl bg-yellow-400 hover:bg-yellow-500 active:scale-95 text-slate-950 font-black text-xs transition cursor-pointer shadow-xs flex items-center gap-1 border border-amber-500"
                                    title="Activer Offre Populaire 1 an (16.500 F)"
                                  >
                                    <Sparkles className="w-3 h-3 text-slate-950" />
                                    <span>Populaire 1 An (16.500F)</span>
                                  </button>
                                </>
                              )}

                              {/* Bloquer / Débloquer */}
                              <button
                                type="button"
                                onClick={() => handleToggleBlockBoutique(b)}
                                className={`px-2.5 py-1.5 rounded-xl font-black text-xs transition cursor-pointer shadow-xs flex items-center gap-1 ${
                                  b.is_active && b.status !== 'bloque'
                                    ? 'bg-slate-200 hover:bg-slate-300 text-slate-800'
                                    : 'bg-emerald-100 hover:bg-emerald-200 text-emerald-900'
                                }`}
                                title={b.is_active ? 'Bloquer la boutique' : 'Débloquer la boutique'}
                              >
                                {b.is_active && b.status !== 'bloque' ? (
                                  <>
                                    <Lock className="w-3 h-3 text-slate-700" />
                                    <span>Bloquer</span>
                                  </>
                                ) : (
                                  <>
                                    <Unlock className="w-3 h-3 text-emerald-700" />
                                    <span>Débloquer</span>
                                  </>
                                )}
                              </button>

                              {/* Supprimer */}
                              <button
                                type="button"
                                onClick={() => handleDeleteBoutique(b)}
                                className="p-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 transition cursor-pointer border border-rose-200"
                                title="Supprimer la boutique"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </>
    )}

          {/* VUE 2 : TABLEAU DES PARRAINAGES & RÉCOMPENSES */}
          {activeView === 'referrals' && (
            <div className="space-y-4">
              {/* Barre de recherche Parrainages */}
              <div className="bg-white p-4 rounded-3xl border-2 border-slate-200 shadow-sm space-y-3">
                <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
                  <div className="relative flex-1">
                    <Search className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Rechercher par nom parrain, filleul ou code (ex: EFA-XXXXX)..."
                      value={referralsSearch}
                      onChange={(e) => setReferralsSearch(e.target.value)}
                      className="w-full pl-11 pr-4 py-3.5 rounded-2xl bg-slate-50 border-2 border-slate-200 text-slate-900 font-bold text-sm focus:border-indigo-500 focus:bg-white outline-none transition"
                    />
                    {referralsSearch && (
                      <button
                        type="button"
                        onClick={() => setReferralsSearch('')}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-2 text-xs font-black text-slate-600 bg-slate-50 px-3 py-2 rounded-xl border border-slate-200">
                    <span>Total : {filteredReferrals.length} parrainage(s)</span>
                  </div>
                </div>
              </div>

              {/* Tableau Referrals */}
              <div className="bg-white rounded-3xl border-2 border-slate-200 shadow-sm overflow-hidden">
                {isLoadingReferrals ? (
                  <div className="p-12 text-center space-y-3">
                    <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto" />
                    <p className="text-sm font-black text-slate-600">Chargement des parrainages...</p>
                  </div>
                ) : filteredReferrals.length === 0 ? (
                  <div className="p-12 text-center space-y-2">
                    <Gift className="w-12 h-12 text-slate-300 mx-auto" />
                    <p className="text-base font-black text-slate-700">Aucun parrainage enregistré</p>
                    <p className="text-xs text-slate-400">
                      Les nouveaux parrainages apparaîtront ici automatiquement dès qu'un lien ?ref=CODE est utilisé.
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-black uppercase tracking-wider text-slate-500">
                          <th className="py-3.5 px-4">Date & Réf</th>
                          <th className="py-3.5 px-4">Parrain (Bénéficiaire +60j)</th>
                          <th className="py-3.5 px-4">Filleul (Paye 11 mois / 12)</th>
                          <th className="py-3.5 px-4 text-center">Statut Parrainage</th>
                          <th className="py-3.5 px-4 text-center">Bonus Parrain (+60j / 1 fois)</th>
                          <th className="py-3.5 px-4 text-right">Action Super Admin</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-sm">
                        {filteredReferrals.map((r) => {
                          const isRewarded = r.reward_given === true || r.status === 'paid';
                          const createdDate = r.created_at ? new Date(r.created_at).toLocaleDateString('fr-FR') : '-';
                          const rewardDate = r.reward_date ? new Date(r.reward_date).toLocaleDateString('fr-FR') : null;

                          return (
                            <tr key={r.id} className="hover:bg-slate-50/80 transition">
                              {/* 1. Date */}
                              <td className="py-4 px-4 whitespace-nowrap text-xs">
                                <span className="font-mono font-bold text-slate-700 block">{createdDate}</span>
                                <span className="text-[10px] text-slate-400 font-mono">{r.id.substring(0, 14)}</span>
                              </td>

                              {/* 2. Parrain */}
                              <td className="py-4 px-4 whitespace-nowrap">
                                <div className="flex items-center gap-2.5">
                                  <div className="w-8 h-8 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-700 flex items-center justify-center font-black text-xs">
                                    👑
                                  </div>
                                  <div>
                                    <span className="font-black text-slate-900 block text-sm">
                                      {r.parrain_nom || 'Parrain EFA'}
                                    </span>
                                    <span className="font-mono text-xs font-black text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200">
                                      {r.parrain_code || 'CODE INCONNU'}
                                    </span>
                                  </div>
                                </div>
                              </td>

                              {/* 3. Filleul */}
                              <td className="py-4 px-4 whitespace-nowrap">
                                <div className="flex items-center gap-2.5">
                                  <div className="w-8 h-8 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 flex items-center justify-center font-black text-xs">
                                    🏪
                                  </div>
                                  <div>
                                    <span className="font-black text-slate-900 block text-sm">
                                      {r.filleul_nom || 'Nouvelle Boutique'}
                                    </span>
                                    <span className="text-xs text-slate-500 font-bold">
                                      Plan: {r.filleul_plan || 'essai'}
                                    </span>
                                  </div>
                                </div>
                              </td>

                              {/* 4. Statut Parrainage */}
                              <td className="py-4 px-4 text-center whitespace-nowrap">
                                {r.status === 'paid' ? (
                                  <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-black uppercase">
                                    <Check className="w-3.5 h-3.5 stroke-[3] text-emerald-600" />
                                    <span>Payé 1 AN ✅</span>
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-amber-100 text-amber-900 text-xs font-black uppercase">
                                    <Clock className="w-3.5 h-3.5 text-amber-700" />
                                    <span>En attente (Essai)</span>
                                  </span>
                                )}
                              </td>

                              {/* 5. Récompense +2 Mois */}
                              <td className="py-4 px-4 text-center whitespace-nowrap">
                                {isRewarded ? (
                                  <div>
                                    <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-indigo-100 text-indigo-800 text-xs font-black uppercase">
                                      <Gift className="w-3.5 h-3.5 text-indigo-600" />
                                      <span>+2 MOIS ACCORDÉS 🎁</span>
                                    </span>
                                    {rewardDate && (
                                      <span className="block text-[10px] text-slate-400 font-bold mt-0.5">
                                        Le {rewardDate}
                                      </span>
                                    )}
                                  </div>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-100 text-slate-500 text-xs font-bold">
                                    ⏳ En attente de paiement 1 an
                                  </span>
                                )}
                              </td>

                              {/* 6. Action */}
                              <td className="py-4 px-4 text-right whitespace-nowrap">
                                {!isRewarded ? (
                                  <button
                                    type="button"
                                    onClick={() => handleValidateReferralBonus(r)}
                                    className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white font-black text-xs transition cursor-pointer shadow-sm flex items-center gap-1.5 ml-auto"
                                  >
                                    <Gift className="w-3.5 h-3.5" />
                                    <span>Valider +2 Mois</span>
                                  </button>
                                ) : (
                                  <span className="text-xs font-black text-emerald-600">
                                    Bonus appliqué ✅
                                  </span>
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
          )}
      </main>

      {/* MODAL PROLONGATION */}
      {prolongModal.isOpen && prolongModal.boutique && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-sm w-full shadow-2xl space-y-4 border border-slate-200">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
                <Calendar className="w-5 h-5 text-amber-500" />
                <span>Prolonger l'abonnement</span>
              </h3>
              <button
                type="button"
                onClick={() => setProlongModal({ isOpen: false, boutique: null, days: 30 })}
                className="text-slate-400 hover:text-slate-700 text-lg font-bold p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-600">
              Boutique : <strong>{prolongModal.boutique.nom_boutique}</strong>
            </p>

            <div className="space-y-2">
              <label className="block text-xs font-black uppercase text-slate-500">
                Nombre de jours à ajouter :
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[15, 30, 90].map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setProlongModal((prev) => ({ ...prev, days: d }))}
                    className={`py-2 rounded-xl text-xs font-black transition cursor-pointer ${
                      prolongModal.days === d
                        ? 'bg-amber-500 text-slate-950 shadow-sm'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    +{d} jours
                  </button>
                ))}
              </div>
              <input
                type="number"
                min="1"
                value={prolongModal.days}
                onChange={(e) =>
                  setProlongModal((prev) => ({
                    ...prev,
                    days: parseInt(e.target.value, 10) || 1,
                  }))
                }
                className="w-full mt-2 p-3 rounded-xl border border-slate-200 text-center font-black text-base text-slate-900"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setProlongModal({ isOpen: false, boutique: null, days: 30 })}
                className="flex-1 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-black text-xs transition cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={() =>
                  handleProlongBoutique(prolongModal.boutique!, prolongModal.days)
                }
                className="flex-1 py-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs transition cursor-pointer shadow-md"
              >
                Valider (+{prolongModal.days}j)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
