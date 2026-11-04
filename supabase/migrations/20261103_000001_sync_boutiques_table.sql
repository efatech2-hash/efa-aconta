-- ==============================================================================
-- MIGRATION TABLE BOUTIQUES CENTRALE & REALTIME (EFA ACONTA SYNC)
-- Date: 2026-11-03
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.boutiques (
    id TEXT PRIMARY KEY,
    nom_boutique TEXT NOT NULL,
    proprietaire TEXT,
    email TEXT,
    telephone TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    user_id TEXT,
    status TEXT DEFAULT 'actif',
    nom TEXT,
    patron_id TEXT,
    pin_code TEXT,
    plan TEXT DEFAULT 'essai',
    subscription_end TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT TRUE,
    last_payment_amount NUMERIC DEFAULT 0
);

-- Activation de RLS avec politiques publiques permissives pour synchronisation multi-navigateurs
ALTER TABLE public.boutiques ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "boutiques_allow_all" ON public.boutiques;
DROP POLICY IF EXISTS "boutiques_owner_all" ON public.boutiques;
DROP POLICY IF EXISTS "boutiques_insert_policy" ON public.boutiques;
DROP POLICY IF EXISTS "boutiques_select_policy" ON public.boutiques;
DROP POLICY IF EXISTS "boutiques_update_policy" ON public.boutiques;
DROP POLICY IF EXISTS "boutiques_delete_policy" ON public.boutiques;

CREATE POLICY "boutiques_insert_policy" ON public.boutiques
    FOR INSERT TO anon, authenticated
    WITH CHECK (true);

CREATE POLICY "boutiques_select_policy" ON public.boutiques
    FOR SELECT TO anon, authenticated
    USING (true);

CREATE POLICY "boutiques_update_policy" ON public.boutiques
    FOR UPDATE TO anon, authenticated
    USING (true)
    WITH CHECK (true);

CREATE POLICY "boutiques_delete_policy" ON public.boutiques
    FOR DELETE TO anon, authenticated
    USING (true);

-- Activer Realtime sur la table boutiques
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'boutiques'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.boutiques;
  END IF;
EXCEPTION
  WHEN OTHERS THEN NULL;
END $$;
