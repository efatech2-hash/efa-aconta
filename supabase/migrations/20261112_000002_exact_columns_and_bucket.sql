-- Migration: Exact database column alignment & unified efa-photos bucket
-- Date: 2026-11-12

-- 1. ventes.employee_id
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ventes' AND column_name='employee_id') THEN
    ALTER TABLE public.ventes ADD COLUMN employee_id TEXT;
  END IF;
END $$;

-- 2. logs_suppression.date
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='logs_suppression' AND column_name='date') THEN
    ALTER TABLE public.logs_suppression ADD COLUMN date TIMESTAMPTZ DEFAULT NOW();
  END IF;
END $$;

-- 3. boutiques : photo_url, photo_profil, adresse
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='boutiques' AND column_name='photo_url') THEN
    ALTER TABLE public.boutiques ADD COLUMN photo_url TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='boutiques' AND column_name='photo_profil') THEN
    ALTER TABLE public.boutiques ADD COLUMN photo_profil TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='boutiques' AND column_name='adresse') THEN
    ALTER TABLE public.boutiques ADD COLUMN adresse TEXT;
  END IF;
END $$;

UPDATE public.boutiques
SET photo_url = COALESCE(photo_url, photo_profil, photo_devanture),
    photo_profil = COALESCE(photo_profil, photo_url, photo_devanture)
WHERE (photo_url IS NULL AND (photo_profil IS NOT NULL OR photo_devanture IS NOT NULL))
   OR (photo_profil IS NULL AND (photo_url IS NOT NULL OR photo_devanture IS NOT NULL));

-- 4. patrons : photo_devanture, code_pin, abonnement_expire, photo_url, photo_profil
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='patrons' AND column_name='photo_devanture') THEN
    ALTER TABLE public.patrons ADD COLUMN photo_devanture TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='patrons' AND column_name='code_pin') THEN
    ALTER TABLE public.patrons ADD COLUMN code_pin TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='patrons' AND column_name='abonnement_expire') THEN
    ALTER TABLE public.patrons ADD COLUMN abonnement_expire TIMESTAMPTZ;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='patrons' AND column_name='photo_url') THEN
    ALTER TABLE public.patrons ADD COLUMN photo_url TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='patrons' AND column_name='photo_profil') THEN
    ALTER TABLE public.patrons ADD COLUMN photo_profil TEXT;
  END IF;
END $$;

-- 5. Table aconta_produits
CREATE TABLE IF NOT EXISTS public.aconta_produits (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  patron_id TEXT,
  boutique_id TEXT,
  nom TEXT NOT NULL,
  categorie TEXT DEFAULT 'Général',
  prix_vente NUMERIC DEFAULT 0,
  prix_achat NUMERIC DEFAULT 0,
  stock_qte INTEGER DEFAULT 0,
  seuil_alerte INTEGER DEFAULT 5,
  photo_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE IF EXISTS public.aconta_produits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_aconta_produits" ON public.aconta_produits;
CREATE POLICY "allow_all_aconta_produits" ON public.aconta_produits FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- 6. Bucket unique 'efa-photos' public
INSERT INTO storage.buckets (id, name, public)
VALUES ('efa-photos', 'efa-photos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

NOTIFY pgrst, 'reload schema';
