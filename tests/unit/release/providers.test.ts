import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const script = join(process.cwd(), 'scripts/check-no-model-dependencies.mjs');
const run = (root?: string) => spawnSync(process.execPath, root ? [script, root] : [script], { encoding: 'utf8' });
const roots: string[] = [];
function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'providers-'));
  roots.push(root);
  const all = { 'package.json': JSON.stringify({ dependencies: { next: '16.4.0' }, devDependencies: { vitest: '4.1.11' } }), '.env.example': 'DATABASE_URL=\n', 'src/index.ts': "import { z } from 'zod';\n", ...files };
  for (const [path, content] of Object.entries(all)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

describe('provider-free dependency check', () => {
  afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

  it('passes on this repository', () => {
    const result = run();
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });
  it('passes on a clean project', () => {
    expect(run(project({})).status).toBe(0);
  });
  it.each([
    ['openai', { dependencies: { openai: '5.0.0' } }],
    ['@anthropic-ai/sdk', { devDependencies: { '@anthropic-ai/sdk': '1.0.0' } }],
    ['@ai-sdk/google', { optionalDependencies: { '@ai-sdk/google': '1.0.0' } }],
    ['@langchain/core', { peerDependencies: { '@langchain/core': '1.0.0' } }],
    ['@google/generative-ai', { dependencies: { '@google/generative-ai': '1.0.0' } }],
  ])('fails when package.json depends on %s', (name, manifest) => {
    const result = run(project({ 'package.json': JSON.stringify(manifest) }));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(name);
  });
  it('fails when .env.example declares a model provider API key', () => {
    const result = run(project({ '.env.example': 'DATABASE_URL=\nOPENAI_API_KEY=\n' }));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('OPENAI_API_KEY');
    expect(run(project({ '.env.example': 'MAPS_API_KEY=\n' })).status).toBe(0);
  });
  it.each([
    ["import OpenAI from 'openai';\n", 'openai'],
    ["export { generateText } from '@ai-sdk/openai';\n", '@ai-sdk/openai'],
    ["const groq = await import('groq-sdk');\n", 'groq-sdk'],
    ["const { Ollama } = require('ollama');\n", 'ollama'],
  ])('fails when src imports a model package: %s', (source, name) => {
    const result = run(project({ 'src/server/model.ts': source }));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(name);
  });
  it('fails when src defines an analysis job kind', () => {
    const result = run(project({ 'src/server/jobs.ts': "export const jobKinds = ['import', 'analysis'] as const;\n" }));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('analysis');
  });
});
