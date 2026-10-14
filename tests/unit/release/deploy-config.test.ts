import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(join(process.cwd(), file), 'utf8');
const lines = (file: string) =>
  read(file)
    .split('\n')
    .map((line) => line.trim());

describe('Render deployment config', () => {
  it('declares one free Docker web service with the health check and a free PostgreSQL 17 database', () => {
    const blueprint = read('render.yaml');
    expect(blueprint.match(/- type: web/g)).toHaveLength(1);
    for (const line of [
      'runtime: docker',
      'healthCheckPath: /api/health',
      "postgresMajorVersion: '17'",
      'ipAllowList: []',
    ])
      expect(lines('render.yaml')).toContain(line);
    expect(blueprint.match(/plan: free/g)).toHaveLength(2);
    expect(blueprint).toMatch(
      /- key: DATABASE_URL\s+fromDatabase:\s+name: promise-graph-db\s+property: connectionString/,
    );
    expect(blueprint).toMatch(/- name: promise-graph-db\s/);
  });
  it('sets google auth, generates the session secret and prompts for the owner values', () => {
    const blueprint = read('render.yaml');
    expect(blueprint).toMatch(/- key: AUTH_MODE\s+value: google/);
    expect(blueprint).toMatch(/- key: SESSION_SECRET\s+generateValue: true/);
    for (const key of ['NEXT_PUBLIC_APP_URL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'])
      expect(blueprint).toMatch(new RegExp(`- key: ${key}\\s+sync: false`));
    expect(blueprint).not.toMatch(/AUTH_MODE\s+value: local/);
  });
  it('drops the Railway config', () => {
    expect(existsSync(join(process.cwd(), 'railway.toml'))).toBe(false);
  });
  it('runs migrations before the server as the non-root user and ships the migration files', () => {
    const docker = read('Dockerfile');
    expect(docker).toMatch(
      /COPY --from=builder[^\n]*\/app\/src\/server\/db\/migrations \.\/src\/server\/db\/migrations/,
    );
    expect(docker).toMatch(
      /COPY --from=builder[^\n]*scripts\/migrate\.mjs \.\/scripts\/migrate\.mjs/,
    );
    expect(docker).toMatch(/ENV NODE_ENV=production/);
    expect(docker).toMatch(/USER app\n/);
    expect(docker).toContain(
      'CMD ["sh", "-c", "node scripts/migrate.mjs && HOSTNAME=0.0.0.0 exec node server.js"]',
    );
  });
  it('keeps secrets, dependencies, build output and agent notes out of the build context', () => {
    const ignored = lines('.dockerignore');
    for (const entry of [
      'node_modules',
      '.next',
      '.env*',
      '.superpowers',
      'test-results',
      'playwright-report',
      'coverage',
    ])
      expect(ignored).toContain(entry);
  });
});
