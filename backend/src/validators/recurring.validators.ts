import { z } from 'zod';
import { PRIORITIES } from '../types/domain.js';
import { FREQUENCIES } from '../services/recurrence.js';
import { boolQuery, dateOnly, optionalDate, optionalId, optionalText, paginationQuery, requiredText, searchQuery } from './common.js';

export const recurringBody = z
  .object({
    title: requiredText(200, 'Title'),
    description: optionalText(8000),
    productGroupId: optionalId,
    productId: optionalId,
    priority: z.enum(PRIORITIES, { errorMap: () => ({ message: 'Select a valid priority' }) }),
    frequency: z.enum(FREQUENCIES, { errorMap: () => ({ message: 'Select how often it repeats' }) }),
    nextDueDate: dateOnly,
    leadDays: z.coerce.number().int().min(0, 'Cannot be negative').max(90, 'At most 90 days'),
    endDate: optionalDate,
    employeeIds: z
      .array(z.coerce.number().int().positive())
      .max(50, 'Too many employees selected')
      .default([])
      .transform((ids) => [...new Set(ids)]),
    isActive: z.boolean().default(true),
  })
  .refine((v) => !v.endDate || v.endDate >= v.nextDueDate, { message: 'The end date cannot be before the next due date', path: ['endDate'] });
export type RecurringInput = z.infer<typeof recurringBody>;

export const recurringListQuery = z.object({
  search: searchQuery,
  isActive: boolQuery.optional(),
  ...paginationQuery,
});
export type RecurringListQuery = z.infer<typeof recurringListQuery>;
