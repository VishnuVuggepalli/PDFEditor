import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Dev server proxies /api to the dockerized Go backend (host port 8800).
export default defineConfig({
  plugins: [react()],
  // mupdf engine (VITE_PDF_ENGINE=mupdf):
  // - exclude from prebundling so the dev server serves its native ESM and
  //   the `new URL("mupdf-wasm.wasm", import.meta.url)` lookup resolves into
  //   node_modules; at build time Rollup emits the wasm as an asset.
  // - es2022 build target because dist/mupdf.js uses top-level await.
  optimizeDeps: {
    exclude: ['mupdf'],
  },
  build: {
    target: 'es2022',
  },
  // mupdfWorker.ts must build as an ES-module worker chunk: it (and
  // dist/mupdf.js inside it) uses module imports + top-level await, which
  // the default IIFE worker format cannot represent.
  worker: {
    format: 'es',
  },
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
