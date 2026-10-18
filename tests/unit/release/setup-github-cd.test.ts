import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const script = join(process.cwd(), 'scripts/setup-github-cd.sh');
const VALUES = { GCP_PROJECT_ID: 'promise-graph', GITHUB_REPOSITORY: 'PhucLuu-091005/cybernetics' };
const NUMBER = '1053551314419';
const DEPLOYER = 'promise-graph-deployer@promise-graph.iam.gserviceaccount.com';
const RUNTIME = 'promise-graph-runtime@promise-graph.iam.gserviceaccount.com';
const POOL = `projects/${NUMBER}/locations/global/workloadIdentityPools/github-actions`;
const PROVIDER = `${POOL}/providers/github`;
const CONDITION =
  "assertion.repository == 'PhucLuu-091005/cybernetics' && assertion.ref_type == 'tag' && assertion.ref.startsWith('refs/tags/v')";

// A stand-in gcloud that remembers what it created in $FAKE_DIR/state, so a second run sees it.
const FAKE = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$FAKE_DIR/calls.log"
state="$FAKE_DIR/state"
previous=""
for arg in "$@"; do
  [ "$previous" = "--policy" ] && cp "$arg" "$FAKE_DIR/policy.json"
  previous="$arg"
done
case "$1 $2" in
  "iam workload-identity-pools") [ "$3" = providers ] && name="$5" || name="$4" ;;
  *) name="$4" ;;
esac
key="$state/\${name%%@*}"
case "$*" in
  "projects describe "*) [ "$FAKE_NO_NUMBER" = 1 ] || echo ${NUMBER} ;;
  "run services describe "*) [ "$FAKE_NO_SERVICE" = 1 ] && exit 1 ;;
  "iam service-accounts describe ${RUNTIME} "*) [ "$FAKE_NO_RUNTIME" = 1 ] && exit 1 ;;
  *" describe "*) [ -e "$key" ] || exit 1 ;;
  *" create "* | *" create-oidc "*) touch "$key" ;;
