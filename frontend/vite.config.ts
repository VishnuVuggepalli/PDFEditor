import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Dev server proxies /api to the dockerized Go backend (host port 8800).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8800',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
