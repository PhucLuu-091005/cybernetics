import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseYaml, type Yaml } from '../../support/yaml';

type Node = { [key: string]: Yaml };
const DEPLOY = '.github/workflows/deploy.yml';
const CI = '.github/workflows/ci.yml';
const read = (file: string) => readFileSync(join(process.cwd(), file), 'utf8');
const load = (file: string) => parseYaml(read(file)) as Node;
const jobs = (file: string) => load(file).jobs as { [name: string]: Node };
const steps = (job: Node) => (job.steps ?? []) as Node[];
const IMAGE = 'asia-southeast1-docker.pkg.dev/promise-graph/promise-graph/app';

const commands = (job: Node, program: string) =>
  steps(job)
    .map((step) => String(step.run ?? ''))
    .join('\n')
    .replace(/\\\n\s*/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith(program));

describe('the deploy workflow', () => {
  it('exists next to the checks', () => {
    expect(existsSync(join(process.cwd(), DEPLOY))).toBe(true);
  });

  it('runs on a pushed v* tag, or by hand with a tag', () => {
    const on = load(DEPLOY).on as Node;
    expect(Object.keys(on).sort()).toEqual(['push', 'workflow_dispatch']);
    expect(on.push).toEqual({ tags: ['v*'] });
    const input = ((on.workflow_dispatch as Node).inputs as Node).tag as Node;
    expect(input.required).toBe(true);
    expect(input.type).toBe('string');
  });

  it('pins every action of the deploy and of the checks it calls to a full commit SHA', () => {
    for (const file of [DEPLOY, CI]) {
      const used = Object.values(jobs(file)).flatMap((job) =>
        steps(job)
          .map((step) => step.uses)
          .filter(Boolean),
      );
      expect(used.length).toBeGreaterThan(0);
      for (const action of used) expect(action).toMatch(/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/);
    }
  });

  it('deploys only after the same checks as CI pass', () => {
    const ci = load(CI).on as Node;
    expect(Object.keys(ci).sort()).toEqual(['pull_request', 'push', 'workflow_call']);
    expect(ci.push).toEqual({ branches: ['**'] });
    const all = jobs(DEPLOY);
    const checks = Object.entries(all).find(([, job]) => job.uses === `./${CI}`);
    expect(checks).toBeDefined();
    const needs = [all.deploy.needs].flat();
    expect(needs).toContain(checks![0]);
  });

  it('gives the deploy job alone an ID token, in the production environment', () => {
    const workflow = load(DEPLOY);
    expect(workflow.permissions).toEqual({ contents: 'read' });
    const { deploy, ...others } = jobs(DEPLOY);
    expect(deploy.permissions).toEqual({ contents: 'read', 'id-token': 'write' });
    for (const job of Object.values(others)) expect(job.permissions ?? null).toBeNull();
    expect(deploy.environment).toBe('production');
  });

  it('runs one whole workflow at a time, so an older tag never deploys after a newer one', () => {
    expect(load(DEPLOY).concurrency).toEqual({ group: 'deploy', 'cancel-in-progress': false });
    for (const job of Object.values(jobs(DEPLOY))) expect(job.concurrency ?? null).toBeNull();
  });

  it('signs in to Google through Workload Identity Federation with repository variables and no secret', () => {
    const text = read(DEPLOY);
    expect(text).not.toMatch(/secrets\./);
    expect(text).not.toMatch(/credentials_json|service_account_key|GOOGLE_APPLICATION_CREDENTIALS/);
    const auth = steps(jobs(DEPLOY).deploy).find((step) =>
      String(step.uses).startsWith('google-github-actions/auth@'),
    );
    expect(auth?.with).toEqual({
      workload_identity_provider: '${{ vars.GCP_WIF_PROVIDER }}',
      service_account: '${{ vars.GCP_DEPLOYER_SA }}',
    });
  });

  it('pushes the image with the tag and the commit, then deploys it with no env or secret flags', () => {
    const deploy = jobs(DEPLOY).deploy;
    expect((deploy.env as Node).IMAGE).toBe(IMAGE);
    const pushes = commands(deploy, 'docker push');
    expect(pushes).toEqual(['docker push "$IMAGE:$TAG"', 'docker push "$IMAGE:$GITHUB_SHA"']);
    const runs = commands(deploy, 'gcloud run deploy');
    expect(runs).toHaveLength(1);
    expect(runs[0]).toContain('"$SERVICE"');
    expect(runs[0]).toContain('--image "$IMAGE:$TAG"');
    expect(runs[0]).toContain('--region "$REGION"');
    expect(deploy.env).toMatchObject({
      SERVICE: 'promise-graph',
      REGION: 'asia-southeast1',
      PROJECT: 'promise-graph',
    });
    expect(runs[0]).not.toMatch(
      /--(set|update|remove|clear)-(env-vars|secrets)|--env-vars-file|--service-account|--source/,
    );
  });

  it('waits for the new revision, checks /api/health and writes the URL to the job summary', () => {
    const scripts = steps(jobs(DEPLOY).deploy)
      .map((step) => String(step.run ?? ''))
      .join('\n');
    expect(scripts).toContain('latestReadyRevisionName');
    expect(scripts).toContain('/api/health');
    expect(scripts).toContain('GITHUB_STEP_SUMMARY');
  });

  it('never puts an expression straight into a shell script', () => {
    for (const job of Object.values(jobs(DEPLOY)))
      for (const step of steps(job)) expect(String(step.run ?? '')).not.toContain('${{');
  });
});
