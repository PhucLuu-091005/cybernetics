// SRD 14 item 14: P0 ships no model SDK, no provider credential and no analysis job kind; agents bring their own model.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODEL_PACKAGE =
  /openai|anthropic|@ai-sdk|langchain|cohere|mistral|groq|ollama|google-generative|generative-ai/;
const PROVIDER_KEY =
  /^\s*(?:export\s+)?([A-Z0-9_]*(?:OPENAI|ANTHROPIC|CLAUDE|AI_SDK|LANGCHAIN|COHERE|MISTRAL|GROQ|OLLAMA|GEMINI|GOOGLE_GENERATIVE|GENERATIVE_AI)[A-Z0-9_]*_API_KEY)\s*=/gm;
const IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)['"]([^'"]+)['"]/g;
const ANALYSIS_JOB = /\b(?:jobs?|queue)\w*\b[^\n]{0,80}['"`]analysis['"`]|\banalysis[_-]?jobs?\b/gi;
const SOURCE = /\.(?:[cm]?[jt]sx?)$/;

const root = process.argv[2] ?? fileURLToPath(new URL('..', import.meta.url));
const problems = [];

const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
for (const field of [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
]) {
  for (const name of Object.keys(manifest[field] ?? {}))
    if (MODEL_PACKAGE.test(name))
      problems.push(`package.json ${field} includes model package ${name}`);
}

const envExample = join(root, '.env.example');
if (existsSync(envExample))
  for (const [, name] of readFileSync(envExample, 'utf8').matchAll(PROVIDER_KEY))
    problems.push(`.env.example declares model provider credential ${name}`);

function* sourceFiles(directory) {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(path);
    else if (SOURCE.test(entry.name)) yield path;
  }
}
for (const file of sourceFiles(join(root, 'src'))) {
  const text = readFileSync(file, 'utf8'),
    name = relative(root, file);
  for (const [, specifier] of text.matchAll(IMPORT))
    if (!specifier.startsWith('.') && MODEL_PACKAGE.test(specifier))
      problems.push(`${name} imports model package ${specifier}`);
  for (const [match] of text.matchAll(ANALYSIS_JOB))
    problems.push(`${name} defines an analysis job kind: ${match.trim()}`);
}

if (problems.length) {
  console.error(
    `Provider-free check failed:\n${problems.map((problem) => `- ${problem}`).join('\n')}`,
  );
  process.exit(1);
}
console.log('Provider-free check passed: no model SDK, provider credential or analysis job kind.');
