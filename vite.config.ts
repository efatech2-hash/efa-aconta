import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(env.VITE_SUPABASE_URL || 'https://ebqhujxkliutkkhgsekd.supabase.co'),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVicWh1anhrbGl1dGtraGdzZWtkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE4NzQ4NTgsImV4cCI6MjEwNzQ1MDg1OH0.3SPfCeZAUUIF7cV2YWMl8EmzbTBiltIivDCgzhAA9tU'),
      'process.env.SUPER_ADMIN_EMAIL': JSON.stringify(env.SUPER_ADMIN_EMAIL || process.env.SUPER_ADMIN_EMAIL || ''),
      'process.env.SUPER_ADMIN_PASSWORD': JSON.stringify(env.SUPER_ADMIN_PASSWORD || process.env.SUPER_ADMIN_PASSWORD || ''),
      'process.env.WHATSAPP_NUMBER': JSON.stringify(env.WHATSAPP_NUMBER || process.env.WHATSAPP_NUMBER || '22896100972'),
      'process.env.VITE_WHATSAPP_NUMBER': JSON.stringify(env.WHATSAPP_NUMBER || '22896100972'),
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
