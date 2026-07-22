import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { host: true, port: 5173 },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor': ['react', 'react-dom', 'react-router-dom'],
          'supabase': ['@supabase/supabase-js'],
          'recharts': ['recharts'],
          'framer': ['framer-motion'],
          'lucide': ['lucide-react']
        }
      }
    },
    chunkSizeWarningLimit: 1000
  }
});
