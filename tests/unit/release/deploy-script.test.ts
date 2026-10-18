import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const script = join(process.cwd(), 'scripts/deploy-cloud-run.sh');
const URL_ = 'https://promise-graph-123456789.asia-southeast1.run.app';
const VALUES = {
  GCP_PROJECT_ID: 'promise-graph-demo',
  NEXT_PUBLIC_APP_URL: URL_,
  SESSION_SECRET: 'session-secret-value-0123456789abcdef',
  GOOGLE_CLIENT_ID: '1234-abc.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'google-client-secret-value',
  DATABASE_URL:
    'postgresql://neondb_owner:pooled-password@ep-quiet-lake-a1-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=verify-full',
  MIGRATE_DATABASE_URL:
    'postgresql://neondb_owner:direct-password@ep-quiet-lake-a1.ap-southeast-1.aws.neon.tech/neondb?sslmode=verify-full',
};
const SECRETS = [
  'session-secret-value',
  'google-client-secret-value',
  'pooled-password',
  'direct-password',
];

// A stand-in gcloud: it logs each call and what it read on stdin, and answers like a new project.
const FAKE = `#!/usr/bin/env bash
log="$FAKE_DIR/calls.log"
printf '%s\\n' "$*" >> "$log"
case "$*" in
  *--data-file=-*) cat > "$FAKE_DIR/stdin-$(wc -l < "$log" | tr -d ' ')" ;;
esac
case "$1 $2" in
  "projects describe") echo 123456789 ;;
  "secrets describe") exit 1 ;;
  "run services")
    case "$*" in
      *--format=json*) printf '{"status":{"url":"%s"}}\\n' "$FAKE_URL" ;;
      *) echo "$FAKE_URL" ;;
    esac ;;
esac
`;
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
const fake = () => {
  const dir = mkdtempSync(join(tmpdir(), 'gcloud-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'gcloud'), FAKE);
  chmodSync(join(dir, 'gcloud'), 0o755);
  return dir;
};
const deploy = (values: Record<string, string>, serviceUrl = URL_) => {
  const dir = fake();
  const result = spawnSync('bash', [script], {
    encoding: 'utf8',
    cwd: process.cwd(),
    env: {
      PATH: `${dir}:/usr/bin:/bin`,
      NODE_ENV: 'production',
      FAKE_DIR: dir,
      FAKE_URL: serviceUrl,
      ...values,
    },
  });
  const log = join(dir, 'calls.log');
  const calls = existsSync(log) ? readFileSync(log, 'utf8') : '';
  const stdin = (secretName: string) => {
    const line = calls.split('\n').findIndex((c) => c.startsWith(`secrets create ${secretName} `));
    return readFileSync(join(dir, `stdin-${line + 1}`), 'utf8');
  };
  return { ...result, calls, stdin };
};

describe('scripts/deploy-cloud-run.sh', () => {
  it('names every missing value and calls gcloud not once', () => {
    const run = deploy({ GCP_PROJECT_ID: 'p' });
    expect(run.status).toBe(2);
    for (const name of Object.keys(VALUES).filter((n) => n !== 'GCP_PROJECT_ID'))
      expect(run.stderr).toContain(name);
    expect(run.calls).toBe('');
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
    expect(run.calls).toBe('');
  });

  it('stores the four secrets through stdin and deploys asia-southeast1 from source with one instance at most', () => {
    const run = deploy(VALUES);
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    expect(run.stdin('promise-graph-session-secret')).toBe(VALUES.SESSION_SECRET);
    expect(run.stdin('promise-graph-database-url')).toBe(VALUES.DATABASE_URL);
    expect(run.stdin('promise-graph-migrate-database-url')).toBe(VALUES.MIGRATE_DATABASE_URL);
    expect(run.stdin('promise-graph-google-client-secret')).toBe(VALUES.GOOGLE_CLIENT_SECRET);
    const deployCall = run.calls.split('\n').find((c) => c.startsWith('run deploy'))!;
    for (const part of [
      'promise-graph --project promise-graph-demo --region asia-southeast1 --source .',
      '--min-instances 0 --max-instances 1',
      '--memory 512Mi',
      'httpGet.path=/api/health',
      `AUTH_MODE=google,NEXT_PUBLIC_APP_URL=${URL_},GOOGLE_CLIENT_ID=${VALUES.GOOGLE_CLIENT_ID}`,
      'SESSION_SECRET=promise-graph-session-secret:latest',
      'GOOGLE_CLIENT_SECRET=promise-graph-google-client-secret:latest',
      'DATABASE_URL=promise-graph-database-url:latest',
      'MIGRATE_DATABASE_URL=promise-graph-migrate-database-url:latest',
    ])
      expect(deployCall).toContain(part);
    expect(run.calls).toContain(
      'serviceAccount:123456789-compute@developer.gserviceaccount.com --role roles/secretmanager.secretAccessor',
    );
    for (const secret of SECRETS) {
      expect(run.calls).not.toContain(secret);
      expect(run.stdout + run.stderr).not.toContain(secret);
    }
    expect(run.stdout).toContain(`${URL_}/api/auth/google/callback`);
  });

  it('says how to fix NEXT_PUBLIC_APP_URL when the service got another URL', () => {
    const other = 'https://promise-graph-abc123-as.a.run.app';
    const run = deploy(VALUES, other);
    expect(run.status).toBe(3);
    expect(run.stderr).toContain(`--update-env-vars NEXT_PUBLIC_APP_URL=${other}`);
  });
});
