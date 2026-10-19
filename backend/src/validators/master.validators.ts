import { z } from 'zod';
import {
  boolQuery,
  code,
  optionalDate,
  optionalText,
  paginationQuery,
  requiredText,
  searchQuery,
} from './common.js';

export const masterListQuery = z.object({
  search: searchQuery,
  isActive: boolQuery.optional(),
  ...paginationQuery,
});

export const employeeBody = z.object({
  employeeCode: code('Employee code'),
  employeeName: requiredText(100, 'Employee name'),
  department: optionalText(100),
  phone: optionalText(30).refine((v) => v === null || /^[0-9+\-() ]{5,30}$/.test(v), 'Invalid phone number'),
  email: z
    .union([z.string().trim().email('Invalid email address').max(150), z.literal(''), z.null()])
    .optional()
    .transform((v) => v || null),
  joiningDate: optionalDate,
  isActive: z.boolean().default(true),
});
export type EmployeeInput = z.infer<typeof employeeBody>;

export const productGroupBody = z.object({
  groupCode: code('Group code'),
  groupName: requiredText(100, 'Group name'),
  description: optionalText(500),
  isActive: z.boolean().default(true),
});
export type ProductGroupInput = z.infer<typeof productGroupBody>;

export const productListQuery = masterListQuery.extend({
  productGroupId: z.coerce.number().int().positive().optional(),
});

export const productBody = z.object({
  productCode: code('Product code'),
  productName: requiredText(150, 'Product name'),
  productGroupId: z.coerce
    .number({ invalid_type_error: 'Product group is required' })
    .int()
    .positive('Product group is required'),
  description: optionalText(500),
  isActive: z.boolean().default(true),
});
export type ProductInput = z.infer<typeof productBody>;
