import { z } from 'zod';
import { passwordRule } from './common.js';

export const loginBody = z.object({
  clientId: z.string().trim().min(1, 'Client ID is required').max(30),
  /** Username or email address */
  username: z.string().trim().min(1, 'User ID or email is required').max(150),
  password: z.string().min(1, 'Password is required').max(128),
});

export const changePasswordBody = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required').max(128),
    newPassword: passwordRule,
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: 'New password must be different from the current password',
    path: ['newPassword'],
  });
