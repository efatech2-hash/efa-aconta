-- Migration: Fix referral bonus preserving active plan (never resetting to essai 21j) + Atomic stock decrement RPC
-- Date: 2026-11-13

CREATE OR REPLACE FUNCTION public.reward_referral_bonus(target_filleul_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  ref_row RECORD;
  parr_row RECORD;
  btq_row RECORD;
  pat_row RECORD;
  p_current_end TIMESTAMPTZ := NOW();
  candidate_ts TIMESTAMPTZ;
  p_new_end TIMESTAMPTZ;
  p_raw_plan TEXT := '';
  p_preserved_plan TEXT := 'essai';
  p_preserved_sub_status TEXT := 'trial';
  p_is_populaire BOOLEAN := FALSE;
  p_is_pro BOOLEAN := FALSE;
BEGIN
  -- Jamais pour les boutiques secondaires btq_sub_...
  IF target_filleul_id IS NULL OR target_filleul_id LIKE 'btq_sub_%' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Boutique secondaire non éligible au bonus parrainage');
  END IF;

  -- Vérifier parrainage WHERE filleul_id = patron_principal : si déjà validé/récompensé, ne redonne pas
  SELECT * INTO parr_row FROM public.parrainage
  WHERE filleul_id = target_filleul_id
    AND (status IN ('valide', 'paid') OR COALESCE(mois_gagnes, 0) > 0 OR date_abo_1an IS NOT NULL)
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Bonus +60 jours déjà accordé pour ce filleul');
  END IF;

  -- Trouver le parrainage lié au filleul
  SELECT * INTO ref_row FROM public.referrals
  WHERE filleul_id = target_filleul_id
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Aucun parrainage trouvé pour ce filleul');
  END IF;

  IF ref_row.reward_given = TRUE THEN
    RETURN jsonb_build_object('success', false, 'error', 'Bonus +60 jours déjà accordé');
  END IF;

  -- Lire BOTH boutiques ET patrons du parrain pour ne jamais perdre son plan ni sa vraie date d'expiration
  SELECT * INTO btq_row FROM public.boutiques WHERE id = ref_row.parrain_id LIMIT 1;
  SELECT * INTO pat_row FROM public.patrons WHERE id = ref_row.parrain_id LIMIT 1;

  -- Prendre la date d'expiration maximale future parmi toutes les colonnes boutiques & patrons
  p_current_end := NOW();
  FOR candidate_ts IN
    SELECT ts FROM (VALUES
      (btq_row.subscription_end_date),
      (NULLIF(btq_row.subscription_end::text, '')::timestamptz),
      (pat_row.subscription_end_date),
      (NULLIF(pat_row.subscription_end::text, '')::timestamptz),
      (NULLIF(pat_row.fin_abonnement::text, '')::timestamptz),
      (NULLIF(pat_row.abonnement_expire::text, '')::timestamptz)
    ) AS v(ts)
    WHERE ts IS NOT NULL
  LOOP
    IF candidate_ts > p_current_end THEN
      p_current_end := candidate_ts;
    END IF;
  END LOOP;

  p_new_end := p_current_end + INTERVAL '60 days';

  -- Déterminer le plan réel du parrain (populaire ou pro prioritaire sur essai/trial)
  p_raw_plan := LOWER(TRIM(COALESCE(
    NULLIF(btq_row.plan::text, ''),
    NULLIF(pat_row.plan::text, ''),
    NULLIF(pat_row.forfait::text, ''),
    NULLIF(pat_row.subscription_status::text, ''),
    ''
  )));

  -- Si btq_row.plan était vide/essai mais patrons contient populaire ou pro, utiliser patrons
  IF p_raw_plan IN ('', 'essai', 'trial', 'expired') THEN
    p_raw_plan := LOWER(TRIM(COALESCE(
      NULLIF(pat_row.forfait::text, ''),
      NULLIF(pat_row.subscription_status::text, ''),
      NULLIF(pat_row.plan::text, ''),
      p_raw_plan
    )));
  END IF;

  IF p_raw_plan LIKE '%populaire%' OR p_raw_plan LIKE '%16500%' OR p_raw_plan LIKE '%prolonge%' THEN
    p_is_populaire := TRUE;
    p_preserved_plan := 'populaire';
    p_preserved_sub_status := 'populaire';
  ELSIF p_raw_plan = 'pro' OR (p_raw_plan LIKE 'pro\_%' ESCAPE '\') OR (p_raw_plan LIKE '%pro%' AND p_raw_plan NOT LIKE '%prolonge%') OR COALESCE(btq_row.last_payment_amount, 0) >= 50000 THEN
    p_is_pro := TRUE;
    p_preserved_plan := COALESCE(NULLIF(btq_row.plan::text, ''), NULLIF(pat_row.forfait::text, ''), 'pro');
    IF LOWER(p_preserved_plan) IN ('', 'essai', 'trial') THEN
      p_preserved_plan := 'pro';
    END IF;
    p_preserved_sub_status := 'pro';
  ELSE
    p_preserved_plan := COALESCE(NULLIF(btq_row.plan::text, ''), 'essai');
    p_preserved_sub_status := 'trial';
  END IF;

  -- 1. Mettre à jour referrals & parrainage
  UPDATE public.referrals
  SET status = 'paid',
      reward_given = TRUE,
      reward_date = NOW()
  WHERE id = ref_row.id;

  UPDATE public.parrainage
  SET status = 'valide',
      mois_gagnes = 2,
      date_abo_1an = NOW()
  WHERE filleul_id = target_filleul_id;

  -- 2. Prolonger PARRAIN SEUL (+60 jours) EN CONSERVANT SON PLAN ACTUEL
  UPDATE public.boutiques
  SET subscription_end_date = p_new_end,
      subscription_end = p_new_end::text,
      plan = p_preserved_plan,
      is_active = TRUE,
      status = 'active',
      updated_at = NOW()
  WHERE id = ref_row.parrain_id;

  -- Si PRO, synchroniser aussi la date d'expiration des éventuelles boutiques secondaires
  IF p_is_pro THEN
    UPDATE public.boutiques
    SET subscription_end_date = p_new_end,
        subscription_end = p_new_end::text,
        plan = p_preserved_plan,
        is_active = TRUE,
        status = 'active',
        updated_at = NOW()
    WHERE patron_id = ref_row.parrain_id AND id <> ref_row.parrain_id;
  END IF;

  UPDATE public.profiles
  SET subscription_end_date = p_new_end
  WHERE id = ref_row.parrain_id;

  UPDATE public.patrons
  SET subscription_end_date = p_new_end,
      subscription_end = p_new_end::text,
      fin_abonnement = p_new_end::text,
      abonnement_expire = p_new_end::text,
      subscription_status = p_preserved_sub_status,
      plan = p_preserved_plan,
      forfait = p_preserved_plan,
      is_active = TRUE,
      statut = 'ACTIF'
  WHERE id = ref_row.parrain_id;

  -- 3. Marquer le filleul sans prolonger sa date d'expiration
  UPDATE public.boutiques
  SET referral_bonus_given = TRUE,
      has_paid_annuel = TRUE
  WHERE id = target_filleul_id;

  UPDATE public.patrons
  SET referral_bonus_given = TRUE,
      has_paid_annuel = TRUE
  WHERE id = target_filleul_id;

  RETURN jsonb_build_object(
    'success', true,
    'referral_id', ref_row.id,
    'parrain_id', ref_row.parrain_id,
    'filleul_id', ref_row.filleul_id,
    'preserved_plan', p_preserved_plan,
    'parrain_new_end', p_new_end
  );
END;
$$;

-- Décrémentation atomique sécurisée du stock (anti double-vente simultanée sur le dernier article)
CREATE OR REPLACE FUNCTION public.decrement_product_stock(
  p_product_id TEXT,
  p_boutique_id TEXT,
  p_qty INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_stock INTEGER;
  v_current_stock INTEGER;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Quantité invalide');
  END IF;

  UPDATE public.produits
  SET stock_qte = stock_qte - p_qty
  WHERE id = p_product_id
    AND (
      p_boutique_id IS NULL
      OR p_boutique_id = ''
      OR boutique_id = p_boutique_id
      OR (boutique_id IS NULL AND patron_id = p_boutique_id)
    )
    AND stock_qte >= p_qty
  RETURNING stock_qte INTO v_new_stock;

  IF NOT FOUND THEN
    SELECT stock_qte INTO v_current_stock
    FROM public.produits
    WHERE id = p_product_id
      AND (
        p_boutique_id IS NULL
        OR p_boutique_id = ''
        OR boutique_id = p_boutique_id
        OR (boutique_id IS NULL AND patron_id = p_boutique_id)
      )
    LIMIT 1;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'Produit introuvable dans cette boutique');
    END IF;

    RETURN jsonb_build_object(
      'success', false,
      'available_stock', COALESCE(v_current_stock, 0),
      'error', 'Stock insuffisant'
    );
  END IF;

  -- Synchroniser le miroir aconta_produits s'il existe
  BEGIN
    UPDATE public.aconta_produits
    SET stock_qte = v_new_stock
    WHERE id = p_product_id;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'success', true,
    'new_stock', v_new_stock
  );
END;
$$;
