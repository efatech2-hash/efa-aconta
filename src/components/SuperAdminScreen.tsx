import React, { useState, useEffect, useMemo } from 'react';
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
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { db } from '../lib/db';
import { checkAndGiveReferralBonus, getTotalAnnualReferralsCount } from '../lib/ambassadeur';

export interface AdminBoutique {
  id: string;
  nom_personne: string;
  nom_boutique: string;
  pin_code: string;
  quartier?: string;
  telephone?: string;
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
  const [boutiques, setBoutiques] = useState<AdminBoutique[]>([]);
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
    // Vérification de validité du token admin au chargement
    const token = typeof window !== 'undefined' ? localStorage.getItem('efa_admin_token') : null;
    if (isAuthenticated && token) {
      fetch('/api/admin/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
        .then((r) => r.json())
        .then((data) => {
          if (!data.success) {
            handleLogout();
          }
        })
        .catch(() => {
          // Si le serveur est temporairement inaccessible, garder la session
        });
    } else if (isAuthenticated && !token) {
      handleLogout();
    }
  }, []);

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
    const token = typeof window !== 'undefined' ? localStorage.getItem('efa_admin_token') : null;
    if (token) {
      fetch('/api/admin/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      }).catch(() => {});
    }
    setIsAuthenticated(false);
    localStorage.removeItem('efa_super_admin_logged');
    localStorage.removeItem('efa_admin_token');
    localStorage.removeItem('efa_super_admin_email');
    showToast('Déconnexion effectuée', 'info');
  };

  // ============================================================================
  // CHARGEMENT DES BOUTIQUES DEPUIS SUPABASE ET DEXIE
  // ============================================================================
  const loadBoutiques = async () => {
    setIsLoadingData(true);
    try {
      // 1. Tenter par l'API backend sécurisée avec token
      let loadedFromApi = false;
      try {
        const resp = await adminFetch('/api/admin/boutiques');
        if (resp.ok) {
          const data = await resp.json();
          if (data.success && Array.isArray(data.boutiques)) {
            setBoutiques(data.boutiques);
            loadedFromApi = true;
          }
        } else if (resp.status === 401) {
          handleLogout();
          return;
        }
      } catch {}

      // 2. Si pas d'API backend, interroger directement Supabase (et Dexie local)
      if (!loadedFromApi) {
        const [efaRes, patronsRes, localPatrons] = await Promise.all([
          supabase.from('efa_boutiques').select('*').order('created_at', { ascending: false }),
          supabase.from('patrons').select('*').order('created_at', { ascending: false }),
          db.patrons.toArray().catch(() => []),
        ]);

        const combined = new Map<string, AdminBoutique>();

        // Intégrer Dexie local
        if (Array.isArray(localPatrons)) {
          for (const lp of localPatrons) {
            const subEnd = (lp as any).fin_abonnement || lp.subscription_end_date || lp.abonnement_expire || lp.trial_end_date;
            const now = new Date();
            const isExp = subEnd ? new Date(subEnd) < now : false;
            const plan = (lp as any).forfait || lp.subscription_status || 'essai';
            combined.set(lp.id, {
              id: lp.id,
              nom_personne: lp.nom || 'Patron',
              nom_boutique: lp.nom_boutique || 'Ma Boutique',
              pin_code: lp.pin_code || lp.code_pin || '----',
              quartier: lp.telephone || '',
              telephone: lp.telephone || '',
              status: isExp ? 'expire' : (lp.subscription_status || 'actif'),
              is_active: true,
              subscription_end: subEnd || null,
              plan,
              last_payment_amount: 0,
              created_at: lp.created_at,
              source: 'local',
              referral_code: lp.referral_code || (lp as any).code_parrain,
              referred_by: lp.referred_by || null,
              referral_bonus_given: lp.referral_bonus_given || false,
              has_paid_annuel: lp.has_paid_annuel || false,
              referrals_count: lp.referrals_count || 0,
              bonus_days_earned: lp.bonus_days_earned || 0,
            });
          }
        }

        // Intégrer table patrons Supabase
        if (patronsRes.data) {
          for (const p of patronsRes.data) {
            const subEnd = p.fin_abonnement || p.subscription_end_date || p.abonnement_expire || p.trial_end_date;
            const now = new Date();
            const isExp = subEnd ? new Date(subEnd) < now : false;
            const plan = p.forfait || p.subscription_status || 'essai';
            const status =
              p.is_active === false
                ? 'bloque'
                : isExp
                ? 'expire'
                : (p.statut === 'ACTIF' ? 'actif' : (p.subscription_status || 'actif'));

            combined.set(p.id, {
              id: p.id,
              nom_personne: p.nom || 'Patron',
              nom_boutique: p.nom_boutique || 'Ma Boutique',
              pin_code: p.pin_code || p.code_pin || '----',
              quartier: p.quartier || '',
              telephone: p.telephone || p.phone_full || '',
              status,
              is_active: p.is_active !== false,
              subscription_end: subEnd || null,
              plan,
              last_payment_amount: p.last_payment_amount || 0,
              created_at: p.created_at,
              source: 'patrons',
              referral_code: p.referral_code || (p as any).code_parrain,
              referred_by: p.referred_by || null,
              referral_bonus_given: p.referral_bonus_given || false,
              has_paid_annuel: p.has_paid_annuel || false,
              referrals_count: p.referrals_count || 0,
              bonus_days_earned: p.bonus_days_earned || 0,
            });
          }
        }

        // Intégrer table efa_boutiques Supabase
        if (efaRes.data) {
          for (const b of efaRes.data) {
            const existing = combined.get(b.id);
            const subEnd = b.date_fin_essai || (b as any).fin_abonnement || existing?.subscription_end;
            const now = new Date();
            const isExp = subEnd ? new Date(subEnd) < now : false;
            const plan = (b as any).forfait || b.plan || existing?.plan || 'essai';
            const status =
              b.is_active === false ? 'bloque' : isExp ? 'expire' : ((b as any).statut === 'ACTIF' ? 'actif' : (b.plan || 'actif'));

            combined.set(b.id, {
              id: b.id,
              nom_personne: b.nom_patron || existing?.nom_personne || b.nom_affichage,
              nom_boutique: b.nom_affichage || b.nom_boutique,
              pin_code: b.pin_code || existing?.pin_code || '----',
              quartier: b.quartier || existing?.quartier || '',
              telephone: existing?.telephone || '',
              status,
              is_active: b.is_active !== false,
              subscription_end: subEnd || null,
              plan,
              last_payment_amount: b.last_payment_amount || existing?.last_payment_amount || 0,
              created_at: b.created_at,
              source: 'efa_boutiques',
              referral_code: b.referral_code || existing?.referral_code,
              referred_by: b.referred_by || existing?.referred_by || null,
              referral_bonus_given: (b as any).referral_bonus_given || existing?.referral_bonus_given || false,
              has_paid_annuel: (b as any).has_paid_annuel || existing?.has_paid_annuel || false,
              referrals_count: (b as any).referrals_count || existing?.referrals_count || 0,
              bonus_days_earned: (b as any).bonus_days_earned || existing?.bonus_days_earned || 0,
            });
          }
        }

        const list = Array.from(combined.values());
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

        setBoutiques(list);
        getTotalAnnualReferralsCount().then(setAnnualReferralsCount).catch(() => {});
      }
    } catch (err: any) {
      console.error('[SUPER ADMIN] Erreur chargement:', err);
      showToast('Erreur lors du chargement des boutiques', 'error');
    } finally {
      setIsLoadingData(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      loadBoutiques();
    }
  }, [isAuthenticated]);

  // ============================================================================
  // ACTIONS SUPER ADMIN SUR LES BOUTIQUES
  // ============================================================================

  // Helper badge pour l'affichage du plan dans le tableau
  const getPlanBadge = (b: AdminBoutique) => {
    const p = (b.plan || '').toLowerCase();
    const amt = b.last_payment_amount || 0;
    if (p.includes('pro_annuel') || p.includes('pro 1 an') || (p.includes('pro') && amt === 90000)) {
      return { label: 'PRO 1 AN - 90K', className: 'bg-blue-600 text-white shadow-xs font-black' };
    }
    if (p.includes('pro_6mois') || p.includes('pro 6 mois') || (p.includes('pro') && amt === 50000)) {
      return { label: 'PRO 6 MOIS - 50K', className: 'bg-purple-600 text-white shadow-xs font-black' };
    }
    if (p.includes('populaire') || amt === 16500) {
      return { label: 'POPULAIRE 1 AN - 16.5K', className: 'bg-yellow-400 text-slate-950 font-black border border-amber-500 shadow-xs' };
    }
    if (p.includes('prolonge')) {
      return { label: 'PROLONGÉ 30J', className: 'bg-amber-500 text-slate-950 font-black shadow-xs' };
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
    const targetStatus = planCode.startsWith('pro') ? 'pro' : 'populaire';

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

      // 2. Mettre à jour Supabase direct
      await supabase
        .from('efa_boutiques')
        .update({
          plan: planCode,
          date_fin_essai: expiryDate,
          is_active: true,
          last_payment_amount: amount,
        } as any)
        .eq('id', boutique.id);

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

      // 3. Mettre à jour Dexie local si présent
      try {
        const localPatron = await db.patrons.get(boutique.id);
        if (localPatron) {
          await db.patrons.update(boutique.id, {
            subscription_status: targetStatus,
            subscription_end_date: expiryDate,
            abonnement_expire: expiryDate,
            fin_abonnement: expiryDate,
            forfait: planCode,
            statut: 'ACTIF',
          } as any);
        }
      } catch {}

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

      // 5. RÈGLE D'OR AMBASSADEUR : Bonus +60 jours UNIQUEMENT si forfait ANNUEL
      // (Boutique Pro 1 An - 90.000F ou Populaire 1 An - 16.500F)
      if (durationDays >= 365 || planCode === 'pro_annuel' || planCode === 'boutique_pro_annuel' || (planCode === 'populaire' && amount === 16500)) {
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

      await supabase.from('efa_boutiques').update({ is_active: newActiveState }).eq('id', boutique.id);
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

      // Si l'abonnement est déjà expiré (fin < aujourd'hui), alors nouvelle_date = aujourd'hui + 30 jours
      // Sinon nouvelle_date = ancienne_date_fin + 30 jours
      const baseDate = ancienneDateFin > now ? ancienneDateFin : now;
      const nouvelleDate = new Date(baseDate.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
      const nouvelleDateIso = nouvelleDate.toISOString();
      const dateFrFormatted = nouvelleDate.toLocaleDateString('fr-FR');

      console.log("Prolongation OK", nouvelleDate);

      // 1. Update Supabase table patrons : fin_abonnement = nouvelle_date.toISOString(), statut = 'ACTIF', forfait = 'PROLONGE'
      try {
        await supabase
          .from('patrons')
          .update({
            fin_abonnement: nouvelleDateIso,
            subscription_end_date: nouvelleDateIso,
            abonnement_expire: nouvelleDateIso,
            statut: 'ACTIF',
            is_active: true,
            forfait: 'PROLONGE',
            subscription_status: 'populaire',
          } as any)
          .eq('id', boutique.id);
      } catch (errP) {
        try {
          await supabase
            .from('patrons')
            .update({
              fin_abonnement: nouvelleDateIso,
              subscription_end_date: nouvelleDateIso,
              abonnement_expire: nouvelleDateIso,
              is_active: true,
            } as any)
            .eq('id', boutique.id);
        } catch {}
      }

      // 2. Update Supabase table efa_boutiques
      try {
        await supabase
          .from('efa_boutiques')
          .update({
            date_fin_essai: nouvelleDateIso,
            is_active: true,
          })
          .eq('id', boutique.id);
      } catch (e) {}

      // 3. Update Dexie local si présent
      try {
        await db.patrons.update(boutique.id, {
          fin_abonnement: nouvelleDateIso,
          subscription_end_date: nouvelleDateIso,
          abonnement_expire: nouvelleDateIso,
          is_active: true,
          forfait: 'PROLONGE',
          subscription_status: 'populaire',
        } as any);
      } catch (e) {}

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
                plan: 'PROLONGE',
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

      await supabase.from('efa_boutiques').delete().eq('id', boutique.id);
      await supabase.from('patrons').delete().eq('id', boutique.id);

      showToast(`Boutique "${boutique.nom_boutique}" supprimée`, 'info');
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
      const matchPhone = (b.telephone || '').toLowerCase().includes(q);
      const matchPin = (b.pin_code || '').includes(q);

      return matchNom || matchBoutique || matchQuartier || matchPhone || matchPin;
    });
  }, [boutiques, searchQuery, statusFilter]);

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

                  return (
                    <div key={`mob-${b.id}`} className="p-4 space-y-3 bg-white">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <span className="font-black text-slate-900 text-sm block">{b.nom_personne}</span>
                          <span className="text-xs font-bold text-amber-700 flex items-center gap-1">
                            <Store className="w-3.5 h-3.5 text-amber-600" />
                            <span>{b.nom_boutique}</span>
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap justify-end">
                          {(() => {
                            const badge = getPlanBadge(b);
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
                          <span className="font-black text-slate-900 text-xs block">
                            {subEnd ? subEnd.toLocaleDateString('fr-FR') : 'Pas de date'}
                          </span>
                          <span className={`text-[10px] font-black ${isExpired ? 'text-rose-600' : (daysRemaining ?? 0) <= 7 ? 'text-amber-600' : 'text-emerald-600'}`}>
                            {subEnd
                              ? isExpired
                                ? `Expiré il y a ${Math.abs(daysRemaining || 0)} j`
                                : `${daysRemaining} jours restants`
                              : ''}
                          </span>
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

                      {/* 4 BOUTONS D'ACTION SUR MOBILE */}
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
                                <span className="font-black text-slate-900 block">
                                  {b.nom_boutique}
                                </span>
                                <div className="flex items-center gap-2 text-xs text-slate-500 font-bold">
                                  <span>👤 {b.nom_personne}</span>
                                  {b.telephone && <span>• 📞 {b.telephone}</span>}
                                </div>
                                <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                                  {(() => {
                                    const badge = getPlanBadge(b);
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

                          {/* 2. Parrainé par (code + nom) */}
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
                            {subEnd ? (
                              <div>
                                <span className="font-black text-slate-800 block">
                                  {subEnd.toLocaleDateString('fr-FR')}
                                </span>
                                <span
                                  className={`text-[10px] font-black ${
                                    isExpired
                                      ? 'text-rose-600'
                                      : (daysRemaining ?? 0) <= 7
                                      ? 'text-amber-600'
                                      : 'text-emerald-600'
                                  }`}
                                >
                                  {isExpired
                                    ? `Expiré il y a ${Math.abs(daysRemaining || 0)} j`
                                    : `${daysRemaining} jours restants`}
                                </span>
                                <div className="mt-1">
                                  {!b.is_active || b.status === 'bloque' ? (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 text-[10px] font-black uppercase">
                                      Bloqué
                                    </span>
                                  ) : isExpired ? (
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
                            ) : (
                              <span className="text-slate-400 italic">Pas de date</span>
                            )}
                          </td>

                          {/* 7. d) Actions Super Admin */}
                          <td className="py-4 px-4 text-right whitespace-nowrap">
                            <div className="inline-flex items-center justify-end gap-1.5 flex-wrap">
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
