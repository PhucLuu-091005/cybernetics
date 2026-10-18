import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(join(process.cwd(), file), 'utf8');
const lines = (file: string) =>
  read(file)
    .split('\n')
    .map((line) => line.trim());

describe('deployment config', () => {
  it('drops the Railway and Render configs: Cloud Run with Neon is the one deploy path', () => {
    expect(existsSync(join(process.cwd(), 'railway.toml'))).toBe(false);
    expect(existsSync(join(process.cwd(), 'render.yaml'))).toBe(false);
  });
  it('listens on the PORT that Cloud Run sets, and checks its health on that port', () => {
    const docker = read('Dockerfile');
    expect(docker).toMatch(/ENV [^\n]*PORT=8080/);
    expect(docker).toMatch(/EXPOSE 8080\n/);
    expect(docker).not.toMatch(/server\.js[^\n]*(--port|-p )/);
    expect(docker).toMatch(
      /COPY --from=builder[^\n]*scripts\/healthcheck\.mjs \.\/scripts\/healthcheck\.mjs/,
    );
    expect(docker).toContain('HEALTHCHECK');
    expect(docker).toContain('CMD ["node", "scripts/healthcheck.mjs"]');
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
  it('keeps secrets, dependencies, build output and agent notes out of the build context and the Cloud Build upload', () => {
    for (const file of ['.dockerignore', '.gcloudignore']) {
      const ignored = lines(file);
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
    }
  });
});

describe('container health check', () => {
  const script = join(process.cwd(), 'scripts/healthcheck.mjs');
  const servers: Server[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => new Promise((done) => s.close(done))));
  });
  const serve = async (status: number) => {
    const server = createServer((request, response) => {
      response.writeHead(request.url === '/api/health' ? status : 404, {
        'content-type': 'application/json',
      });
      response.end(JSON.stringify({ status: 'ok' }));
    });
    servers.push(server);
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    return (server.address() as AddressInfo).port;
  };
  const check = (port: number | undefined) =>
    new Promise<number | null>((resolve) => {
      const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, NODE_ENV: 'production' };
      if (port !== undefined) env.PORT = String(port);
      spawn(process.execPath, [script], { env, stdio: 'ignore' }).on('close', resolve);
    });

  it('passes when /api/health answers 200 on PORT', async () => {
    expect(await check(await serve(200))).toBe(0);
  });
  it('fails when the server on PORT is not healthy or nothing listens there', async () => {
    expect(await check(await serve(503))).toBe(1);
    const free = await serve(200);
    await new Promise((done) => servers.pop()!.close(done));
    expect(await check(free)).toBe(1);
  });
});
