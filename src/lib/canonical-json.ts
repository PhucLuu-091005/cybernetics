import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

function normalize(value: unknown, ancestors = new Set<object>()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object' || value instanceof Date)
    throw new TypeError('Canonical JSON accepts finite JSON values only');
  if (ancestors.has(value)) throw new TypeError('Canonical JSON cannot contain cycles');
  const seen = new Set(ancestors).add(value);
  if (Array.isArray(value)) return value.map((item) => normalize(item, seen));
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    throw new TypeError('Canonical JSON requires plain objects');
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((property) => [property, normalize((value as Record<string, unknown>)[property], seen)]),
  );
}
function serialize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(serialize).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${serialize((value as Record<string, unknown>)[key])}`)
    .join(',')}}`;
}
export function canonicalJson(value: unknown): string {
  return serialize(normalize(value));
}
export function canonicalHash(value: unknown): string {
  return bytesToHex(sha256(new TextEncoder().encode(canonicalJson(value))));
}
