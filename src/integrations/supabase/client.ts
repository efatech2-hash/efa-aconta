import { createClient } from '@supabase/supabase-js';

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL || 'https://ebqhujxkliutkkhgsekd.supabase.co').trim();
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVicWh1anhrbGl1dGtraGdzZWtkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE4NzQ4NTgsImV4cCI6MjEwNzQ1MDg1OH0.3SPfCeZAUUIF7cV2YWMl8EmzbTBiltIivDCgzhAA9tU').trim();

// Validation stricte au démarrage
if (!import.meta.env.VITE_SUPABASE_URL?.includes('supabase.co')) {
  console.error("❌ VITE_SUPABASE_URL invalide:", import.meta.env.VITE_SUPABASE_URL);
}
if (!import.meta.env.VITE_SUPABASE_ANON_KEY?.startsWith('eyJ')) {
  console.error("❌ VITE_SUPABASE_ANON_KEY invalide, elle doit commencer par eyJ");
}

console.log("SUPABASE URL:", import.meta.env.VITE_SUPABASE_URL || supabaseUrl);

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export default supabase;
