-- Migration: Parrainage Sync Centralisé & Bonus +2 Mois
-- Date: 2026-11-03

-- 1. Table profiles avec colonnes referral_code, referred_by_code, subscription_end_date
CREATE TABLE IF NOT EXISTS public.profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  nom TEXT,
  nom_boutique TEXT,
  telephone TEXT,
  referral_code TEXT UNIQUE,
  referred_by_code TEXT,
  subscription_end_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ajouter les colonnes requises si la table profiles existait déjà
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='referral_code') THEN
    ALTER TABLE public.profiles ADD COLUMN referral_code TEXT UNIQUE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='referred_by_code') THEN
    ALTER TABLE public.profiles ADD COLUMN referred_by_code TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='subscription_end_date') THEN
    ALTER TABLE public.profiles ADD COLUMN subscription_end_date TIMESTAMPTZ;
  END IF;
END $$;

-- 2. Ajouter les colonnes de parrainage sur la table centrale boutiques
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='boutiques' AND column_name='referral_code') THEN
    ALTER TABLE public.boutiques ADD COLUMN referral_code TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='boutiques' AND column_name='referred_by_code') THEN
    ALTER TABLE public.boutiques ADD COLUMN referred_by_code TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='boutiques' AND column_name='subscription_end_date') THEN
    ALTER TABLE public.boutiques ADD COLUMN subscription_end_date TIMESTAMPTZ;
  END IF;
END $$;

-- 3. Table centrale referrals (id, parrain_id, filleul_id, status: pending/paid, reward_given: bool, created_at)
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

-- Index pour recherche rapide
CREATE INDEX IF NOT EXISTS idx_referrals_parrain_id ON public.referrals(parrain_id);
CREATE INDEX IF NOT EXISTS idx_referrals_filleul_id ON public.referrals(filleul_id);
CREATE INDEX IF NOT EXISTS idx_referrals_status ON public.referrals(status);
CREATE INDEX IF NOT EXISTS idx_profiles_referral_code ON public.profiles(referral_code);
CREATE INDEX IF NOT EXISTS idx_boutiques_referral_code ON public.boutiques(referral_code);

-- 4. Politiques RLS (Row Level Security) permissives pour anon & authenticated
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  DROP POLICY IF EXISTS "Allow anon and auth read profiles" ON public.profiles;
  DROP POLICY IF EXISTS "Allow anon and auth insert profiles" ON public.profiles;
  DROP POLICY IF EXISTS "Allow anon and auth update profiles" ON public.profiles;
  DROP POLICY IF EXISTS "Allow anon and auth all profiles" ON public.profiles;

  DROP POLICY IF EXISTS "Allow anon and auth read referrals" ON public.referrals;
  DROP POLICY IF EXISTS "Allow anon and auth insert referrals" ON public.referrals;
  DROP POLICY IF EXISTS "Allow anon and auth update referrals" ON public.referrals;
  DROP POLICY IF EXISTS "Allow anon and auth all referrals" ON public.referrals;
END $$;

CREATE POLICY "Allow anon and auth all profiles" ON public.profiles
  FOR ALL TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow anon and auth all referrals" ON public.referrals
  FOR ALL TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- 5. Publication Realtime Supabase pour synchronisation instantanée
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.referrals;
    EXCEPTION WHEN duplicate_object THEN
      -- table already in publication
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
    EXCEPTION WHEN duplicate_object THEN
      -- table already in publication
    END;
  END IF;
END $$;

-- 6. RPC: reward_referral_bonus(target_filleul_id)
-- Prolonge de 2 mois (60 jours) le parrain ET le filleul de façon atomique
CREATE OR REPLACE FUNCTION public.reward_referral_bonus(target_filleul_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  ref_row RECORD;
  parrain_row RECORD;
  filleul_row RECORD;
  p_current_end TIMESTAMPTZ;
  f_current_end TIMESTAMPTZ;
  p_new_end TIMESTAMPTZ;
  f_new_end TIMESTAMPTZ;
BEGIN
  -- Trouver le parrainage lié au filleul
  SELECT * INTO ref_row FROM public.referrals
  WHERE filleul_id = target_filleul_id
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Aucun parrainage trouvé pour ce filleul');
  END IF;

  IF ref_row.reward_given = TRUE THEN
    RETURN jsonb_build_object('success', false, 'error', 'Bonus +2 mois déjà accordé');
  END IF;

  -- Date de fin actuelle parrain
  SELECT COALESCE(subscription_end_date, NOW()) INTO p_current_end
  FROM public.boutiques WHERE id = ref_row.parrain_id;

  IF p_current_end IS NULL OR p_current_end < NOW() THEN
    p_current_end := NOW();
  END IF;
  p_new_end := p_current_end + INTERVAL '2 months';

  -- Date de fin actuelle filleul
  SELECT COALESCE(subscription_end_date, NOW()) INTO f_current_end
  FROM public.boutiques WHERE id = ref_row.filleul_id;

  IF f_current_end IS NULL OR f_current_end < NOW() THEN
    f_current_end := NOW();
  END IF;
  f_new_end := f_current_end + INTERVAL '2 months';

  -- 1. Mettre à jour referrals
  UPDATE public.referrals
  SET status = 'paid',
      reward_given = TRUE,
      reward_date = NOW()
  WHERE id = ref_row.id;

  -- 2. Mettre à jour parrain dans boutiques et profiles
  UPDATE public.boutiques
  SET subscription_end_date = p_new_end,
      subscription_end = p_new_end::text,
      is_active = TRUE,
      status = 'actif'
  WHERE id = ref_row.parrain_id;

  UPDATE public.profiles
  SET subscription_end_date = p_new_end
  WHERE id = ref_row.parrain_id;

  -- 3. Mettre à jour filleul dans boutiques et profiles
  UPDATE public.boutiques
  SET subscription_end_date = f_new_end,
      subscription_end = f_new_end::text,
      is_active = TRUE,
      status = 'actif'
  WHERE id = ref_row.filleul_id;

  UPDATE public.profiles
  SET subscription_end_date = f_new_end
  WHERE id = ref_row.filleul_id;

  RETURN jsonb_build_object(
    'success', true,
    'referral_id', ref_row.id,
    'parrain_id', ref_row.parrain_id,
    'filleul_id', ref_row.filleul_id,
    'parrain_new_end', p_new_end,
    'filleul_new_end', f_new_end
  );
END;
$$;
