import { createClient } from '@supabase/supabase-js';

const supabaseUrl = (process.env.VITE_SUPABASE_URL || 'https://ebqhujxkliutkkhgsekd.supabase.co').trim();
const supabaseKey = (process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '').trim();
const supabase = createClient(supabaseUrl, supabaseKey);

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-admin-token');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { data: boutiquesData, error } = await supabase
      .from('boutiques')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[API Boutiques] Erreur Supabase:', error);
      return res.status(500).json({ success: false, error: error.message });
    }

    const boutiques = (boutiquesData || []).map((b: any) => ({
      id: b.id,
      nom_personne: b.proprietaire || b.nom_patron || 'Patron',
      nom_boutique: b.nom_boutique || 'Ma Boutique',
      pin_code: b.pin_code || '----',
      quartier: b.quartier || '',
      telephone: b.telephone || '',
      status: b.status || (b.is_active === false ? 'bloque' : 'actif'),
      is_active: b.is_active !== false,
      subscription_end: b.subscription_end || b.subscription_end_date || null,
      subscription_end_date: b.subscription_end_date || b.subscription_end || null,
      referral_code: b.referral_code,
      referred_by: b.referred_by || b.referred_by_code || null,
      has_paid_annuel: Boolean(b.has_paid_annuel),
      plan: b.plan || 'essai',
      last_payment_amount: Number(b.last_payment_amount) || 0,
      created_at: b.created_at,
      source: 'boutiques',
    }));

    const total_boutiques = boutiques.length;
    const actives = boutiques.filter((b: any) => b.is_active && b.status !== 'expire' && b.status !== 'bloque').length;
    const expirees = boutiques.filter((b: any) => b.status === 'expire').length;
    const revenu_total = boutiques.reduce((sum: number, b: any) => sum + (Number(b.last_payment_amount) || 0), 0);

    return res.status(200).json({
      success: true,
      stats: { total_boutiques, actives, expirees, revenu_total },
      boutiques,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
