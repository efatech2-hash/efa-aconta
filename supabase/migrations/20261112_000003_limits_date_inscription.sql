-- Migration: Ensure patrons.date_inscription exists & backfill from created_at
-- Date: 2026-11-12

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'patrons' AND column_name = 'date_inscription'
  ) THEN
    ALTER TABLE public.patrons ADD COLUMN date_inscription TIMESTAMPTZ DEFAULT NOW();
  END IF;
END $$;

UPDATE public.patrons
SET date_inscription = COALESCE(date_inscription, created_at, NOW())
WHERE date_inscription IS NULL;

-- Ensure parrainage.filleul_id has no duplicate entries (keep earliest / validated one if any)
DELETE FROM public.parrainage a
USING public.parrainage b
WHERE a.ctid > b.ctid
  AND a.filleul_id IS NOT NULL
  AND a.filleul_id = b.filleul_id
  AND (b.status = 'valide' OR COALESCE(b.mois_gagnes, 0) > 0 OR a.status <> 'valide');

NOTIFY pgrst, 'reload schema';
