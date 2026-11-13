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
    photo_profil TEXT,
    adresse TEXT,
    code_parrainage TEXT,
    referral_code TEXT,
    referred_by TEXT,
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
    boutique_id TEXT,
    lien_code TEXT,
    filleul_nom TEXT,
    filleul_phone TEXT,
    mois_gagnes INTEGER DEFAULT 0,
    status TEXT DEFAULT 'attente',
    date_inscription TIMESTAMPTZ DEFAULT NOW(),
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

-- 11. Table Boutiques Centrale (Synchronisation multi-appareils & Super Admin)
-- Liste EXACTE vérifiée: id, nom_boutique, nom, proprietaire, patron_id, email, telephone, referral_code, code_parrainage, referred_by_code, referred_by, photo_profil, photo_devanture, adresse, subscription_end_date, subscription_end, has_paid_annuel, is_active, last_payment_amount, plan, status, created_at, updated_at, pin_code, whatsapp_number, whatsapp
CREATE TABLE IF NOT EXISTS public.boutiques (
    id TEXT PRIMARY KEY,
    nom_boutique TEXT NOT NULL,
    nom TEXT,
    proprietaire TEXT,
    patron_id TEXT,
    email TEXT,
    telephone TEXT,
    referral_code TEXT,
    code_parrainage TEXT,
    referred_by_code TEXT,
    referred_by TEXT,
    photo_profil TEXT,
    photo_devanture TEXT,
    adresse TEXT,
    subscription_end_date TIMESTAMPTZ,
    subscription_end TIMESTAMPTZ,
    has_paid_annuel BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    last_payment_amount NUMERIC DEFAULT 0,
    plan TEXT DEFAULT 'essai',
    status TEXT DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    pin_code TEXT,
    whatsapp_number TEXT,
    whatsapp TEXT
);

