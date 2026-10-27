-- ==============================================================================
-- SCHEMA COMPLET SUPABASE POUR EFA ACONTA (NOUVEAU PROJET VIERGE)
-- À exécuter dans le SQL Editor de votre projet Supabase
-- ==============================================================================

-- 1. Table des Patrons / Profils
CREATE TABLE IF NOT EXISTS public.patrons (
    id TEXT PRIMARY KEY,
    nom TEXT NOT NULL,
    telephone TEXT,
    phone_country TEXT DEFAULT '+228',
    phone_number TEXT,
    phone_full TEXT,
    nom_boutique TEXT DEFAULT 'Ma Boutique',
    pin_hash TEXT,
    pin_code TEXT,
    photo_url TEXT,
    genre TEXT DEFAULT 'femme',
    role TEXT DEFAULT 'patron',
    trial_start_date TIMESTAMPTZ,
    trial_end_date TIMESTAMPTZ,
    subscription_status TEXT DEFAULT 'trial',
    subscription_end_date TIMESTAMPTZ,
    email TEXT,
    auto_logout_after_action BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Table des Employés (Correction 1 & 2 : code_pin inclus)
CREATE TABLE IF NOT EXISTS public.employes (
    id TEXT PRIMARY KEY,
    patron_id TEXT REFERENCES public.patrons(id) ON DELETE CASCADE,
    nom TEXT NOT NULL,
    prenom TEXT,
    telephone TEXT,
    phone_country TEXT DEFAULT '+228',
    phone_number TEXT,
    phone_full TEXT,
    pin_hash TEXT,
    pin_code TEXT,
    code_pin TEXT, -- Code PIN à 4 chiffres visible par le patron
    status TEXT DEFAULT 'active',
    is_active BOOLEAN DEFAULT TRUE,
    genre TEXT DEFAULT 'femme',
    photo_url TEXT,
    role TEXT DEFAULT 'vendeuse',
    subscription_status TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Table du Stock / Produits
CREATE TABLE IF NOT EXISTS public.produits (
    id TEXT PRIMARY KEY,
    patron_id TEXT REFERENCES public.patrons(id) ON DELETE CASCADE,
    nom TEXT NOT NULL,
    photo_url TEXT,
    prix_achat NUMERIC DEFAULT 0,
    prix_vente NUMERIC NOT NULL DEFAULT 0,
    stock_qte INTEGER NOT NULL DEFAULT 0,
    seuil_alerte INTEGER DEFAULT 5,
    categorie TEXT DEFAULT 'Général',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Table des Ventes
CREATE TABLE IF NOT EXISTS public.ventes (
    id TEXT PRIMARY KEY,
    patron_id TEXT REFERENCES public.patrons(id) ON DELETE CASCADE,
    produit_id TEXT,
    produit_nom TEXT,
    qte INTEGER NOT NULL DEFAULT 1,
    montant_total NUMERIC NOT NULL DEFAULT 0,
    client_nom TEXT,
    est_credit BOOLEAN DEFAULT FALSE,
    reste_a_payer NUMERIC DEFAULT 0,
    vendu_par_id TEXT,
    vendu_par_nom TEXT,
    vendu_par_genre TEXT,
    date TIMESTAMPTZ DEFAULT NOW(),
    synced BOOLEAN DEFAULT TRUE
);

-- 5. Table des Dépenses
CREATE TABLE IF NOT EXISTS public.depenses (
    id TEXT PRIMARY KEY,
    patron_id TEXT REFERENCES public.patrons(id) ON DELETE CASCADE,
    type TEXT,
    montant NUMERIC NOT NULL DEFAULT 0,
    description TEXT,
    cree_par TEXT,
    date TIMESTAMPTZ DEFAULT NOW(),
    synced BOOLEAN DEFAULT TRUE
);

-- 6. Table des Crédits / Dettes clients
CREATE TABLE IF NOT EXISTS public.credits (
    id TEXT PRIMARY KEY,
    patron_id TEXT REFERENCES public.patrons(id) ON DELETE CASCADE,
    client_nom TEXT NOT NULL,
    montant_initial NUMERIC NOT NULL DEFAULT 0,
    reste_a_payer NUMERIC NOT NULL DEFAULT 0,
    dernier_paiement TIMESTAMPTZ DEFAULT NOW(),
    synced BOOLEAN DEFAULT TRUE
);

-- 7. Table Historique des actions
CREATE TABLE IF NOT EXISTS public.historique_actions (
    id TEXT PRIMARY KEY,
    patron_id TEXT REFERENCES public.patrons(id) ON DELETE CASCADE,
    user_id TEXT,
    employe_id TEXT,
    employe_nom TEXT,
    action_type TEXT NOT NULL,
    description TEXT NOT NULL,
    montant NUMERIC,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. Table des Parrainages (Programme Ambassadrice)
CREATE TABLE IF NOT EXISTS public.parrainage (
    id TEXT PRIMARY KEY,
    parrain_id TEXT REFERENCES public.patrons(id) ON DELETE CASCADE,
    filleul_id TEXT,
    lien_code TEXT,
    status TEXT DEFAULT 'pending',
    date_parrainage TIMESTAMPTZ DEFAULT NOW()
);

-- 9. Table des Abonnements EFA GARDE / Subscriptions
CREATE TABLE IF NOT EXISTS public.abonnements (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    entreprise_id TEXT NOT NULL,
    statut TEXT NOT NULL DEFAULT 'actif',
    expire_le TIMESTAMPTZ NOT NULL,
    plan TEXT DEFAULT 'populaire',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. Table Subscriptions (EFA ACONTA - Enforce Plan)
CREATE TABLE IF NOT EXISTS public.subscriptions (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    patron_id TEXT REFERENCES public.patrons(id) ON DELETE CASCADE,
    plan TEXT NOT NULL DEFAULT 'free', -- free, trial, populaire, pro, expired
    status TEXT NOT NULL DEFAULT 'active', -- active, trial, expired, canceled
    limit_articles INTEGER NOT NULL DEFAULT 7,
    limit_vendeurs INTEGER NOT NULL DEFAULT 1,
    limit_appareils INTEGER NOT NULL DEFAULT 1,
    limit_boutiques INTEGER NOT NULL DEFAULT 1,
    features JSONB DEFAULT '{}'::jsonb,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 11. Table Boutiques Distinctes
CREATE TABLE IF NOT EXISTS public.boutiques (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    patron_id TEXT REFERENCES public.patrons(id) ON DELETE CASCADE,
    nom TEXT NOT NULL,
    adresse TEXT,
    current_plan TEXT DEFAULT 'free',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 12. Table efa_boutiques (Zero Email / Zero Gmail)
CREATE TABLE IF NOT EXISTS public.efa_boutiques (
    id TEXT PRIMARY KEY,
    nom_boutique TEXT UNIQUE NOT NULL,
    nom_affichage TEXT NOT NULL,
    nom_patron TEXT,
    pin_patron_hash TEXT NOT NULL,
    pin_code TEXT,
    plan TEXT NOT NULL DEFAULT 'essai',
    date_fin_essai TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '21 days'),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 13. Table efa_vendeurs
CREATE TABLE IF NOT EXISTS public.efa_vendeurs (
    id TEXT PRIMARY KEY,
    boutique_id TEXT REFERENCES public.efa_boutiques(id) ON DELETE CASCADE,
    nom TEXT NOT NULL,
    pin_code TEXT NOT NULL,
    pin_hash TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 14. Table efa_devices (Gestion multi-appareils 1/3/5)
CREATE TABLE IF NOT EXISTS public.efa_devices (
    id TEXT PRIMARY KEY,
    boutique_id TEXT REFERENCES public.efa_boutiques(id) ON DELETE CASCADE,
    device_id TEXT NOT NULL,
    device_name TEXT NOT NULL,
    last_seen TIMESTAMPTZ DEFAULT NOW(),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==============================================================================
-- ACTIVATION DE ROW LEVEL SECURITY (RLS) SUR CHAQUE TABLE
-- ==============================================================================
ALTER TABLE public.patrons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.produits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ventes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.depenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.historique_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parrainage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.abonnements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.boutiques ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.efa_boutiques ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.efa_vendeurs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.efa_devices ENABLE ROW LEVEL SECURITY;

-- ==============================================================================
-- POLITIQUES RLS POUR ACCÈS ANONYME / AUTHENTIFIÉ (APPLICATION EFA ACONTA)
-- ==============================================================================
CREATE POLICY "Allow all on patrons" ON public.patrons FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on employes" ON public.employes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on produits" ON public.produits FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on ventes" ON public.ventes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on depenses" ON public.depenses FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on credits" ON public.credits FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on historique_actions" ON public.historique_actions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on parrainage" ON public.parrainage FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on abonnements" ON public.abonnements FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on subscriptions" ON public.subscriptions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on boutiques" ON public.boutiques FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on efa_boutiques" ON public.efa_boutiques FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on efa_vendeurs" ON public.efa_vendeurs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on efa_devices" ON public.efa_devices FOR ALL USING (true) WITH CHECK (true);
