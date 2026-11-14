-- Migration: Enforce shared patron-wide subscription limits across ALL boutiques (Bug 3)
-- Date: 2026-11-13
-- Rules:
--   * Limits are per patron_id (all stores combined), NEVER per single boutique_id.
--   * Products: essai = 7, populaire = 100, pro = 300 across all boutiques of patron_id.
--   * Employees: essai = 1, populaire = 3, pro = 10 across all boutiques of patron_id.
--   * Existing grandfathered items above the limit are NOT deleted; new inserts are blocked until count < limit.
--   * Updates / upserts of existing IDs and stock decrements are NEVER blocked.

CREATE OR REPLACE FUNCTION public.resolve_patron_root_id(p_patron_id TEXT, p_boutique_id TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_parent TEXT;
BEGIN
  IF p_boutique_id IS NOT NULL AND p_boutique_id <> '' THEN
    SELECT b.patron_id INTO v_parent
    FROM public.boutiques b
    WHERE b.id = p_boutique_id
    LIMIT 1;
    IF v_parent IS NOT NULL AND v_parent <> '' THEN
      RETURN v_parent;
    END IF;
  END IF;

  IF p_patron_id IS NOT NULL AND p_patron_id LIKE 'btq_sub_%' THEN
    SELECT b.patron_id INTO v_parent
    FROM public.boutiques b
    WHERE b.id = p_patron_id
    LIMIT 1;
    IF v_parent IS NOT NULL AND v_parent <> '' THEN
      RETURN v_parent;
    END IF;
  END IF;

  RETURN COALESCE(NULLIF(p_patron_id, ''), NULLIF(p_boutique_id, ''));
END;
$$;

CREATE OR REPLACE FUNCTION public.get_patron_effective_plan(p_owner_id TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_is_pro BOOLEAN := FALSE;
  v_is_populaire BOOLEAN := FALSE;
BEGIN
  IF p_owner_id IS NULL OR p_owner_id = '' THEN
    RETURN 'essai';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.patrons pat
    WHERE pat.id = p_owner_id
      AND (
        LOWER(COALESCE(pat.subscription_status, '')) = 'pro'
        OR LOWER(COALESCE(pat.subscription_status, '')) LIKE 'pro\_%' ESCAPE '\'
        OR (
          LOWER(COALESCE(pat.forfait, '') || ' ' || COALESCE(pat.plan, '')) LIKE '%pro%'
          AND LOWER(COALESCE(pat.forfait, '') || ' ' || COALESCE(pat.plan, '')) NOT LIKE '%prolonge%'
          AND LOWER(COALESCE(pat.forfait, '') || ' ' || COALESCE(pat.plan, '')) NOT LIKE '%populaire%'
          AND LOWER(COALESCE(pat.forfait, '') || ' ' || COALESCE(pat.plan, '')) NOT LIKE '%16500%'
        )
      )
  ) OR EXISTS (
    SELECT 1 FROM public.boutiques b
    WHERE (b.id = p_owner_id OR b.patron_id = p_owner_id)
      AND (
        LOWER(COALESCE(b.plan, '')) = 'pro'
        OR LOWER(COALESCE(b.plan, '')) LIKE 'pro\_%' ESCAPE '\'
        OR COALESCE(b.last_payment_amount, 0) >= 50000
      )
      AND LOWER(COALESCE(b.plan, '')) NOT LIKE '%populaire%'
      AND LOWER(COALESCE(b.plan, '')) NOT LIKE '%prolonge%'
  ) INTO v_is_pro;

  IF v_is_pro THEN
    RETURN 'pro';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.patrons pat
    WHERE pat.id = p_owner_id
      AND (
        LOWER(COALESCE(pat.subscription_status, '') || ' ' || COALESCE(pat.forfait, '') || ' ' || COALESCE(pat.plan, '')) LIKE '%populaire%'
        OR LOWER(COALESCE(pat.forfait, '') || ' ' || COALESCE(pat.plan, '')) LIKE '%16500%'
        OR LOWER(COALESCE(pat.forfait, '') || ' ' || COALESCE(pat.plan, '')) LIKE '%prolonge%'
      )
  ) OR EXISTS (
    SELECT 1 FROM public.boutiques b
    WHERE (b.id = p_owner_id OR b.patron_id = p_owner_id)
      AND (
        LOWER(COALESCE(b.plan, '')) LIKE '%populaire%'
        OR LOWER(COALESCE(b.plan, '')) LIKE '%16500%'
        OR LOWER(COALESCE(b.plan, '')) LIKE '%prolonge%'
      )
  ) INTO v_is_populaire;

  IF v_is_populaire THEN
    RETURN 'populaire';
  END IF;

  RETURN 'essai';
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_shared_patron_product_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_owner_id TEXT;
  v_store_ids TEXT[];
  v_plan TEXT;
  v_limit INTEGER;
  v_count INTEGER;
