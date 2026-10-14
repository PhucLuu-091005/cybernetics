import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    root: fileURLToPath(new URL('..', import.meta.url)),
    include: ['eval/**/*.eval.ts'],
    environment: 'node',
    testTimeout: 20_000,
  },
});