esac
exit 0
`;

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
const fakeDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'gcloud-cd-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'state'));
  writeFileSync(join(dir, 'gcloud'), FAKE);
  chmodSync(join(dir, 'gcloud'), 0o755);
  return dir;
};
const setup = (
  values: Record<string, string>,
  { dir = fakeDir(), flags = {} }: { dir?: string; flags?: Record<string, string> } = {},
) => {
  const log = join(dir, 'calls.log');
  rmSync(log, { force: true });
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
  const lines = (existsSync(log) ? readFileSync(log, 'utf8') : '').split('\n').filter(Boolean);
  const policy = existsSync(join(dir, 'policy.json'))
    ? JSON.parse(readFileSync(join(dir, 'policy.json'), 'utf8'))
    : null;
  return { ...result, dir, lines, calls: lines.join('\n'), policy };
};
const grants = (lines: string[]) => lines.filter((line) => line.includes('add-iam-policy-binding'));

describe('scripts/setup-github-cd.sh', () => {
  it('names every missing value and calls gcloud not once', () => {
    const run = setup({});
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('GCP_PROJECT_ID');
    expect(run.stderr).toContain('GITHUB_REPOSITORY');
    expect(run.calls).toBe('');
  });

  it('refuses a repository or project that is not a plain name, before any gcloud call', () => {
    const run = setup({ GCP_PROJECT_ID: 'Promise Graph', GITHUB_REPOSITORY: "a/b' || true || '" });
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('GITHUB_REPOSITORY must look like owner/name');
    expect(run.stderr).toContain('GCP_PROJECT_ID');
    expect(run.calls).toBe('');
  });

  it('stops before it changes anything when the first manual deploy did not run', () => {
    for (const flag of ['FAKE_NO_SERVICE', 'FAKE_NO_RUNTIME']) {
      const run = setup(VALUES, { flags: { [flag]: '1' } });
      expect(run.status).toBe(3);
      expect(run.stderr).toContain('scripts/deploy-cloud-run.sh');
      expect(run.calls).not.toMatch(/ create|add-iam-policy-binding|set-cleanup-policies|enable/);
    }
  });

  it('stops when it cannot read the project number', () => {
    const run = setup(VALUES, { flags: { FAKE_NO_NUMBER: '1' } });
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('project number');
  });

  it('trusts only v* tags of the one repository through an OIDC provider for GitHub', () => {
    const run = setup(VALUES);
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    const provider = run.lines.find((line) =>
      line.startsWith('iam workload-identity-pools providers create-oidc github '),
    );
    expect(provider).toBeDefined();
    expect(provider).toContain('--workload-identity-pool github-actions');
    expect(provider).toContain('--issuer-uri https://token.actions.githubusercontent.com');
    expect(provider).toContain(
      '--attribute-mapping google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref,attribute.ref_type=assertion.ref_type',
    );
    expect(provider).toContain(`--attribute-condition ${CONDITION}`);
  });

  it('gives the deployer only its three roles, each on the one resource it needs, and no key', () => {
    const run = setup(VALUES);
    expect(run.status).toBe(0);
    expect(run.calls).toContain(
      'iam service-accounts create promise-graph-deployer --project promise-graph',
    );
    expect(grants(run.lines)).toEqual([
      `run services add-iam-policy-binding promise-graph --project promise-graph --region asia-southeast1 --member serviceAccount:${DEPLOYER} --role roles/run.developer --quiet`,
      `artifacts repositories add-iam-policy-binding promise-graph --project promise-graph --location asia-southeast1 --member serviceAccount:${DEPLOYER} --role roles/artifactregistry.writer --quiet`,
      `iam service-accounts add-iam-policy-binding ${RUNTIME} --project promise-graph --member serviceAccount:${DEPLOYER} --role roles/iam.serviceAccountUser --quiet`,
      `iam service-accounts add-iam-policy-binding ${DEPLOYER} --project promise-graph --member principalSet://iam.googleapis.com/${POOL}/attribute.repository/PhucLuu-091005/cybernetics --role roles/iam.workloadIdentityUser --quiet`,
    ]);
    expect(run.calls).not.toMatch(
      /projects add-iam-policy-binding|keys create|roles\/(owner|editor|run\.admin)/,
    );
  });

  it('creates the docker repository in asia-southeast1 and keeps the 3 newest images', () => {
    const run = setup(VALUES);
    expect(run.calls).toContain(
      'artifacts repositories create promise-graph --project promise-graph --location asia-southeast1 --repository-format docker',
    );
    const cleanup = run.lines.find((line) =>
      line.startsWith('artifacts repositories set-cleanup-policies promise-graph '),
    );
    expect(cleanup).toContain('--location asia-southeast1');
    expect(cleanup).toContain('--no-dry-run');
    expect(run.policy).toEqual([
      { name: 'keep-3-newest', action: { type: 'Keep' }, mostRecentVersions: { keepCount: 3 } },
      { name: 'delete-the-rest', action: { type: 'Delete' }, condition: { tagState: 'any' } },
    ]);
  });

  it('prints the two repository variables and the gh commands that set them', () => {
    const run = setup(VALUES);
    expect(run.stdout).toContain(`GCP_WIF_PROVIDER=${PROVIDER}`);
    expect(run.stdout).toContain(`GCP_DEPLOYER_SA=${DEPLOYER}`);
    expect(run.stdout).toContain(
      `gh variable set GCP_WIF_PROVIDER --repo PhucLuu-091005/cybernetics --body ${PROVIDER}`,
    );
    expect(run.stdout).toContain(
      `gh variable set GCP_DEPLOYER_SA --repo PhucLuu-091005/cybernetics --body ${DEPLOYER}`,
    );
    expect(run.stdout).not.toContain('gh secret');
  });

  it('creates nothing on a second run, updates the provider to the same condition and prints the same values', () => {
    const first = setup(VALUES);
    const second = setup(VALUES, { dir: first.dir });
    expect(second.stderr).toBe('');
    expect(second.status).toBe(0);
    expect(second.calls).not.toMatch(/ (create|create-oidc) /);
    const update = second.lines.find((line) =>
      line.startsWith('iam workload-identity-pools providers update-oidc github '),
    );
    expect(update).toContain(`--attribute-condition ${CONDITION}`);
    expect(grants(second.lines)).toEqual(grants(first.lines));
    expect(second.stdout).toContain(`GCP_WIF_PROVIDER=${PROVIDER}`);
  });
});
