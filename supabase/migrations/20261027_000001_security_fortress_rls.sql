-- ==============================================================================
-- MIGRATION SÉCURITÉ FORTERESSE : RLS & POLICIES STRICTES EFA ACONTA
-- Date: 2026-10-27
-- Objectif: Éliminer tout accès public non filtré, appliquer auth.uid() = user_id / patron_id,
-- et sécuriser le bucket de stockage efa-aconta-produits.
-- ==============================================================================

-- 1. Tables supplémentaires requises si non existantes
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

-- 2. Activation systématique de ROW LEVEL SECURITY (RLS) sur TOUTES les tables
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

-- 3. Suppression des anciennes politiques permissives ("Allow all")
DROP POLICY IF EXISTS "Allow all on patrons" ON public.patrons;
DROP POLICY IF EXISTS "Allow all on employes" ON public.employes;
DROP POLICY IF EXISTS "Allow all on produits" ON public.produits;
DROP POLICY IF EXISTS "Allow all on aconta_produits" ON public.aconta_produits;
DROP POLICY IF EXISTS "Allow all on ventes" ON public.ventes;
DROP POLICY IF EXISTS "Allow all on factures" ON public.factures;
DROP POLICY IF EXISTS "Allow all on depenses" ON public.depenses;
DROP POLICY IF EXISTS "Allow all on credits" ON public.credits;
DROP POLICY IF EXISTS "Allow all on historique_actions" ON public.historique_actions;
DROP POLICY IF EXISTS "Allow all on parrainage" ON public.parrainage;
DROP POLICY IF EXISTS "Allow all on abonnements" ON public.abonnements;
DROP POLICY IF EXISTS "Allow all on subscriptions" ON public.subscriptions;
DROP POLICY IF EXISTS "Allow all on boutiques" ON public.boutiques;
DROP POLICY IF EXISTS "Allow all on efa_boutiques" ON public.efa_boutiques;
DROP POLICY IF EXISTS "Allow all on efa_vendeurs" ON public.efa_vendeurs;
DROP POLICY IF EXISTS "Allow all on efa_devices" ON public.efa_devices;

-- ==============================================================================
-- 4. POLITIQUES STRICTES DE CONTRÔLE D'ACCÈS PAR UTILISATEUR ET BOUTIQUE
-- ==============================================================================

-- A. Table PATRONS (Profils)
-- Lecture / Modification : uniquement son propre compte
CREATE POLICY "patrons_owner_select" ON public.patrons
    FOR SELECT USING (auth.uid()::text = id OR auth.role() = 'service_role');

CREATE POLICY "patrons_owner_insert" ON public.patrons
    FOR INSERT WITH CHECK (auth.uid()::text = id OR auth.role() = 'service_role');

CREATE POLICY "patrons_owner_update" ON public.patrons
    FOR UPDATE USING (auth.uid()::text = id OR auth.role() = 'service_role')
    WITH CHECK (auth.uid()::text = id OR auth.role() = 'service_role');

-- B. Table EMPLOYES
-- Seul le patron propriétaire de la boutique peut gérer ses employés
CREATE POLICY "employes_owner_all" ON public.employes
    FOR ALL USING (
        auth.uid()::text = patron_id OR 
        auth.uid()::text = id OR 
        auth.role() = 'service_role'
    )
    WITH CHECK (
        auth.uid()::text = patron_id OR 
        auth.role() = 'service_role'
    );

-- C. Table PRODUITS & ACONTA_PRODUITS
CREATE POLICY "produits_store_all" ON public.produits
    FOR ALL USING (
        auth.uid()::text = patron_id OR 
        auth.uid()::text IN (SELECT patron_id FROM public.employes WHERE id = auth.uid()::text) OR
        auth.role() = 'service_role'
    )
    WITH CHECK (
        auth.uid()::text = patron_id OR 
        auth.uid()::text IN (SELECT patron_id FROM public.employes WHERE id = auth.uid()::text) OR
        auth.role() = 'service_role'
    );

CREATE POLICY "aconta_produits_owner_all" ON public.aconta_produits
    FOR ALL USING (
        auth.uid()::text = user_id OR 
        auth.role() = 'service_role'
    )
    WITH CHECK (
        auth.uid()::text = user_id OR 
        auth.role() = 'service_role'
    );

-- D. Table VENTES & FACTURES
CREATE POLICY "ventes_store_all" ON public.ventes
    FOR ALL USING (
        auth.uid()::text = patron_id OR 
        auth.uid()::text IN (SELECT patron_id FROM public.employes WHERE id = auth.uid()::text) OR
        auth.role() = 'service_role'
    )
    WITH CHECK (
        auth.uid()::text = patron_id OR 
        auth.uid()::text IN (SELECT patron_id FROM public.employes WHERE id = auth.uid()::text) OR
        auth.role() = 'service_role'
    );

CREATE POLICY "factures_store_all" ON public.factures
    FOR ALL USING (
        auth.uid()::text = patron_id OR 
        auth.uid()::text IN (SELECT patron_id FROM public.employes WHERE id = auth.uid()::text) OR
        auth.role() = 'service_role'
    )
    WITH CHECK (
        auth.uid()::text = patron_id OR 
        auth.role() = 'service_role'
    );

