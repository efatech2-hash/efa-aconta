-- ==============================================================================
-- Migration: Add whatsapp_number & Sync boutiques schema columns
-- Date: 2026-11-05
-- ==============================================================================

-- 1. S'assurer que TOUTES les colonnes de la table boutiques existent
DO $$
BEGIN
  -- Colonne nom_boutique
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='boutiques' AND column_name='nom_boutique') THEN
    ALTER TABLE public.boutiques ADD COLUMN nom_boutique TEXT;
  END IF;

  -- Colonne nom
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='boutiques' AND column_name='nom') THEN
    ALTER TABLE public.boutiques ADD COLUMN nom TEXT;
  END IF;

  -- Colonne proprietaire
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='boutiques' AND column_name='proprietaire') THEN
    ALTER TABLE public.boutiques ADD COLUMN proprietaire TEXT;
  END IF;

  -- Colonne email
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='boutiques' AND column_name='email') THEN
    ALTER TABLE public.boutiques ADD COLUMN email TEXT;
  END IF;

  -- Colonne telephone
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='boutiques' AND column_name='telephone') THEN
    ALTER TABLE public.boutiques ADD COLUMN telephone TEXT;
  END IF;

  -- Colonne whatsapp_number (NOUVEAU - Obligatoire Inscription)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='boutiques' AND column_name='whatsapp_number') THEN
    ALTER TABLE public.boutiques ADD COLUMN whatsapp_number TEXT;
  END IF;

  -- Colonne pin_code
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='boutiques' AND column_name='pin_code') THEN
    ALTER TABLE public.boutiques ADD COLUMN pin_code TEXT;
  END IF;

  -- Colonne referral_code
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='boutiques' AND column_name='referral_code') THEN
    ALTER TABLE public.boutiques ADD COLUMN referral_code TEXT;
  END IF;

  -- Colonne referred_by_code
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='boutiques' AND column_name='referred_by_code') THEN
    ALTER TABLE public.boutiques ADD COLUMN referred_by_code TEXT;
  END IF;

  -- Colonne plan
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='boutiques' AND column_name='plan') THEN
    ALTER TABLE public.boutiques ADD COLUMN plan TEXT DEFAULT 'essai';
  END IF;

  -- Colonne status
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='boutiques' AND column_name='status') THEN
    ALTER TABLE public.boutiques ADD COLUMN status TEXT DEFAULT 'active';
  END IF;

  -- Colonne subscription_end_date
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='boutiques' AND column_name='subscription_end_date') THEN
    ALTER TABLE public.boutiques ADD COLUMN subscription_end_date TIMESTAMPTZ;
  END IF;

  -- Colonne subscription_end
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='boutiques' AND column_name='subscription_end') THEN
    ALTER TABLE public.boutiques ADD COLUMN subscription_end TIMESTAMPTZ;
  END IF;

  -- Colonne has_paid_annuel
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='boutiques' AND column_name='has_paid_annuel') THEN
    ALTER TABLE public.boutiques ADD COLUMN has_paid_annuel BOOLEAN DEFAULT FALSE;
  END IF;

  -- Colonne created_at
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='boutiques' AND column_name='created_at') THEN
    ALTER TABLE public.boutiques ADD COLUMN created_at TIMESTAMPTZ DEFAULT NOW();
  END IF;

  -- Colonne is_active
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='boutiques' AND column_name='is_active') THEN
    ALTER TABLE public.boutiques ADD COLUMN is_active BOOLEAN DEFAULT TRUE;
  END IF;

  -- Colonne last_payment_amount
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='boutiques' AND column_name='last_payment_amount') THEN
    ALTER TABLE public.boutiques ADD COLUMN last_payment_amount NUMERIC DEFAULT 0;
  END IF;
END $$;

-- 2. Ajouter whatsapp_number sur profiles si existante
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='profiles') THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='whatsapp_number') THEN
      ALTER TABLE public.profiles ADD COLUMN whatsapp_number TEXT;
    END IF;
  END IF;
END $$;

-- 3. Recharger le cache du schéma PostgREST
NOTIFY pgrst, 'reload schema';
