import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as auth from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/auth.js';

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many failed login attempts. Please wait 15 minutes and try again.', code: 'RATE_LIMITED' },
});

const passwordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait and try again.', code: 'RATE_LIMITED' },
});

export const authRoutes = Router();

authRoutes.post('/login', loginLimiter, auth.login);
authRoutes.post('/logout', authenticate, auth.logout);
authRoutes.get('/me', authenticate, auth.me);
authRoutes.post('/change-password', passwordLimiter, authenticate, auth.changePassword);
