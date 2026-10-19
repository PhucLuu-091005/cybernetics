import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Its own run, after the main suite: two dev servers on one .next would break each other.
const server = base.webServer as NonNullable<Exclude<typeof base.webServer, unknown[]>>;
const env: Record<string, string> = { ...server.env, AUTH_MODE: 'demo' };
delete env.TRACKER_DEMO_AS_OF;
export default defineConfig({
  ...base,
  testDir: 'tests/e2e-demo',
  webServer: { ...server, env },
});
