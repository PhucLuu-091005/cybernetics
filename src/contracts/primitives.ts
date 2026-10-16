import { z } from 'zod';

export const IdSchema = z.uuid();
export const RevisionSchema = z.number().int().nonnegative();
export const TimestampSchema = z.iso.datetime({ offset: true });
export const IdempotencyKeySchema = z.string().min(1).max(256);
export const TextSchema = z.string().min(1);
export const TimeZoneSchema = z
  .string()
  .min(1)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'Invalid IANA time zone');
export const PageInputSchema = z.strictObject({
  cursor: z.string().max(4096).nullable().optional(),
  limit: z.number().int().min(1).max(50).default(50),
});
export const ErrorCodeSchema = z.enum([
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'VALIDATION',
  'CONFLICT',
  'RATE_LIMITED',
  'LIMIT_EXCEEDED',
  'INTERNAL',
]);
export const FieldErrorSchema = z.strictObject({ path: z.string(), message: TextSchema });
export const DomainErrorSchema = z.strictObject({
  code: ErrorCodeSchema,
  message: TextSchema,
  errors: z.array(FieldErrorSchema).optional(),
  details: z.unknown().optional(),
  requestId: TextSchema,
});
export type DomainError = z.infer<typeof DomainErrorSchema>;
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
export type FieldError = z.infer<typeof FieldErrorSchema>;
