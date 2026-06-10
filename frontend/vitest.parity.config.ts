/** Engine-parity harness config: node environment (real mupdf wasm +
 * pdf.js with @napi-rs/canvas), separate from the fast jsdom unit suite.
 * Run: npm run test:parity
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['parity/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
