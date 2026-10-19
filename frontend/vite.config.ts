import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the Vite server proxies /api to the Express backend, so the
// browser only ever talks to one origin (same as production).
const apiTarget = process.env.VITE_API_PROXY ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // reachable from other office PCs during testing
    port: 5173,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: false, secure: false },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        // Libraries change less often than app code, so they stay cached across app updates
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          mantine: ['@mantine/core', '@mantine/hooks', '@mantine/notifications'],
          dates: ['@mantine/dates', 'dayjs'],
        },
      },
    },
  },
});
