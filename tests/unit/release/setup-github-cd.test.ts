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
const REPO_ID = '1415634185';
const OWNER_ID = '187116949';
const CONDITION = `assertion.repository_id == '${REPO_ID}' && assertion.repository_owner_id == '${OWNER_ID}' && assertion.ref_type == 'tag' && assertion.ref.startsWith('refs/tags/v') && assertion.environment == 'production'`;
const MAPPING =
  'google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_id=assertion.repository_id,attribute.repository_owner_id=assertion.repository_owner_id,attribute.ref=assertion.ref,attribute.ref_type=assertion.ref_type';

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

// A stand-in gh that answers the ids of the repository and of its owner.
const FAKE_GH = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$FAKE_DIR/gh.log"
[ "$FAKE_GH_FAIL" = 1 ] && exit 1
[ "$FAKE_GH_BAD" = 1 ] && { echo 'null'; echo ${OWNER_ID}; exit 0; }
printf '%s\\n%s\\n' ${REPO_ID} ${OWNER_ID}
`;

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
const fakeDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'gcloud-cd-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'state'));
  writeFileSync(join(dir, 'gcloud'), FAKE);
  chmodSync(join(dir, 'gcloud'), 0o755);
  writeFileSync(join(dir, 'gh'), FAKE_GH);
  chmodSync(join(dir, 'gh'), 0o755);
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
  const gh = existsSync(join(dir, 'gh.log')) ? readFileSync(join(dir, 'gh.log'), 'utf8') : '';
  const policy = existsSync(join(dir, 'policy.json'))
    ? JSON.parse(readFileSync(join(dir, 'policy.json'), 'utf8'))
    : null;
  return { ...result, dir, lines, calls: lines.join('\n'), gh, policy };
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

  it('reads the ids of the repository and its owner with gh, or takes them as values', () => {
    const read = setup(VALUES);
    expect(read.gh.trim()).toBe('api repos/PhucLuu-091005/cybernetics --jq .id,.owner.id');
    const given = setup(
      { ...VALUES, GITHUB_REPOSITORY_ID: REPO_ID, GITHUB_OWNER_ID: OWNER_ID },
      { flags: { FAKE_GH_FAIL: '1' } },
    );
    expect(given.status).toBe(0);
    expect(given.gh).toBe('');
    expect(given.calls).toContain(`--attribute-condition ${CONDITION}`);
  });

  it('refuses ids that are not digits, or a failed gh call, before any gcloud call', () => {
    for (const run of [
      setup(VALUES, { flags: { FAKE_GH_BAD: '1' } }),
      setup({ ...VALUES, GITHUB_REPOSITORY_ID: '1 || true', GITHUB_OWNER_ID: OWNER_ID }),
    ]) {
      expect(run.status).toBe(2);
      expect(run.stderr).toContain('GITHUB_REPOSITORY_ID and GITHUB_OWNER_ID must be digits');
      expect(run.calls).toBe('');
    }
    const failed = setup(VALUES, { flags: { FAKE_GH_FAIL: '1' } });
    expect(failed.status).toBe(2);
    expect(failed.stderr).toContain('gh auth login');
    expect(failed.calls).toBe('');
  });

  it('trusts only v* tags of the one repository id in the production environment', () => {
    const run = setup(VALUES);
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    const provider = run.lines.find((line) =>
      line.startsWith('iam workload-identity-pools providers create-oidc github '),
    );
    expect(provider).toBeDefined();
    expect(provider).toContain('--workload-identity-pool github-actions');
    expect(provider).toContain('--issuer-uri https://token.actions.githubusercontent.com');
    expect(provider).toContain(`--attribute-mapping ${MAPPING}`);
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
      `iam service-accounts add-iam-policy-binding ${DEPLOYER} --project promise-graph --member principalSet://iam.googleapis.com/${POOL}/attribute.repository_id/${REPO_ID} --role roles/iam.workloadIdentityUser --quiet`,
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

describe('the attribute condition of the GitHub provider', () => {
  const condition = () => {
    const line = setup(VALUES).lines.find((l) => l.includes('create-oidc'))!;
    const text = line.slice(line.indexOf('--attribute-condition ') + 22);
    // CEL and JavaScript read this subset the same way once == becomes ===.
    return new Function('assertion', `return ${text.replace(/==/g, '===')};`) as (
      claims: Record<string, string>,
    ) => boolean;
  };
  const good = {
    repository: 'PhucLuu-091005/cybernetics',
    repository_id: REPO_ID,
    repository_owner_id: OWNER_ID,
    ref: 'refs/tags/v0.1.0',
    ref_type: 'tag',
    environment: 'production',
  };

  it.each([
    ['a v* tag of the repository in production', good, true],
    [
      'a fork',
      { ...good, repository: 'someone/cybernetics', repository_id: '9', repository_owner_id: '8' },
      false,
    ],
    [
      'a new repository with the old name after a rename',
      { ...good, repository_id: '7', repository_owner_id: '6' },
      false,
    ],
    ['a branch push', { ...good, ref: 'refs/heads/main', ref_type: 'branch' }, false],
    ['a pull request', { ...good, ref: 'refs/pull/1/merge', ref_type: 'branch' }, false],
    ['a tag that does not start with v', { ...good, ref: 'refs/tags/release-1' }, false],
    ['a tag run of a job without the environment', { ...good, environment: undefined }, false],
    ['a tag run in another environment', { ...good, environment: 'preview' }, false],
  ])('%s', (_, claims, allowed) => {
    expect(condition()(claims as Record<string, string>)).toBe(allowed);
  });
});