BEGIN
  -- Autoriser les updates / upserts sur un produit déjà existant (ne jamais bloquer édition ou vente sur surplus ancien)
  IF NEW.id IS NOT NULL AND EXISTS (SELECT 1 FROM public.produits WHERE id = NEW.id) THEN
    RETURN NEW;
  END IF;

  -- Ignorer les insertions déjà marquées supprimées
  IF LOWER(COALESCE(NEW.status, 'active')) = 'deleted' OR COALESCE(NEW.is_deleted, FALSE) = TRUE THEN
    RETURN NEW;
  END IF;

  v_owner_id := public.resolve_patron_root_id(NEW.patron_id, NEW.boutique_id);
  IF v_owner_id IS NULL OR v_owner_id = '' THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(ARRAY_AGG(DISTINCT b.id), ARRAY[]::TEXT[]) || v_owner_id
  INTO v_store_ids
  FROM public.boutiques b
  WHERE b.id = v_owner_id OR b.patron_id = v_owner_id;

  v_plan := public.get_patron_effective_plan(v_owner_id);
  v_limit := CASE v_plan
    WHEN 'pro' THEN 300
    WHEN 'populaire' THEN 100
    ELSE 7
  END;

  SELECT COUNT(DISTINCT p.id) INTO v_count
  FROM public.produits p
  WHERE (
    p.patron_id = v_owner_id
    OR p.patron_id = ANY(v_store_ids)
    OR p.boutique_id = ANY(v_store_ids)
  )
    AND LOWER(COALESCE(p.status, 'active')) <> 'deleted'
    AND COALESCE(p.is_deleted, FALSE) = FALSE;

  IF v_count >= v_limit THEN
    RAISE EXCEPTION 'Limite de produits atteinte pour votre abonnement (%/%). Supprimez un produit ou passez à un plan supérieur.', v_limit, v_limit
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_shared_patron_product_limit ON public.produits;
CREATE TRIGGER trg_enforce_shared_patron_product_limit
BEFORE INSERT ON public.produits
FOR EACH ROW
EXECUTE FUNCTION public.enforce_shared_patron_product_limit();

CREATE OR REPLACE FUNCTION public.enforce_shared_patron_employe_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_owner_id TEXT;
  v_store_ids TEXT[];
  v_plan TEXT;
  v_limit INTEGER;
  v_count INTEGER;
BEGIN
  -- Autoriser les updates / upserts sur un employé existant
  IF NEW.id IS NOT NULL AND EXISTS (SELECT 1 FROM public.employes WHERE id = NEW.id) THEN
    RETURN NEW;
  END IF;

  IF LOWER(COALESCE(NEW.status, 'active')) = 'deleted' OR COALESCE(NEW.is_deleted, FALSE) = TRUE THEN
    RETURN NEW;
  END IF;

  v_owner_id := public.resolve_patron_root_id(NEW.patron_id, NEW.boutique_id);
  IF v_owner_id IS NULL OR v_owner_id = '' THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(ARRAY_AGG(DISTINCT b.id), ARRAY[]::TEXT[]) || v_owner_id
  INTO v_store_ids
  FROM public.boutiques b
  WHERE b.id = v_owner_id OR b.patron_id = v_owner_id;

  v_plan := public.get_patron_effective_plan(v_owner_id);
  v_limit := CASE v_plan
    WHEN 'pro' THEN 10
    WHEN 'populaire' THEN 3
    ELSE 1
  END;

  SELECT COUNT(DISTINCT e.id) INTO v_count
  FROM public.employes e
  WHERE (
    e.patron_id = v_owner_id
    OR e.patron_id = ANY(v_store_ids)
    OR e.boutique_id = ANY(v_store_ids)
  )
    AND LOWER(COALESCE(e.status, 'active')) <> 'deleted'
    AND COALESCE(e.is_deleted, FALSE) = FALSE;

  IF v_count >= v_limit THEN
    RAISE EXCEPTION 'Limite d''employés atteinte (%/%).', v_limit, v_limit
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_shared_patron_employe_limit ON public.employes;
CREATE TRIGGER trg_enforce_shared_patron_employe_limit
BEFORE INSERT ON public.employes
FOR EACH ROW
EXECUTE FUNCTION public.enforce_shared_patron_employe_limit();
