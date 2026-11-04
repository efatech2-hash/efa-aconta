import { createClient } from '@supabase/supabase-js';

const env = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : (typeof process !== 'undefined' ? process.env : {});
const supabaseUrl = (env.VITE_SUPABASE_URL || 'https://ebqhujxkliutkkhgsekd.supabase.co').trim();
const supabaseAnonKey = (env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || 'dummy_supabase_anon_key_for_offline_and_scripts').trim();

if (!env.VITE_SUPABASE_ANON_KEY && !env.SUPABASE_ANON_KEY) {
  console.warn("⚠️ [Security] VITE_SUPABASE_ANON_KEY manquante dans l'environnement local (configurée sur Vercel en production).");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export default supabase;
