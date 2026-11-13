-- Migration: Referral +60 days goes STRICTLY to parrain only (never filleul), once per main patron
-- Date: 2026-11-12

CREATE OR REPLACE FUNCTION public.reward_referral_bonus(target_filleul_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  ref_row RECORD;
  parr_row RECORD;
  p_current_end TIMESTAMPTZ;
  p_new_end TIMESTAMPTZ;
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

  -- Date de fin actuelle PARRAIN SEUL (+60 jours)
  SELECT COALESCE(subscription_end_date, NOW()) INTO p_current_end
  FROM public.boutiques WHERE id = ref_row.parrain_id;

  IF p_current_end IS NULL OR p_current_end < NOW() THEN
    p_current_end := NOW();
  END IF;
  p_new_end := p_current_end + INTERVAL '60 days';

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

  -- 2. Prolonger PARRAIN SEUL (+60 jours) — jamais le filleul (il paye 11 mois au lieu de 12)
  UPDATE public.boutiques
  SET subscription_end_date = p_new_end,
      subscription_end = p_new_end::text,
      is_active = TRUE,
      status = 'active'
  WHERE id = ref_row.parrain_id;

  UPDATE public.profiles
  SET subscription_end_date = p_new_end
  WHERE id = ref_row.parrain_id;

  UPDATE public.patrons
  SET subscription_end_date = p_new_end,
      subscription_end = p_new_end::text,
      fin_abonnement = p_new_end::text,
      abonnement_expire = p_new_end::text,
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
    'parrain_new_end', p_new_end
  );
END;
$$;
