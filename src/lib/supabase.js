import { createClient } from '@supabase/supabase-js';

const env = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : (typeof process !== 'undefined' ? process.env : {});
const supabaseUrl = (env.VITE_SUPABASE_URL || 'https://ebqhujxkliutkkhgsekd.supabase.co').trim();
const supabaseAnonKey = (env.VITE_SUPABASE_ANON_KEY || '').trim();

if (!supabaseAnonKey) {
  console.warn("⚠️ [Security] VITE_SUPABASE_ANON_KEY manquante dans l'environnement.");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export default supabase;
