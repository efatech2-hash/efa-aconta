-- Migration: Super Admin Read All & RLS Fix
-- Permet la lecture et l'écriture complète sur boutiques, profiles et referrals pour anon et authenticated

ALTER TABLE public.boutiques ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- Nettoyage des anciennes politiques restrictives
  DROP POLICY IF EXISTS "boutiques_owner_policy" ON public.boutiques;
  DROP POLICY IF EXISTS "super_admin_read_all" ON public.boutiques;
  DROP POLICY IF EXISTS "super_admin_insert_all" ON public.boutiques;
  DROP POLICY IF EXISTS "super_admin_update_all" ON public.boutiques;
  DROP POLICY IF EXISTS "super_admin_delete_all" ON public.boutiques;
  DROP POLICY IF EXISTS "super_admin_all" ON public.boutiques;
  
  DROP POLICY IF EXISTS "profiles_owner_policy" ON public.profiles;
  DROP POLICY IF EXISTS "super_admin_profiles_all" ON public.profiles;
  
  DROP POLICY IF EXISTS "referrals_owner_policy" ON public.referrals;
  DROP POLICY IF EXISTS "super_admin_referrals_all" ON public.referrals;
END $$;

-- Politiques ouvertes pour Super Admin & synchronisation multi-navigateurs
CREATE POLICY "super_admin_read_all" ON public.boutiques
  FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY "super_admin_insert_all" ON public.boutiques
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "super_admin_update_all" ON public.boutiques
  FOR UPDATE TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "super_admin_delete_all" ON public.boutiques
  FOR DELETE TO anon, authenticated
  USING (true);

CREATE POLICY "super_admin_profiles_all" ON public.profiles
  FOR ALL TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "super_admin_referrals_all" ON public.referrals
  FOR ALL TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- Vérifier Realtime sur boutiques, profiles, referrals
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.boutiques;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.referrals;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;
END $$;
