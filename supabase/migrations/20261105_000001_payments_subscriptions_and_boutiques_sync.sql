-- ==============================================================================
-- Migration: Payments, Subscriptions & Boutiques Sync Tables
-- Date: 2026-11-05
-- ==============================================================================

-- 1. Colonnes requises sur la table boutiques
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='boutiques' AND column_name='nom') THEN
    ALTER TABLE public.boutiques ADD COLUMN nom TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='boutiques' AND column_name='pin_code') THEN
    ALTER TABLE public.boutiques ADD COLUMN pin_code TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='boutiques' AND column_name='referral_code') THEN
    ALTER TABLE public.boutiques ADD COLUMN referral_code TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='boutiques' AND column_name='referred_by_code') THEN
    ALTER TABLE public.boutiques ADD COLUMN referred_by_code TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='boutiques' AND column_name='plan') THEN
    ALTER TABLE public.boutiques ADD COLUMN plan TEXT DEFAULT 'essai';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='boutiques' AND column_name='status') THEN
    ALTER TABLE public.boutiques ADD COLUMN status TEXT DEFAULT 'active';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='boutiques' AND column_name='subscription_end_date') THEN
    ALTER TABLE public.boutiques ADD COLUMN subscription_end_date TIMESTAMPTZ;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='boutiques' AND column_name='has_paid_annuel') THEN
    ALTER TABLE public.boutiques ADD COLUMN has_paid_annuel BOOLEAN DEFAULT FALSE;
  END IF;
END $$;

-- 2. Table payments
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

-- 3. Table subscriptions
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  boutique_id TEXT,
  patron_id TEXT,
  plan TEXT NOT NULL DEFAULT 'essai',
  status TEXT NOT NULL DEFAULT 'active',
  limit_articles INTEGER DEFAULT 100,
  limit_vendeurs INTEGER DEFAULT 3,
  limit_appareils INTEGER DEFAULT 3,
  limit_boutiques INTEGER DEFAULT 1,
  features JSONB DEFAULT '{}'::jsonb,
  expires_at TIMESTAMPTZ,
  subscription_end_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. RLS pour payments et subscriptions
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  DROP POLICY IF EXISTS "payments_allow_all" ON public.payments;
  DROP POLICY IF EXISTS "subscriptions_allow_all" ON public.subscriptions;
END $$;

CREATE POLICY "payments_allow_all" ON public.payments
  FOR ALL TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "subscriptions_allow_all" ON public.subscriptions
  FOR ALL TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- 5. Publication Realtime
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.payments;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.subscriptions;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;
END $$;
