import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const script = join(process.cwd(), 'scripts/deploy-cloud-run.sh');
const URL_ = 'https://promise-graph-123456789.asia-southeast1.run.app';
const VALUES = {
  GCP_PROJECT_ID: 'promise-graph-demo',
  NEXT_PUBLIC_APP_URL: URL_,
  SESSION_SECRET: 'session-secret-value-0123456789abcdef',
  DATABASE_URL:
    'postgresql://neondb_owner:pooled-password@ep-quiet-lake-a1-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=verify-full',
  MIGRATE_DATABASE_URL:
    'postgresql://neondb_owner:direct-password@ep-quiet-lake-a1.ap-southeast-1.aws.neon.tech/neondb?sslmode=verify-full',
};
const GOOGLE = {
  ...VALUES,
  AUTH_MODE: 'google',
  GOOGLE_CLIENT_ID: '1234-abc.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'google-client-secret-value',
};
const SECRETS = [
  'session-secret-value',
  'google-client-secret-value',
  'pooled-password',
  'direct-password',
];

// A stand-in gcloud: it logs each call and what it read on stdin. FAKE_* flags pick its answers.
const FAKE = `#!/usr/bin/env bash
log="$FAKE_DIR/calls.log"
printf '%s\\n' "$*" >> "$log"
case "$*" in
  *--data-file=-*) cat > "$FAKE_DIR/stdin-$(wc -l < "$log" | tr -d ' ')" ;;
esac
case "$*" in
  "secrets describe "*) [ "$FAKE_SECRETS_EXIST" = 1 ] || exit 1 ;;
  "iam service-accounts describe "*) [ "$FAKE_ACCOUNT_EXISTS" = 1 ] || exit 1 ;;
  "secrets versions list "*) [ "$FAKE_LIST_FAIL" = 1 ] && exit 1; printf '3\\n2\\n1\\n' ;;
  "run deploy "*) [ "$FAKE_DEPLOY_FAIL" = 1 ] && exit 1 ;;
  "run services describe "*) cat "$FAKE_DIR/service.json" ;;
esac
exit 0
`;
const ACCOUNT = 'promise-graph-runtime@promise-graph-demo.iam.gserviceaccount.com';
type Service = { statusUrl: string; urls: string[] };
// The env array holds NEXT_PUBLIC_APP_URL itself, so a check that reads the whole JSON always passes.
const serviceJson = (values: Record<string, string>, service: Service) =>
  JSON.stringify({
    metadata: { annotations: { 'run.googleapis.com/urls': JSON.stringify(service.urls) } },
    spec: {
      template: {
        spec: {
          containers: [
            { env: [{ name: 'NEXT_PUBLIC_APP_URL', value: values.NEXT_PUBLIC_APP_URL ?? '' }] },
          ],
        },
      },
    },
    status: { url: service.statusUrl },
  });
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
const deploy = (
  values: Record<string, string>,
  {
    service = { statusUrl: URL_, urls: [URL_] },
    flags = {},
  }: { service?: Service; flags?: Record<string, string> } = {},
) => {
  const dir = mkdtempSync(join(tmpdir(), 'gcloud-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'gcloud'), FAKE);
  chmodSync(join(dir, 'gcloud'), 0o755);
  writeFileSync(join(dir, 'service.json'), serviceJson(values, service));
  const result = spawnSync('bash', [script], {
    encoding: 'utf8',
    cwd: process.cwd(),
    env: {
      PATH: `${dir}:${dirname(process.execPath)}:/usr/bin:/bin`,
      NODE_ENV: 'production',
      FAKE_DIR: dir,
      ...flags,
      ...values,
    },
  });
  const log = join(dir, 'calls.log');
  const lines = (existsSync(log) ? readFileSync(log, 'utf8') : '').split('\n');
  const at = (prefix: string) => lines.findIndex((c) => c.startsWith(prefix));
  const stdin = (prefix: string) => readFileSync(join(dir, `stdin-${at(prefix) + 1}`), 'utf8');
  return { ...result, calls: lines.join('\n'), lines, at, stdin };
};

describe('scripts/deploy-cloud-run.sh', () => {
  it('names every missing value and calls gcloud not once', () => {
    const run = deploy({ GCP_PROJECT_ID: 'p' });
    expect(run.status).toBe(2);
    for (const name of Object.keys(VALUES).filter((n) => n !== 'GCP_PROJECT_ID'))
      expect(run.stderr).toContain(name);
    expect(run.stderr).not.toContain('GOOGLE_CLIENT');
    expect(run.calls.trim()).toBe('');
  });

  it('asks for the Google client only for AUTH_MODE=google, and refuses local mode', () => {
    const google = deploy({ ...VALUES, AUTH_MODE: 'google' });
    expect(google.status).toBe(2);
    expect(google.stderr).toContain('GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET');
    const local = deploy({ ...VALUES, AUTH_MODE: 'local' });
    expect(local.status).toBe(2);
    expect(local.stderr).toContain('AUTH_MODE must be demo or google');
    expect(google.calls.trim() + local.calls.trim()).toBe('');
  });

  it('refuses a plain http origin, a short session secret, a direct app URL and a pooled migration URL', () => {
    const run = deploy({
      ...VALUES,
      NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
      SESSION_SECRET: 'short',
      DATABASE_URL: VALUES.MIGRATE_DATABASE_URL,
      MIGRATE_DATABASE_URL: VALUES.DATABASE_URL,
    });
    expect(run.status).toBe(2);
    for (const text of [
      'https://',
      'SESSION_SECRET',
      'DATABASE_URL must be the pooled',
      'MIGRATE_DATABASE_URL must be the direct',
    ])
      expect(run.stderr).toContain(text);
    expect(run.stderr).not.toContain('short');
    expect(run.calls.trim()).toBe('');
  });

  it('creates a runtime account that reads only the three secrets, stores them through stdin and deploys demo mode in asia-southeast1 with one instance at most', () => {
    const run = deploy(VALUES);
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    expect(
      run.at('iam service-accounts create promise-graph-runtime --project promise-graph-demo'),
    ).toBeGreaterThan(-1);
    expect(run.stdin('secrets create promise-graph-session-secret ')).toBe(VALUES.SESSION_SECRET);
    expect(run.stdin('secrets create promise-graph-database-url ')).toBe(VALUES.DATABASE_URL);
    expect(run.stdin('secrets create promise-graph-migrate-database-url ')).toBe(
      VALUES.MIGRATE_DATABASE_URL,
    );
    expect(run.calls).not.toContain('google');
    const grants = run.lines.filter((c) => c.includes('add-iam-policy-binding'));
    expect(grants).toHaveLength(3);
    for (const grant of grants)
      expect(grant).toContain(
        `--member serviceAccount:${ACCOUNT} --role roles/secretmanager.secretAccessor`,
      );
    expect(run.calls).not.toContain('-compute@developer.gserviceaccount.com');
    const deployCall = run.lines[run.at('run deploy')];
    for (const part of [
      'promise-graph --project promise-graph-demo --region asia-southeast1 --source .',
      `--service-account ${ACCOUNT}`,
      '--min-instances 0 --max-instances 1',
      '--memory 512Mi',
      'httpGet.path=/api/health',
      `--set-env-vars AUTH_MODE=demo,NEXT_PUBLIC_APP_URL=${URL_} `,
      'SESSION_SECRET=promise-graph-session-secret:latest,DATABASE_URL=promise-graph-database-url:latest',
      'MIGRATE_DATABASE_URL=promise-graph-migrate-database-url:latest',
    ])
      expect(deployCall).toContain(part);
    for (const secret of SECRETS) {
      expect(run.calls).not.toContain(secret);
      expect(run.stdout + run.stderr).not.toContain(secret);
    }
    expect(run.stdout).toContain(`Open the app: ${URL_}`);
    expect(run.stdout).not.toContain('OAuth');
  });

  it('with AUTH_MODE=google stores the Google client secret too and prints the OAuth redirect URI', () => {
    const run = deploy(GOOGLE);
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    expect(run.stdin('secrets create promise-graph-google-client-secret ')).toBe(
      GOOGLE.GOOGLE_CLIENT_SECRET,
    );
    expect(run.lines.filter((c) => c.includes('add-iam-policy-binding'))).toHaveLength(4);
    const deployCall = run.lines[run.at('run deploy')];
    expect(deployCall).toContain(
      `AUTH_MODE=google,NEXT_PUBLIC_APP_URL=${URL_},GOOGLE_CLIENT_ID=${GOOGLE.GOOGLE_CLIENT_ID}`,
    );
    expect(deployCall).toContain('GOOGLE_CLIENT_SECRET=promise-graph-google-client-secret:latest');
    expect(run.calls).not.toContain('google-client-secret-value');
    expect(run.stdout).toContain(`${URL_}/api/auth/google/callback`);
  });

  it('keeps stored secrets and an existing account on a second run', () => {
    const run = deploy(VALUES, { flags: { FAKE_SECRETS_EXIST: '1', FAKE_ACCOUNT_EXISTS: '1' } });
    expect(run.status).toBe(0);
    expect(run.calls).not.toMatch(/secrets (create|versions)|service-accounts create/);
    expect(run.stdout).toContain('Kept secret promise-graph-database-url');
  });

  it('with UPDATE_SECRETS=1 adds a version of each secret and destroys the older ones only after the deploy', () => {
    const run = deploy(
      { ...VALUES, UPDATE_SECRETS: '1' },
      { flags: { FAKE_SECRETS_EXIST: '1', FAKE_ACCOUNT_EXISTS: '1' } },
    );
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    expect(run.stdin('secrets versions add promise-graph-session-secret ')).toBe(
      VALUES.SESSION_SECRET,
    );
    const destroyed = run.lines.filter((c) => c.startsWith('secrets versions destroy'));
    expect(destroyed).toHaveLength(6);
    for (const name of ['session-secret', 'database-url', 'migrate-database-url'])
      for (const version of ['2', '1'])
        expect(destroyed).toContain(
          `secrets versions destroy ${version} --secret promise-graph-${name} --project promise-graph-demo --quiet`,
        );
    expect(run.calls).not.toContain('secrets versions destroy 3 ');
    expect(run.at('secrets versions destroy')).toBeGreaterThan(run.at('run deploy'));
  });

  it('destroys no secret version when the deploy fails', () => {
    const run = deploy(
      { ...VALUES, UPDATE_SECRETS: '1' },
      { flags: { FAKE_SECRETS_EXIST: '1', FAKE_ACCOUNT_EXISTS: '1', FAKE_DEPLOY_FAIL: '1' } },
    );
    expect(run.status).not.toBe(0);
    expect(run.calls).not.toContain('secrets versions destroy');
  });

  it('fails loudly when it cannot list the old secret versions', () => {
    const run = deploy(
      { ...VALUES, UPDATE_SECRETS: '1' },
      { flags: { FAKE_SECRETS_EXIST: '1', FAKE_ACCOUNT_EXISTS: '1', FAKE_LIST_FAIL: '1' } },
    );
    expect(run.status).toBe(4);
    expect(run.stderr).toContain('Could not list the versions of promise-graph-session-secret');
  });

  it('accepts NEXT_PUBLIC_APP_URL when it is one of the service URLs, though not the status URL', () => {
    const legacy = 'https://promise-graph-abc123-as.a.run.app';
    const run = deploy(GOOGLE, { service: { statusUrl: legacy, urls: [URL_, legacy] } });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain(`${URL_}/api/auth/google/callback`);
  });

  it('says how to fix NEXT_PUBLIC_APP_URL when the service got other URLs', () => {
    const other = 'https://promise-graph-abc123-as.a.run.app';
    const run = deploy(VALUES, { service: { statusUrl: other, urls: [other] } });
    expect(run.status).toBe(3);
    expect(run.stderr).toContain(`--update-env-vars NEXT_PUBLIC_APP_URL=${other}`);
  });
});
