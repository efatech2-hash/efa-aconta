import React, { useEffect } from 'react';
import { SuperAdminScreen } from '../components/SuperAdminScreen';
import { supabase } from '../lib/supabase';
import { checkAndGiveReferralBonus } from '../lib/ambassadeur';

export async function prolongerAbonnement(patronId: string, daysToAdd: number = 30) {
  const now = new Date();
  let ancienneDateFin = now;
  try {
    const { data } = await supabase.from('patrons').select('fin_abonnement, subscription_end_date').eq('id', patronId).maybeSingle();
    const rawEnd = data?.fin_abonnement || data?.subscription_end_date;
    if (rawEnd) {
      const d = new Date(rawEnd);
      if (!isNaN(d.getTime())) ancienneDateFin = d;
    }
  } catch {}

  const baseDate = ancienneDateFin > now ? ancienneDateFin : now;
  const nouvelleDate = new Date(baseDate.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
  const nouvelleDateIso = nouvelleDate.toISOString();
  console.log("Prolongation OK", nouvelleDate);

  await supabase.from('patrons').update({
    fin_abonnement: nouvelleDateIso,
    statut: 'ACTIF',
    forfait: 'PROLONGE',
    subscription_end_date: nouvelleDateIso,
    abonnement_expire: nouvelleDateIso,
    is_active: true,
  } as any).eq('id', patronId);

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

  await supabase.from('efa_boutiques').update({
    plan: 'pro_annuel',
    date_fin_essai: fin,
    is_active: true,
    last_payment_amount: 90000,
  } as any).eq('id', patronId);

  // Règle d'or ambassadeur : vérifie et donne bonus si filleul
  try {
    await checkAndGiveReferralBonus({
      id: patronId,
      plan: 'pro_annuel',
      last_payment_amount: 90000,
      duration_days: 365,
    });
  } catch (e) {}

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

  await supabase.from('efa_boutiques').update({
    plan: 'pro_6mois',
    date_fin_essai: fin,
    is_active: true,
    last_payment_amount: 50000,
  } as any).eq('id', patronId);

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

  await supabase.from('efa_boutiques').update({
    plan: 'populaire',
    date_fin_essai: fin,
    is_active: true,
    last_payment_amount: 16500,
  } as any).eq('id', patronId);

  // Règle d'or ambassadeur : vérifie et donne bonus si filleul
  try {
    await checkAndGiveReferralBonus({
      id: patronId,
      plan: 'populaire',
      last_payment_amount: 16500,
      duration_days: 365,
    });
  } catch (e) {}

  return { plan: 'populaire', fin };
}

export const EfaAdmin: React.FC<{ onNavigateToClient?: () => void }> = ({ onNavigateToClient }) => {
  useEffect(() => {
    console.log("Route super admin chargée");
  }, []);

  return <SuperAdminScreen onNavigateToClient={onNavigateToClient} />;
};

export default EfaAdmin;

