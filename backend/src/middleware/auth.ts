import type { CookieOptions, RequestHandler } from 'express';
import { config } from '../config/env.js';
import { runInDatabase } from '../database/pool.js';
import { getSessionUser, parseSessionCookie } from '../services/auth.service.js';
import { findClient } from '../services/clients.service.js';
import type { Role } from '../types/domain.js';
import { forbidden, HttpError } from '../utils/httpError.js';

export const SESSION_COOKIE = 'wd_session';

export const sessionCookieOptions: CookieOptions = {
  httpOnly: true,
  sameSite: 'strict',
  secure: config.session.cookieSecure,
  path: '/',
  // No maxAge: browser-session cookie. The server enforces idle and absolute expiry.
};

/** Endpoints a user may call while a password change is pending. */
const PASSWORD_CHANGE_ALLOWED = new Set(['/api/auth/me', '/api/auth/logout', '/api/auth/change-password']);

export const authenticate: RequestHandler = async (req, res, next) => {
  const cookie: unknown = req.cookies?.[SESSION_COOKIE];
  if (typeof cookie !== 'string' || cookie === '') {
    throw new HttpError(401, 'Please log in to continue.', 'UNAUTHENTICATED');
  }
  const session = parseSessionCookie(cookie);
  const client = session ? await findClient(session.clientId) : null;
  if (!session || !client?.isActive) {
    res.clearCookie(SESSION_COOKIE, sessionCookieOptions);
    throw new HttpError(401, 'Your session has expired. Please log in again.', 'UNAUTHENTICATED');
  }

  // Everything after this point (including the route handler) uses the client's database
  await runInDatabase(client.databaseName, async () => {
    const user = await getSessionUser(session.token, client);
    if (!user) {
      res.clearCookie(SESSION_COOKIE, sessionCookieOptions);
      throw new HttpError(401, 'Your session has expired. Please log in again.', 'UNAUTHENTICATED');
    }
    req.user = user;

    const path = req.originalUrl.split('?')[0];
    if (user.mustChangePassword && !PASSWORD_CHANGE_ALLOWED.has(path)) {
      throw new HttpError(403, 'You must change your password before continuing.', 'PASSWORD_CHANGE_REQUIRED');
    }
    next();
  });
};

export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      next(forbidden());
      return;
    }
    next();
  };
}

/** Returns the authenticated user; only call after `authenticate`. */
export function currentUser(req: Parameters<RequestHandler>[0]) {
  if (!req.user) throw new HttpError(401, 'Please log in to continue.', 'UNAUTHENTICATED');
  return req.user;
}
