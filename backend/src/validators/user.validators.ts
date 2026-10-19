import { z } from 'zod';
import { ROLES } from '../types/domain.js';
import { boolQuery, optionalId, paginationQuery, passwordRule, searchQuery } from './common.js';

export const userListQuery = z.object({
  search: searchQuery,
  isActive: boolQuery.optional(),
  role: z.enum(ROLES).optional(),
  ...paginationQuery,
});

const userFields = {
  email: z
    .union([z.string().trim().toLowerCase().email('Invalid email address').max(150), z.literal(''), z.null()])
    .optional()
    .transform((v) => v || null),
  role: z.enum(ROLES, { errorMap: () => ({ message: 'Select a valid role' }) }),
  employeeId: optionalId,
  isActive: z.boolean().default(true),
};

const employeeLinkRule = (v: { role: string; employeeId: number | null }) =>
  v.role !== 'Employee' || v.employeeId !== null;
const employeeLinkError = {
  message: 'Employee accounts must be linked to an employee record',
  path: ['employeeId'],
};

export const createUserBody = z
  .object({
    username: z
      .string()
      .trim()
      .min(3, 'Username must be at least 3 characters')
      .max(50)
      .regex(/^[A-Za-z0-9._-]+$/, 'Use letters, numbers, dot, dash or underscore only'),
    password: passwordRule,
    mustChangePassword: z.boolean().default(true),
    ...userFields,
  })
  .refine(employeeLinkRule, employeeLinkError);
export type CreateUserInput = z.infer<typeof createUserBody>;

export const updateUserBody = z.object(userFields).refine(employeeLinkRule, employeeLinkError);
export type UpdateUserInput = z.infer<typeof updateUserBody>;

export const resetPasswordBody = z.object({ password: passwordRule });
