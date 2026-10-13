import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.BASE_URL;
if (!baseURL) throw new Error('BASE_URL is required: the release walkthrough runs against a running deployment');

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: 'release.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 240_000,
  expect: { timeout: 20_000 },
  reporter: [['list']],
  // A local production check sits behind a self-signed TLS proxy; a live host has a real certificate.
  use: { baseURL, trace: 'retain-on-failure', ignoreHTTPSErrors: process.env.RELEASE_INSECURE_TLS === '1', ...devices['Desktop Chrome'] },
});
