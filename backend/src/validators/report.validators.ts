import { z } from 'zod';
import { dateOnly } from './common.js';

const filters = {
  employeeId: z.coerce.number().int().positive().optional(),
  productGroupId: z.coerce.number().int().positive().optional(),
};

const rangeOrder = (v: { fromDate?: string; toDate?: string }) =>
  !v.fromDate || !v.toDate || v.toDate >= v.fromDate;
const rangeError = { message: '"To" date cannot be before "From" date', path: ['toDate'] };

export const optionalRangeQuery = z
  .object({ fromDate: dateOnly.optional(), toDate: dateOnly.optional(), ...filters })
  .refine(rangeOrder, rangeError);
export type OptionalRangeQuery = z.infer<typeof optionalRangeQuery>;

export const requiredRangeQuery = z
  .object({ fromDate: dateOnly, toDate: dateOnly, ...filters })
  .refine(rangeOrder, rangeError)
  .refine(
    (v) => (Date.parse(v.toDate) - Date.parse(v.fromDate)) / 86_400_000 <= 366,
    { message: 'Date range cannot exceed 366 days', path: ['toDate'] },
  );
export type RequiredRangeQuery = z.infer<typeof requiredRangeQuery>;

export const listFilterQuery = z.object(filters);
export type ListFilterQuery = z.infer<typeof listFilterQuery>;
