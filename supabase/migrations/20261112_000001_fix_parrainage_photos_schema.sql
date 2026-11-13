-- Migration: Fix Parrainage columns, Photos Profil columns & efa-photos bucket, Logs Suppression
-- Date: 2026-11-12

-- 1. Colonnes patrons : referred_by, code_parrainage, referral_code, photo_profil, adresse
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='patrons' AND column_name='referred_by') THEN
    ALTER TABLE public.patrons ADD COLUMN referred_by TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='patrons' AND column_name='code_parrainage') THEN
    ALTER TABLE public.patrons ADD COLUMN code_parrainage TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='patrons' AND column_name='referral_code') THEN
    ALTER TABLE public.patrons ADD COLUMN referral_code TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='patrons' AND column_name='photo_profil') THEN
    ALTER TABLE public.patrons ADD COLUMN photo_profil TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='patrons' AND column_name='adresse') THEN
    ALTER TABLE public.patrons ADD COLUMN adresse TEXT;
  END IF;
END $$;

UPDATE public.patrons
SET code_parrainage = COALESCE(code_parrainage, referral_code)
WHERE code_parrainage IS NULL AND referral_code IS NOT NULL;

UPDATE public.patrons
SET photo_profil = COALESCE(photo_profil, photo_url)
WHERE photo_profil IS NULL AND photo_url IS NOT NULL;

-- 2. Colonnes boutiques : photo_profil, photo_devanture, adresse, code_parrainage, referred_by
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='boutiques' AND column_name='photo_profil') THEN
    ALTER TABLE public.boutiques ADD COLUMN photo_profil TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='boutiques' AND column_name='photo_devanture') THEN
    ALTER TABLE public.boutiques ADD COLUMN photo_devanture TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='boutiques' AND column_name='adresse') THEN
    ALTER TABLE public.boutiques ADD COLUMN adresse TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='boutiques' AND column_name='code_parrainage') THEN
    ALTER TABLE public.boutiques ADD COLUMN code_parrainage TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='boutiques' AND column_name='referred_by') THEN
    ALTER TABLE public.boutiques ADD COLUMN referred_by TEXT;
  END IF;
END $$;

-- 3. Colonnes parrainage : parrain_id, filleul_id, boutique_id, date_inscription, lien_code, status, filleul_nom, filleul_phone, mois_gagnes
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='parrainage' AND column_name='filleul_id') THEN
    ALTER TABLE public.parrainage ADD COLUMN filleul_id TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='parrainage' AND column_name='boutique_id') THEN
    ALTER TABLE public.parrainage ADD COLUMN boutique_id TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='parrainage' AND column_name='date_inscription') THEN
    ALTER TABLE public.parrainage ADD COLUMN date_inscription TIMESTAMPTZ DEFAULT NOW();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='parrainage' AND column_name='filleul_nom') THEN
    ALTER TABLE public.parrainage ADD COLUMN filleul_nom TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='parrainage' AND column_name='filleul_phone') THEN
    ALTER TABLE public.parrainage ADD COLUMN filleul_phone TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='parrainage' AND column_name='mois_gagnes') THEN
    ALTER TABLE public.parrainage ADD COLUMN mois_gagnes INTEGER DEFAULT 0;
  END IF;
END $$;

ALTER TABLE IF EXISTS public.parrainage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_parrainage" ON public.parrainage;
CREATE POLICY "allow_all_parrainage" ON public.parrainage FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- 4. Table logs_suppression (pour suppression vente à crédit avec client_nom)
CREATE TABLE IF NOT EXISTS public.logs_suppression (
  id TEXT PRIMARY KEY,
  patron_id TEXT,
  boutique_id TEXT,
  vente_id TEXT,
  ticket_id TEXT,
  produit_nom TEXT,
  qte INTEGER DEFAULT 1,
  montant NUMERIC DEFAULT 0,
  client_nom TEXT,
  raison TEXT,
  supprime_par TEXT,
  date TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE IF EXISTS public.logs_suppression ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_logs_suppression" ON public.logs_suppression;
CREATE POLICY "allow_all_logs_suppression" ON public.logs_suppression FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- 5. Bucket Storage public 'efa-photos' (photos profil patron & boutique)
INSERT INTO storage.buckets (id, name, public)
VALUES ('efa-photos', 'efa-photos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "efa_photos_public_read" ON storage.objects;
CREATE POLICY "efa_photos_public_read"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'efa-photos');

DROP POLICY IF EXISTS "efa_photos_public_insert" ON storage.objects;
CREATE POLICY "efa_photos_public_insert"
  ON storage.objects FOR INSERT
  TO anon, authenticated
  WITH CHECK (bucket_id = 'efa-photos');

DROP POLICY IF EXISTS "efa_photos_public_update" ON storage.objects;
CREATE POLICY "efa_photos_public_update"
  ON storage.objects FOR UPDATE
  TO anon, authenticated
  USING (bucket_id = 'efa-photos')
  WITH CHECK (bucket_id = 'efa-photos');

DROP POLICY IF EXISTS "efa_photos_public_delete" ON storage.objects;
CREATE POLICY "efa_photos_public_delete"
  ON storage.objects FOR DELETE
  TO anon, authenticated
  USING (bucket_id = 'efa-photos');

NOTIFY pgrst, 'reload schema';
