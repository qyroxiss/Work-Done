import { z } from 'zod';
import { PRIORITIES, WORK_STATUSES } from '../types/domain.js';
import {
  boolQuery,
  dateOnly,
  optionalDate,
  optionalId,
  optionalText,
  paginationQuery,
  requiredText,
  searchQuery,
} from './common.js';

const employeeIds = z
  .array(z.coerce.number().int().positive())
  .max(50, 'Too many employees selected')
  .transform((ids) => [...new Set(ids)]);

const workFields = z.object({
  title: requiredText(200, 'Title'),
  description: optionalText(8000),
  productGroupId: optionalId,
  productId: optionalId,
  priority: z.enum(PRIORITIES, { errorMap: () => ({ message: 'Select a valid priority' }) }),
  startDate: optionalDate,
  dueDate: optionalDate,
});

const datesInOrder = (v: { startDate: string | null; dueDate: string | null }) =>
  !v.startDate || !v.dueDate || v.dueDate >= v.startDate;
const datesError = { message: 'Due date cannot be before the start date', path: ['dueDate'] };

export const createWorkBody = workFields
  .extend({ employeeIds: employeeIds.default([]) })
  .refine(datesInOrder, datesError);
export type CreateWorkInput = z.infer<typeof createWorkBody>;

export const updateWorkBody = workFields
  .extend({
    employeeIds: employeeIds.optional(),
    rowVersion: z.string().regex(/^[0-9a-f]{16}$/i, 'Invalid row version'),
  })
  .refine(datesInOrder, datesError);
export type UpdateWorkInput = z.infer<typeof updateWorkBody>;

export const assignmentsBody = z.object({ employeeIds });

export const statusBody = z.object({
  status: z.enum(WORK_STATUSES, { errorMap: () => ({ message: 'Select a valid status' }) }),
  notes: optionalText(2000),
  rowVersion: z.string().regex(/^[0-9a-f]{16}$/i, 'Invalid row version'),
});
export type StatusInput = z.infer<typeof statusBody>;

export const noteBody = z.object({
  notes: requiredText(2000, 'Note'),
});

const statusList = z
  .string()
  .max(200)
  .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean))
  .pipe(z.array(z.enum(WORK_STATUSES)));

export const SORT_KEYS = [
  'workNo',
  'title',
  'priority',
  'status',
  'startDate',
  'dueDate',
  'createdAt',
  'updatedAt',
  'product',
] as const;

export const workListQuery = z
  .object({
    search: searchQuery,
    status: statusList.optional(),
    priority: z.enum(PRIORITIES).optional(),
    employeeId: z.coerce.number().int().positive().optional(),
    productGroupId: z.coerce.number().int().positive().optional(),
    productId: z.coerce.number().int().positive().optional(),
    assignment: z.enum(['assigned', 'unassigned']).optional(),
    dateField: z.enum(['due', 'start', 'created']).default('due'),
    fromDate: dateOnly.optional(),
    toDate: dateOnly.optional(),
    overdue: boolQuery.optional(),
    sortBy: z.enum(SORT_KEYS).default('updatedAt'),
    sortDir: z.enum(['asc', 'desc']).default('desc'),
    ...paginationQuery,
  })
  .refine((v) => !v.fromDate || !v.toDate || v.toDate >= v.fromDate, {
    message: '"To" date cannot be before "From" date',
    path: ['toDate'],
  });
export type WorkListQuery = z.infer<typeof workListQuery>;
