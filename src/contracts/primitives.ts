import { z } from 'zod';

export const IdSchema = z.uuid();
export const RevisionSchema = z.number().int().nonnegative();
export const TimestampSchema = z.iso.datetime({ offset: true });
export const DateSchema = z.iso.date();
export const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const IdempotencyKeySchema = z.string().min(1).max(256);
export const TextSchema = z.string().min(1);
export const SideSchema = z.enum(['client', 'vendor']);
export const TimeZoneSchema = z.string().min(1).refine(value => {
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; }
  catch { return false; }
}, 'Invalid IANA time zone');
export const PageInputSchema = z.strictObject({ cursor: z.string().max(4096).nullable().optional(), limit: z.number().int().min(1).max(50).default(50) });
export const ErrorCodeSchema = z.enum(['UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'VALIDATION', 'CONFLICT', 'RATE_LIMITED', 'LIMIT_EXCEEDED']);
export const FieldErrorSchema = z.strictObject({ path: z.string(), message: TextSchema });
export const DomainErrorSchema = z.strictObject({ code: ErrorCodeSchema, message: TextSchema, errors: z.array(FieldErrorSchema).optional(), requestId: TextSchema });
export type DomainError = z.infer<typeof DomainErrorSchema>;
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export function utf8Bytes(value: string): number { return new TextEncoder().encode(value).byteLength; }
export function isUtf16Boundary(text: string, offset: number): boolean {
  if (offset < 0 || offset > text.length) return false;
  if (offset === 0 || offset === text.length) return true;
  const previous = text.charCodeAt(offset - 1), next = text.charCodeAt(offset);
  return !(previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff);
}
export function boundedJson<T extends z.ZodType>(schema: T, bytes: number): T {
  return schema.refine(value => utf8Bytes(JSON.stringify(value)) <= bytes, `JSON exceeds ${bytes} UTF-8 bytes`);
}
