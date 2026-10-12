import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

const entityCollections = new Set(['acts', 'loops', 'annotations', 'people', 'departments', 'milestones', 'recordDecisions']);
/** Sort only named entity collections; ordered operations, recipients and proof arrays retain their meaning. */
function normalize(value: unknown, key?: string, ancestors = new Set<object>()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object' || value instanceof Date) throw new TypeError('Canonical JSON accepts finite JSON values only');
  if (ancestors.has(value)) throw new TypeError('Canonical JSON cannot contain cycles');
  const seen = new Set(ancestors).add(value);
  if (Array.isArray(value)) {
    const result = value.map(item => normalize(item, undefined, seen));
    if (key && entityCollections.has(key)) {
      const stableKey = key === 'recordDecisions' ? 'recordVersionId' : 'id';
      if (result.every(item => item && typeof item === 'object' && typeof (item as Record<string, unknown>)[stableKey] === 'string')) {
        result.sort((a, b) => {
          const left = (a as Record<string, string>)[stableKey], right = (b as Record<string, string>)[stableKey];
          return left < right ? -1 : left > right ? 1 : 0;
        });
      }
    }
    return result;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new TypeError('Canonical JSON requires plain objects');
  return Object.fromEntries(Object.keys(value).sort().map(property => [property, normalize((value as Record<string, unknown>)[property], property, seen)]));
}
export function canonicalJson(value: unknown): string { return JSON.stringify(normalize(value)); }
export function canonicalHash(value: unknown): string { return bytesToHex(sha256(new TextEncoder().encode(canonicalJson(value)))); }
