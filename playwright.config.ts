import { randomBytes, randomUUID } from 'node:crypto';
import { defineConfig, devices } from '@playwright/test';
import { testDatabaseUrl } from './tests/support/db';

const admin = process.env.TEST_DATABASE_URL;
if (!admin)
  throw new Error(
    'TEST_DATABASE_URL is required: e2e runs against a throwaway database created from it, never the shared one',
  );
// Workers re-read this config; the env var pins one database name and secret for the whole run.
process.env.E2E_DATABASE_NAME ??= `pg_e2e_${randomUUID().replaceAll('-', '')}`;
process.env.E2E_SESSION_SECRET ??= process.env.SESSION_SECRET ?? randomBytes(32).toString('hex');
const port = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  // Every test signs in as the same local user, and the first sign-in seeds the sandbox.
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  globalSetup: './tests/e2e/global-setup.ts',
  use: { baseURL, trace: 'retain-on-failure', ...devices['Desktop Chrome'] },
  webServer: {
    // Webpack, not Turbopack: Turbopack dev sometimes reloads every page on an "HMR hash mismatch" loop, which aborts the sign-in POST.
    command: `./node_modules/.bin/next dev --webpack --hostname localhost --port ${port}`,
    url: `${baseURL}/api/health`,
    // Reusing a running server could point the suite at the shared database.
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      AUTH_MODE: 'local',
      NEXT_PUBLIC_APP_URL: baseURL,
      SESSION_SECRET: process.env.E2E_SESSION_SECRET,
      DATABASE_URL: testDatabaseUrl(admin, process.env.E2E_DATABASE_NAME),
      NEXT_TELEMETRY_DISABLED: '1',
    },
  },
});
