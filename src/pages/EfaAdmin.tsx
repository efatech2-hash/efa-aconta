import React, { useEffect } from 'react';
import { SuperAdminScreen } from '../components/SuperAdminScreen';
import { supabase } from '../lib/supabase';
import { checkAndGiveReferralBonus } from '../lib/ambassadeur';

export async function prolongerAbonnement(patronId: string, daysToAdd: number = 30) {
  const now = new Date();
  let ancienneDateFin = now;
  let existingRawPlan = '';
  let existingAmt = 0;

  try {
    const { data } = await supabase
      .from('patrons')
      .select('fin_abonnement, subscription_end_date, plan, forfait, last_payment_amount')
      .eq('id', patronId)
      .maybeSingle();
    const rawEnd = data?.fin_abonnement || data?.subscription_end_date;
    if (rawEnd) {
      const d = new Date(rawEnd);
      if (!isNaN(d.getTime())) ancienneDateFin = d;
    }
    existingRawPlan = ((data as any)?.plan || (data as any)?.forfait || '').toLowerCase().trim();
    existingAmt = Number((data as any)?.last_payment_amount) || 0;
  } catch {}

  try {
    if (!existingRawPlan) {
      const { data: btqData } = await supabase
        .from('boutiques')
        .select('plan, last_payment_amount')
        .eq('id', patronId)
        .maybeSingle();
      existingRawPlan = (btqData?.plan || '').toLowerCase().trim();
      if (!existingAmt) existingAmt = Number(btqData?.last_payment_amount) || 0;
    }
  } catch {}

  const isExistingPro =
    !existingRawPlan.includes('populaire') &&
    !existingRawPlan.includes('prolonge') &&
    !existingRawPlan.includes('16500') &&
    (existingRawPlan === 'pro' || existingRawPlan.startsWith('pro_') || existingAmt >= 50000);
  const preservedPlan = isExistingPro ? (existingRawPlan || 'pro') : 'populaire';
  const preservedStatus = isExistingPro ? 'pro' : 'populaire';

  const baseDate = ancienneDateFin > now ? ancienneDateFin : now;
  const nouvelleDate = new Date(baseDate.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
  const nouvelleDateIso = nouvelleDate.toISOString();
  console.log("Prolongation OK", nouvelleDate);

  await supabase.from('patrons').update({
    fin_abonnement: nouvelleDateIso,
    statut: 'ACTIF',
    plan: preservedPlan,
    forfait: preservedPlan,
    subscription_status: preservedStatus,
    subscription_end_date: nouvelleDateIso,
    abonnement_expire: nouvelleDateIso,
    is_active: true,
  } as any).eq('id', patronId);

  await supabase.from('boutiques').update({
    plan: preservedPlan,
    subscription_end_date: nouvelleDateIso,
    subscription_end: nouvelleDateIso,
    status: 'active',
    is_active: true,
    updated_at: nouvelleDateIso,
  }).eq('id', patronId);

  return { nouvelle_date: nouvelleDate, nouvelle_date_iso: nouvelleDateIso };
}

export const handleProlonger = prolongerAbonnement;

export async function activerPro1An(patronId: string) {
  const fin = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  await supabase.from('patrons').update({
    plan: 'pro_annuel',
    forfait: 'pro_annuel',
    is_active: true,
    prix: 90000,
    last_payment_amount: 90000,
    fin_abonnement: fin,
    subscription_end: fin,
    subscription_end_date: fin,
    abonnement_expire: fin,
    statut: 'ACTIF',
    subscription_status: 'pro',
  } as any).eq('id', patronId);


  const isAnnuel = true;
  const nowIso = new Date().toISOString();
  const paymentId = 'pay_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);
  const subId = 'sub_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);

  try {
    await supabase.from('payments').insert({
      id: paymentId,
      boutique_id: patronId,
      patron_id: patronId,
      amount: 90000,
      montant: 90000,
      plan: 'pro_annuel',
      status: 'completed',
      payment_method: 'admin_manual',
      created_at: nowIso,
    });
  } catch (e) {}

  try {
    await supabase.from('subscriptions').insert({
      id: subId,
      boutique_id: patronId,
      patron_id: patronId,
      plan: 'pro_annuel',
      status: 'active',
      expires_at: fin,
      subscription_end_date: fin,
      created_at: nowIso,
      updated_at: nowIso,
    });
  } catch (e) {}

  await supabase.from('boutiques').update({
    plan: 'pro_annuel',
    subscription_end: fin,
    subscription_end_date: fin,
    has_paid_annuel: isAnnuel,
    is_active: true,
    status: 'active',
    last_payment_amount: 90000,
    updated_at: nowIso,
  }).eq('id', patronId);

  // Règle d'or ambassadeur : vérifie et donne bonus une seule fois si patron principal filleul
  if (!patronId.startsWith('btq_sub_')) {
    try {
      await checkAndGiveReferralBonus({
        id: patronId,
        plan: 'pro_annuel',
        last_payment_amount: 90000,
        duration_days: 365,
      });
    } catch (e) {}
  }

  return { plan: 'pro_annuel', fin };
}

export async function activer6Mois(patronId: string) {
  const fin = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString();
  await supabase.from('patrons').update({
    plan: 'pro_6mois',
    forfait: 'pro_6mois',
    is_active: true,
    prix: 50000,
    last_payment_amount: 50000,
    fin_abonnement: fin,
    subscription_end: fin,
    subscription_end_date: fin,
    abonnement_expire: fin,
    statut: 'ACTIF',
    subscription_status: 'pro',
  } as any).eq('id', patronId);

  const nowIso = new Date().toISOString();
  const paymentId = 'pay_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);
  const subId = 'sub_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);

  try {
    await supabase.from('payments').insert({
      id: paymentId,
      boutique_id: patronId,
      patron_id: patronId,
      amount: 50000,
      montant: 50000,
      plan: 'pro_6mois',
      status: 'completed',
      payment_method: 'admin_manual',
      created_at: nowIso,
    });
  } catch (e) {}

  try {
    await supabase.from('subscriptions').insert({
      id: subId,
      boutique_id: patronId,
      patron_id: patronId,
      plan: 'pro_6mois',
      status: 'active',
      expires_at: fin,
      subscription_end_date: fin,
      created_at: nowIso,
      updated_at: nowIso,
    });
  } catch (e) {}

  await supabase.from('boutiques').update({
    plan: 'pro_6mois',
    subscription_end: fin,
    subscription_end_date: fin,
    has_paid_annuel: false,
    is_active: true,
    status: 'active',
    last_payment_amount: 50000,
    updated_at: nowIso,
  }).eq('id', patronId);

  return { plan: 'pro_6mois', fin };
}

export async function activerPopulaire1An(patronId: string) {
  const fin = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  await supabase.from('patrons').update({
    plan: 'populaire',
    forfait: 'populaire',
    is_active: true,
    prix: 16500,
    last_payment_amount: 16500,
    fin_abonnement: fin,
    subscription_end: fin,
    subscription_end_date: fin,
    abonnement_expire: fin,
    statut: 'ACTIF',
    subscription_status: 'populaire',
  } as any).eq('id', patronId);

  const nowIso = new Date().toISOString();
  const paymentId = 'pay_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);
  const subId = 'sub_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);

  try {
    await supabase.from('payments').insert({
      id: paymentId,
      boutique_id: patronId,
      patron_id: patronId,
      amount: 16500,
      montant: 16500,
      plan: 'populaire',
      status: 'completed',
      payment_method: 'admin_manual',
      created_at: nowIso,
    });
  } catch (e) {}

  try {
    await supabase.from('subscriptions').insert({
      id: subId,
      boutique_id: patronId,
      patron_id: patronId,
      plan: 'populaire',
      status: 'active',
      expires_at: fin,
      subscription_end_date: fin,
      created_at: nowIso,
      updated_at: nowIso,
    });
  } catch (e) {}

  await supabase.from('boutiques').update({
    plan: 'populaire',
    subscription_end: fin,
    subscription_end_date: fin,
    has_paid_annuel: true,
    is_active: true,
    status: 'active',
    last_payment_amount: 16500,
    updated_at: nowIso,
  }).eq('id', patronId);

  // Règle d'or ambassadeur : vérifie et donne bonus une seule fois si patron principal filleul
  if (!patronId.startsWith('btq_sub_')) {
    try {
      await checkAndGiveReferralBonus({
        id: patronId,
        plan: 'populaire',
        last_payment_amount: 16500,
        duration_days: 365,
      });
    } catch (e) {}
  }

  return { plan: 'populaire', fin };
}

export const EfaAdmin: React.FC<{ onNavigateToClient?: () => void }> = ({ onNavigateToClient }) => {
  useEffect(() => {
    console.log("Route super admin chargée");
  }, []);

  return <SuperAdminScreen onNavigateToClient={onNavigateToClient} />;
};

export default EfaAdmin;

