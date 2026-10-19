import { z } from 'zod';

export const idParam = z.object({ id: z.coerce.number().int().positive() });

export const paginationQuery = {
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(25),
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const dateOnly = z
  .string()
  .regex(DATE_RE, 'Use the format YYYY-MM-DD')
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, 'Invalid date');

/** Optional date: accepts "YYYY-MM-DD", "" or null and yields string | null */
export const optionalDate = z
  .union([dateOnly, z.literal(''), z.null()])
  .optional()
  .transform((v) => v || null);

/** Optional trimmed text; empty becomes null */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Must be at most ${max} characters`)
    .nullish()
    .transform((v) => (v ? v : null));

export const requiredText = (max: number, label = 'This field') =>
  z
    .string({ required_error: `${label} is required` })
    .trim()
    .min(1, `${label} is required`)
    .max(max, `Must be at most ${max} characters`);

export const code = (label: string) =>
  requiredText(20, label)
    .regex(/^[A-Za-z0-9._\-/]+$/, 'Use letters, numbers, dot, dash, underscore or slash only')
    .transform((v) => v.toUpperCase());

export const boolQuery = z.enum(['true', 'false']).transform((v) => v === 'true');

export const searchQuery = z.string().trim().max(100).optional();

export const optionalId = z
  .union([z.coerce.number().int().positive(), z.literal(''), z.null()])
  .optional()
  .transform((v) => (typeof v === 'number' ? v : null));

export const clientIdRule = z
  .string({ required_error: 'Client ID is required' })
  .trim()
  .min(2, 'Client ID must be at least 2 characters')
  .max(30, 'Client ID must be at most 30 characters')
  .regex(/^[A-Za-z0-9._-]+$/, 'Use letters, numbers, dot, dash or underscore only')
  .transform((v) => v.toUpperCase());

export const companyNameRule = z.string().trim().min(1, 'Company name is required').max(150);

export const companyBody = z.object({
  companyName: companyNameRule,
  clientId: clientIdRule,
});

export const passwordRule = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'Password must contain letters and numbers');