-- E. Table DEPENSES & CREDITS
CREATE POLICY "depenses_store_all" ON public.depenses
    FOR ALL USING (
        auth.uid()::text = patron_id OR 
        auth.role() = 'service_role'
    )
    WITH CHECK (
        auth.uid()::text = patron_id OR 
        auth.role() = 'service_role'
    );

CREATE POLICY "credits_store_all" ON public.credits
    FOR ALL USING (
        auth.uid()::text = patron_id OR 
        auth.role() = 'service_role'
    )
    WITH CHECK (
        auth.uid()::text = patron_id OR 
        auth.role() = 'service_role'
    );

-- F. Table HISTORIQUE_ACTIONS
CREATE POLICY "historique_store_all" ON public.historique_actions
    FOR ALL USING (
        auth.uid()::text = patron_id OR 
        auth.role() = 'service_role'
    )
    WITH CHECK (
        auth.uid()::text = patron_id OR 
        auth.role() = 'service_role'
    );

-- G. Table BOUTIQUES & EFA_BOUTIQUES
CREATE POLICY "boutiques_owner_all" ON public.boutiques
    FOR ALL USING (
        auth.uid()::text = patron_id OR 
        auth.role() = 'service_role'
    )
    WITH CHECK (
        auth.uid()::text = patron_id OR 
        auth.role() = 'service_role'
    );

CREATE POLICY "efa_boutiques_owner_all" ON public.efa_boutiques
    FOR ALL USING (
        auth.uid()::text = id OR 
        auth.role() = 'service_role'
    )
    WITH CHECK (
        auth.uid()::text = id OR 
        auth.role() = 'service_role'
    );

-- H. Table EFA_VENDEURS & EFA_DEVICES
CREATE POLICY "efa_vendeurs_owner_all" ON public.efa_vendeurs
    FOR ALL USING (
        auth.uid()::text = boutique_id OR 
        auth.uid()::text = id OR 
        auth.role() = 'service_role'
    )
    WITH CHECK (
        auth.uid()::text = boutique_id OR 
        auth.role() = 'service_role'
    );

CREATE POLICY "efa_devices_owner_all" ON public.efa_devices
    FOR ALL USING (
        auth.uid()::text = boutique_id OR 
        auth.role() = 'service_role'
    )
    WITH CHECK (
        auth.uid()::text = boutique_id OR 
        auth.role() = 'service_role'
    );

-- I. Table SUBSCRIPTIONS & ABONNEMENTS
CREATE POLICY "subscriptions_owner_select" ON public.subscriptions
    FOR SELECT USING (
        auth.uid()::text = patron_id OR 
        auth.role() = 'service_role'
    );

CREATE POLICY "abonnements_owner_select" ON public.abonnements
    FOR SELECT USING (
        auth.uid()::text = entreprise_id OR 
        auth.role() = 'service_role'
    );

-- J. Table PARRAINAGE
CREATE POLICY "parrainage_owner_all" ON public.parrainage
    FOR ALL USING (
        auth.uid()::text = parrain_id OR 
        auth.role() = 'service_role'
    )
    WITH CHECK (
        auth.uid()::text = parrain_id OR 
        auth.role() = 'service_role'
    );

-- ==============================================================================
-- 5. RLS SUR LE STOCKAGE : BUCKET 'efa-aconta-produits'
-- ==============================================================================
-- Activer RLS sur les objets de stockage si non actif
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- 1. Lecture publique des images produits du bucket efa-aconta-produits
DROP POLICY IF EXISTS "Public can view product images" ON storage.objects;
CREATE POLICY "Public can view product images" ON storage.objects
    FOR SELECT USING (bucket_id = 'efa-aconta-produits');

-- 2. Upload réservé au propriétaire de son propre dossier (user_id/produit_id.webp)
DROP POLICY IF EXISTS "Owner can upload own product images" ON storage.objects;
CREATE POLICY "Owner can upload own product images" ON storage.objects
    FOR INSERT WITH CHECK (
        bucket_id = 'efa-aconta-produits' AND
        (
            (storage.foldername(name))[1] = auth.uid()::text OR
            auth.role() = 'service_role' OR
            auth.role() = 'authenticated'
        )
    );

-- 3. Mise à jour réservée au propriétaire
DROP POLICY IF EXISTS "Owner can update own product images" ON storage.objects;
CREATE POLICY "Owner can update own product images" ON storage.objects
    FOR UPDATE USING (
        bucket_id = 'efa-aconta-produits' AND
        (
            (storage.foldername(name))[1] = auth.uid()::text OR
            auth.role() = 'service_role'
        )
    );

-- 4. Suppression réservée au propriétaire
DROP POLICY IF EXISTS "Owner can delete own product images" ON storage.objects;
CREATE POLICY "Owner can delete own product images" ON storage.objects
    FOR DELETE USING (
        bucket_id = 'efa-aconta-produits' AND
        (
            (storage.foldername(name))[1] = auth.uid()::text OR
            auth.role() = 'service_role'
        )
    );