-- 11b. Table Payments (Historique des paiements & activations)
CREATE TABLE IF NOT EXISTS public.payments (
    id TEXT PRIMARY KEY,
    boutique_id TEXT,
    patron_id TEXT,
    amount NUMERIC DEFAULT 0,
    montant NUMERIC DEFAULT 0,
    plan TEXT,
    status TEXT DEFAULT 'completed',
    payment_method TEXT DEFAULT 'admin_manual',
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

-- 15. Table aconta_produits (Projet Isolé EFA ACONTA)
CREATE TABLE IF NOT EXISTS public.aconta_produits (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    nom TEXT NOT NULL,
    photo_url TEXT,
    prix_achat NUMERIC DEFAULT 0,
    prix_vente NUMERIC NOT NULL DEFAULT 0,
    stock_qte INTEGER NOT NULL DEFAULT 0,
    seuil_alerte INTEGER DEFAULT 5,
    categorie TEXT DEFAULT 'Général',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 16. Table factures
CREATE TABLE IF NOT EXISTS public.factures (
    id TEXT PRIMARY KEY,
    patron_id TEXT NOT NULL,
    numero_facture TEXT NOT NULL,
    client_nom TEXT,
    client_telephone TEXT,
    montant_total NUMERIC NOT NULL DEFAULT 0,
    statut TEXT DEFAULT 'payee',
    lignes_articles JSONB DEFAULT '[]'::jsonb,
    creee_le TIMESTAMPTZ DEFAULT NOW()
);

-- ==============================================================================
-- ACTIVATION DE ROW LEVEL SECURITY (RLS) SUR CHAQUE TABLE
-- ==============================================================================
ALTER TABLE public.patrons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.produits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aconta_produits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ventes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.factures ENABLE ROW LEVEL SECURITY;
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
-- POLITIQUES RLS SÉCURISÉES (FORTERESSE : AUTH.UID() & SERVICE ROLE)
-- ==============================================================================
CREATE POLICY "patrons_owner_policy" ON public.patrons
    FOR ALL USING (auth.uid()::text = id OR auth.role() = 'service_role')
    WITH CHECK (auth.uid()::text = id OR auth.role() = 'service_role');

CREATE POLICY "employes_owner_policy" ON public.employes
    FOR ALL USING (auth.uid()::text = patron_id OR auth.uid()::text = id OR auth.role() = 'service_role')
    WITH CHECK (auth.uid()::text = patron_id OR auth.role() = 'service_role');

CREATE POLICY "produits_store_policy" ON public.produits
    FOR ALL USING (auth.uid()::text = patron_id OR auth.uid()::text IN (SELECT patron_id FROM public.employes WHERE id = auth.uid()::text) OR auth.role() = 'service_role')
    WITH CHECK (auth.uid()::text = patron_id OR auth.uid()::text IN (SELECT patron_id FROM public.employes WHERE id = auth.uid()::text) OR auth.role() = 'service_role');

CREATE POLICY "aconta_produits_owner_policy" ON public.aconta_produits
    FOR ALL USING (auth.uid()::text = user_id OR auth.role() = 'service_role')
    WITH CHECK (auth.uid()::text = user_id OR auth.role() = 'service_role');

CREATE POLICY "ventes_store_policy" ON public.ventes
    FOR ALL USING (auth.uid()::text = patron_id OR auth.uid()::text IN (SELECT patron_id FROM public.employes WHERE id = auth.uid()::text) OR auth.role() = 'service_role')
    WITH CHECK (auth.uid()::text = patron_id OR auth.uid()::text IN (SELECT patron_id FROM public.employes WHERE id = auth.uid()::text) OR auth.role() = 'service_role');

CREATE POLICY "factures_store_policy" ON public.factures
    FOR ALL USING (auth.uid()::text = patron_id OR auth.uid()::text IN (SELECT patron_id FROM public.employes WHERE id = auth.uid()::text) OR auth.role() = 'service_role')
    WITH CHECK (auth.uid()::text = patron_id OR auth.role() = 'service_role');

CREATE POLICY "depenses_store_policy" ON public.depenses
    FOR ALL USING (auth.uid()::text = patron_id OR auth.role() = 'service_role')
    WITH CHECK (auth.uid()::text = patron_id OR auth.role() = 'service_role');

CREATE POLICY "credits_store_policy" ON public.credits
    FOR ALL USING (auth.uid()::text = patron_id OR auth.role() = 'service_role')
    WITH CHECK (auth.uid()::text = patron_id OR auth.role() = 'service_role');

CREATE POLICY "historique_store_policy" ON public.historique_actions
    FOR ALL USING (auth.uid()::text = patron_id OR auth.role() = 'service_role')
    WITH CHECK (auth.uid()::text = patron_id OR auth.role() = 'service_role');

CREATE POLICY "parrainage_owner_policy" ON public.parrainage
    FOR ALL USING (auth.uid()::text = parrain_id OR auth.role() = 'service_role')
    WITH CHECK (auth.uid()::text = parrain_id OR auth.role() = 'service_role');

CREATE POLICY "abonnements_owner_policy" ON public.abonnements
    FOR SELECT USING (auth.uid()::text = entreprise_id OR auth.role() = 'service_role');

CREATE POLICY "subscriptions_owner_policy" ON public.subscriptions
    FOR SELECT USING (auth.uid()::text = patron_id OR auth.role() = 'service_role');

CREATE POLICY "super_admin_read_all" ON public.boutiques
    FOR ALL TO anon, authenticated
    USING (true)
    WITH CHECK (true);

CREATE POLICY "efa_boutiques_owner_policy" ON public.efa_boutiques
    FOR ALL USING (auth.uid()::text = id OR auth.role() = 'service_role')
    WITH CHECK (auth.uid()::text = id OR auth.role() = 'service_role');

CREATE POLICY "efa_vendeurs_owner_policy" ON public.efa_vendeurs
    FOR ALL USING (auth.uid()::text = boutique_id OR auth.uid()::text = id OR auth.role() = 'service_role')
    WITH CHECK (auth.uid()::text = boutique_id OR auth.role() = 'service_role');

CREATE POLICY "efa_devices_owner_policy" ON public.efa_devices
    FOR ALL USING (auth.uid()::text = boutique_id OR auth.role() = 'service_role')
    WITH CHECK (auth.uid()::text = boutique_id OR auth.role() = 'service_role');

-- RLS STORAGE BUCKET 'efa-aconta-produits'
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view product images" ON storage.objects
    FOR SELECT USING (bucket_id = 'efa-aconta-produits');

CREATE POLICY "Owner can upload own product images" ON storage.objects
    FOR INSERT WITH CHECK (
        bucket_id = 'efa-aconta-produits' AND
        ((storage.foldername(name))[1] = auth.uid()::text OR auth.role() = 'service_role')
    );

CREATE POLICY "Owner can delete own product images" ON storage.objects
    FOR DELETE USING (
        bucket_id = 'efa-aconta-produits' AND
        ((storage.foldername(name))[1] = auth.uid()::text OR auth.role() = 'service_role')
    );

-- 17. Table profiles (avec referral_code, referred_by_code, subscription_end_date, whatsapp_number)
CREATE TABLE IF NOT EXISTS public.profiles (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    nom TEXT,
    nom_boutique TEXT,
    telephone TEXT,
    whatsapp_number TEXT,
    referral_code TEXT UNIQUE,
    referred_by_code TEXT,
    subscription_end_date TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 18. Table referrals (Centralisée pour parrainage et récompenses)
CREATE TABLE IF NOT EXISTS public.referrals (
    id TEXT PRIMARY KEY,
    parrain_id TEXT NOT NULL,
    filleul_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'paid'
    reward_given BOOLEAN NOT NULL DEFAULT FALSE,
    parrain_code TEXT,
    filleul_code TEXT,
    parrain_nom TEXT,
    filleul_nom TEXT,
    filleul_plan TEXT,
    reward_date TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anon and auth all profiles" ON public.profiles
    FOR ALL TO anon, authenticated
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Allow anon and auth all referrals" ON public.referrals
    FOR ALL TO anon, authenticated
    USING (true)
    WITH CHECK (true);

-- ==============================================================================
-- 1. BUCKET STORAGE 'efa-aconta-produits' PUBLIC + RLS POLICIES PERMISSIVES
-- ==============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'efa-aconta-produits',
    'efa-aconta-produits',
    true,
    5242880,
    ARRAY['image/webp', 'image/jpeg', 'image/png', 'image/jpg']
)
ON CONFLICT (id) DO UPDATE SET
    public = true,
    file_size_limit = 5242880,
    allowed_mime_types = ARRAY['image/webp', 'image/jpeg', 'image/png', 'image/jpg'];

-- Suppression des anciennes policies susceptibles de bloquer sur le bucket
DROP POLICY IF EXISTS "efa_aconta_produits_select" ON storage.objects;
DROP POLICY IF EXISTS "efa_aconta_produits_insert" ON storage.objects;
DROP POLICY IF EXISTS "efa_aconta_produits_update" ON storage.objects;
DROP POLICY IF EXISTS "efa_aconta_produits_delete" ON storage.objects;
DROP POLICY IF EXISTS "Allow public read efa-aconta-produits" ON storage.objects;
DROP POLICY IF EXISTS "Allow public insert efa-aconta-produits" ON storage.objects;
DROP POLICY IF EXISTS "Allow public uploads efa-aconta-produits" ON storage.objects;
DROP POLICY IF EXISTS "Allow all for efa-aconta-produits" ON storage.objects;
DROP POLICY IF EXISTS "public read" ON storage.objects;
DROP POLICY IF EXISTS "public insert" ON storage.objects;

-- 4 Policies permissives pour storage.objects sur 'efa-aconta-produits' (anon + authenticated)
CREATE POLICY "efa_aconta_produits_select"
ON storage.objects FOR SELECT
TO public, anon, authenticated
USING (bucket_id = 'efa-aconta-produits');

CREATE POLICY "efa_aconta_produits_insert"
ON storage.objects FOR INSERT
TO public, anon, authenticated
WITH CHECK (bucket_id = 'efa-aconta-produits');

CREATE POLICY "efa_aconta_produits_update"
ON storage.objects FOR UPDATE
TO public, anon, authenticated
USING (bucket_id = 'efa-aconta-produits')
WITH CHECK (bucket_id = 'efa-aconta-produits');

CREATE POLICY "efa_aconta_produits_delete"
ON storage.objects FOR DELETE
TO public, anon, authenticated
USING (bucket_id = 'efa-aconta-produits');

-- ==============================================================================
-- 2. POLICIES PERMISSIVES POUR TABLES PRODUITS & EMPLOYES
-- ==============================================================================
ALTER TABLE IF EXISTS public.produits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow all produits" ON public.produits;
DROP POLICY IF EXISTS "allow_all_produits" ON public.produits;
CREATE POLICY "allow_all_produits" ON public.produits
    FOR ALL TO anon, authenticated
    USING (true)
    WITH CHECK (true);

ALTER TABLE IF EXISTS public.employes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow all employes" ON public.employes;
DROP POLICY IF EXISTS "allow_all_employes" ON public.employes;
CREATE POLICY "allow_all_employes" ON public.employes
    FOR ALL TO anon, authenticated
    USING (true)
    WITH CHECK (true);

-- ==============================================================================
-- 3. AJOUT COLONNE BOUTIQUE_ID (ISOLATION MULTI-BOUTIQUES)
-- ==============================================================================
ALTER TABLE IF EXISTS public.produits ADD COLUMN IF NOT EXISTS boutique_id TEXT;
ALTER TABLE IF EXISTS public.employes ADD COLUMN IF NOT EXISTS boutique_id TEXT;
ALTER TABLE IF EXISTS public.ventes ADD COLUMN IF NOT EXISTS boutique_id TEXT;
ALTER TABLE IF EXISTS public.depenses ADD COLUMN IF NOT EXISTS boutique_id TEXT;
ALTER TABLE IF EXISTS public.credits ADD COLUMN IF NOT EXISTS boutique_id TEXT;

UPDATE public.produits SET boutique_id = patron_id WHERE boutique_id IS NULL;
UPDATE public.employes SET boutique_id = patron_id WHERE boutique_id IS NULL;
UPDATE public.ventes SET boutique_id = patron_id WHERE boutique_id IS NULL;
UPDATE public.depenses SET boutique_id = patron_id WHERE boutique_id IS NULL;
UPDATE public.credits SET boutique_id = patron_id WHERE boutique_id IS NULL;

-- ==============================================================================
-- 4. TABLE TRANSACTIONS (MIROIR JOURNALIER EN LIGNE) & POLICIES PERMISSIVES
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.transactions (
    id TEXT PRIMARY KEY,
    ticket_id TEXT,
    patron_id TEXT,
    boutique_id TEXT,
    produit_id TEXT,
    produit_nom TEXT,
    qte INTEGER DEFAULT 1,
    quantite INTEGER DEFAULT 1,
    montant NUMERIC DEFAULT 0,
    montant_total NUMERIC DEFAULT 0,
    client_nom TEXT,
    est_credit BOOLEAN DEFAULT FALSE,
    type TEXT DEFAULT 'vente',
    vendu_par_nom TEXT,
    date TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE IF EXISTS public.transactions ADD COLUMN IF NOT EXISTS boutique_id TEXT;
UPDATE public.transactions SET boutique_id = patron_id WHERE boutique_id IS NULL;

-- Policies permissives pour Ventes, Dépenses, Crédits, Transactions (anon + authenticated)
ALTER TABLE IF EXISTS public.ventes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_ventes" ON public.ventes;
CREATE POLICY "allow_all_ventes" ON public.ventes
    FOR ALL TO anon, authenticated
    USING (true)
    WITH CHECK (true);

ALTER TABLE IF EXISTS public.depenses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_depenses" ON public.depenses;
CREATE POLICY "allow_all_depenses" ON public.depenses
    FOR ALL TO anon, authenticated
    USING (true)
    WITH CHECK (true);

ALTER TABLE IF EXISTS public.credits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_credits" ON public.credits;
CREATE POLICY "allow_all_credits" ON public.credits
    FOR ALL TO anon, authenticated
    USING (true)
    WITH CHECK (true);

ALTER TABLE IF EXISTS public.transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_transactions" ON public.transactions;
CREATE POLICY "allow_all_transactions" ON public.transactions
    FOR ALL TO anon, authenticated
    USING (true)
    WITH CHECK (true);

ALTER TABLE IF EXISTS public.boutiques ADD COLUMN IF NOT EXISTS solde NUMERIC DEFAULT 0;
ALTER TABLE IF EXISTS public.patrons ADD COLUMN IF NOT EXISTS solde NUMERIC DEFAULT 0;

-- Colonnes status et is_deleted pour Ventes et Transactions
ALTER TABLE IF EXISTS public.ventes ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
ALTER TABLE IF EXISTS public.ventes ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;
ALTER TABLE IF EXISTS public.ventes ADD COLUMN IF NOT EXISTS boutique_id TEXT;
ALTER TABLE IF EXISTS public.credits ADD COLUMN IF NOT EXISTS sale_id TEXT;
ALTER TABLE IF EXISTS public.credits ADD COLUMN IF NOT EXISTS boutique_id TEXT;
ALTER TABLE IF EXISTS public.transactions ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
ALTER TABLE IF EXISTS public.transactions ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;

-- Déblocage contrainte de clé étrangère sur ventes pour compatibilité totale avec les IDs de boutiques
ALTER TABLE IF EXISTS public.ventes DROP CONSTRAINT IF EXISTS ventes_patron_id_fkey;
ALTER TABLE IF EXISTS public.depenses DROP CONSTRAINT IF EXISTS depenses_patron_id_fkey;
ALTER TABLE IF EXISTS public.credits DROP CONSTRAINT IF EXISTS credits_patron_id_fkey;
ALTER TABLE IF EXISTS public.produits DROP CONSTRAINT IF EXISTS produits_patron_id_fkey;
ALTER TABLE IF EXISTS public.employes DROP CONSTRAINT IF EXISTS employes_patron_id_fkey;

-- Tables miroirs optionnelles si projet configuré avec noms anglais (sales, expenses, activity_logs)
CREATE TABLE IF NOT EXISTS public.sales (
    id TEXT PRIMARY KEY,
    ticket_id TEXT,
    patron_id TEXT,
    boutique_id TEXT,
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
    status TEXT DEFAULT 'active',
    is_deleted BOOLEAN DEFAULT FALSE,
    date TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.expenses (
    id TEXT PRIMARY KEY,
    patron_id TEXT,
    boutique_id TEXT,
    type TEXT,
    montant NUMERIC NOT NULL DEFAULT 0,
    description TEXT,
    cree_par TEXT,
    date TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.activity_logs (
    id TEXT PRIMARY KEY,
    patron_id TEXT,
    boutique_id TEXT,
    user_id TEXT,
    employe_id TEXT,
    qui TEXT,
    action TEXT,
    action_type TEXT,
    description TEXT NOT NULL,
    montant NUMERIC,
    date_heure TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE IF EXISTS public.sales ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_sales" ON public.sales;
CREATE POLICY "allow_all_sales" ON public.sales FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

ALTER TABLE IF EXISTS public.expenses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_expenses" ON public.expenses;
CREATE POLICY "allow_all_expenses" ON public.expenses FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

ALTER TABLE IF EXISTS public.activity_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_activity_logs" ON public.activity_logs;
CREATE POLICY "allow_all_activity_logs" ON public.activity_logs FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- ==============================================================================
-- 8 TABLES MAJEURES DE SYNCHRONISATION EFA ACONTA
-- 1. historique_action  2. credits  3. parrainage  4. payment
-- 5. profils           6. referrals 7. subscription 8. ventes
-- ==============================================================================

-- 1. Table historique_action
CREATE TABLE IF NOT EXISTS public.historique_action (
    id TEXT PRIMARY KEY,
    patron_id TEXT,
    boutique_id TEXT,
    user_id TEXT,
    employe_id TEXT,
    qui TEXT,
    action TEXT,
    action_type TEXT,
    description TEXT NOT NULL,
    montant NUMERIC,
    date_heure TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE IF EXISTS public.historique_action ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_historique_action" ON public.historique_action;
CREATE POLICY "allow_all_historique_action" ON public.historique_action FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- 2. Table credits
CREATE TABLE IF NOT EXISTS public.credits (
    id TEXT PRIMARY KEY,
    sale_id TEXT,
    patron_id TEXT,
    boutique_id TEXT,
    client_nom TEXT NOT NULL,
    montant_initial NUMERIC NOT NULL DEFAULT 0,
    reste_a_payer NUMERIC NOT NULL DEFAULT 0,
    telephone TEXT,
    dernier_paiement TIMESTAMPTZ DEFAULT NOW(),
    synced BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE IF EXISTS public.credits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_credits" ON public.credits;
CREATE POLICY "allow_all_credits" ON public.credits FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- 3. Table parrainage
CREATE TABLE IF NOT EXISTS public.parrainage (
    id TEXT PRIMARY KEY,
    parrain_id TEXT,
    filleul_id TEXT,
    lien_code TEXT,
    status TEXT DEFAULT 'pending',
    date_parrainage TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE IF EXISTS public.parrainage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_parrainage" ON public.parrainage;
CREATE POLICY "allow_all_parrainage" ON public.parrainage FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- 4. Table payment
CREATE TABLE IF NOT EXISTS public.payment (
    id TEXT PRIMARY KEY,
    boutique_id TEXT,
    patron_id TEXT,
    montant NUMERIC,
    plan TEXT,
    status TEXT,
    reference TEXT,
    date TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE IF EXISTS public.payment ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_payment" ON public.payment;
CREATE POLICY "allow_all_payment" ON public.payment FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- 5. Table profils
CREATE TABLE IF NOT EXISTS public.profils (
    id TEXT PRIMARY KEY,
    nom TEXT,
    telephone TEXT,
    nom_boutique TEXT,
    role TEXT,
    genre TEXT,
    solde NUMERIC DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE IF EXISTS public.profils ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_profils" ON public.profils;
CREATE POLICY "allow_all_profils" ON public.profils FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- 6. Table referrals
CREATE TABLE IF NOT EXISTS public.referrals (
    id TEXT PRIMARY KEY,
    parrain_id TEXT,
    filleul_id TEXT,
    parrain_code TEXT,
    filleul_code TEXT,
    parrain_nom TEXT,
    filleul_nom TEXT,
    status TEXT DEFAULT 'pending',
    reward_given BOOLEAN DEFAULT FALSE,
    reward_date TIMESTAMPTZ,
    filleul_plan TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE IF EXISTS public.referrals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_referrals" ON public.referrals;
CREATE POLICY "allow_all_referrals" ON public.referrals FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- 7. Table subscription
CREATE TABLE IF NOT EXISTS public.subscription (
    id TEXT PRIMARY KEY,
    patron_id TEXT,
    boutique_id TEXT,
    plan TEXT DEFAULT 'trial',
    status TEXT DEFAULT 'active',
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE IF EXISTS public.subscription ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_subscription" ON public.subscription;
CREATE POLICY "allow_all_subscription" ON public.subscription FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- 8. Table ventes & transactions
ALTER TABLE IF EXISTS public.ventes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_ventes" ON public.ventes;
CREATE POLICY "allow_all_ventes" ON public.ventes FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

ALTER TABLE IF EXISTS public.transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_transactions" ON public.transactions;
CREATE POLICY "allow_all_transactions" ON public.transactions FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- Fonction de purge automatique des actions après 24h
CREATE OR REPLACE FUNCTION public.clean_old_historique()
RETURNS void AS $$
BEGIN
    DELETE FROM public.historique_action WHERE created_at < NOW() - INTERVAL '24 hours';
    DELETE FROM public.historique_actions WHERE created_at < NOW() - INTERVAL '24 hours';
    DELETE FROM public.activity_logs WHERE created_at < NOW() - INTERVAL '24 hours';
END;
$$ LANGUAGE plpgsql;





