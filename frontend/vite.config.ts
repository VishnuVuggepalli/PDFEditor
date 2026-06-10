import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Dev server proxies /api to the Go backend: the dockerized one on host
// port 8800 by default, or wherever BACKEND_URL points (e.g. CI runs a
// plain `go run` backend on another port).
export default defineConfig({
  plugins: [react()],
  // mupdf engine (VITE_PDF_ENGINE=mupdf):
  // - exclude from prebundling so the dev server serves its native ESM and
  //   the `new URL("mupdf-wasm.wasm", import.meta.url)` lookup resolves into
  //   node_modules; at build time Rollup emits the wasm as an asset.
  // - es2022 build target because dist/mupdf.js uses top-level await.
  //
  // Engine pruning needs no rollup config here: src/pdf/engineLoader.ts
  // guards every mupdf import behind literal import.meta.env.VITE_PDF_ENGINE
  // comparisons, so Vite's define + Rollup treeshaking already drop the
  // mupdf chunks and the ~9.6 MB wasm asset from VITE_PDF_ENGINE=pdfjs
  // builds (the runtime ?engine=/localStorage override degrades to pdf.js
  // there). Default (mupdf) builds keep BOTH engines on purpose: pdf.js is
  // the per-document fallback renderer.
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
        target: process.env.BACKEND_URL || 'http://localhost:8800',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // the parity corpus runs under vitest.parity.config.ts (node env)
    exclude: [...configDefaults.exclude, 'parity/**'],
  },
});
