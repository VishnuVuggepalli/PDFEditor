/** Dev-server config for E2E runs: identical to vite.config.ts but proxies
 * /api to a locally started backend (default :8801) instead of the docker
 * stack on :8800. Usage:
 *   PORT=8801 DATA_DIR=$(mktemp -d) go run ./cmd/server   (in backend/)
 *   VITE_PDF_ENGINE=mupdf npx vite --config vite.config.e2e.ts --port 5299
 */
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const backend = process.env.E2E_BACKEND ?? 'http://localhost:8801';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['mupdf'],
  },
  build: {
    target: 'es2022',
  },
  server: {
    proxy: {
      '/api': {
        target: backend,
        changeOrigin: true,
      },
    },
  },
});
