import type { Request, Response } from 'express';
import { config } from '../config/env.js';
import { currentUser, SESSION_COOKIE, sessionCookieOptions } from '../middleware/auth.js';
import * as authService from '../services/auth.service.js';
import { getClient } from '../services/clients.service.js';
import type { AuthUser } from '../types/domain.js';
import { changePasswordBody, loginBody } from '../validators/auth.validators.js';

function publicUser(user: AuthUser) {
  const { sessionId: _sessionId, ...rest } = user;
  return rest;
}

async function sessionInfo(user: AuthUser) {
  const client = await getClient(user.clientId);
  return {
    session: { idleMinutes: config.session.idleMinutes },
    company: { name: client.companyName, clientId: client.clientId },
  };
}

export async function login(req: Request, res: Response) {
  const { clientId, username, password } = loginBody.parse(req.body);
  const { cookie, user } = await authService.login(clientId, username, password, {
    ip: req.ip,
    userAgent: req.get('user-agent'),
  });
  res.cookie(SESSION_COOKIE, cookie, sessionCookieOptions);
  res.json({ user: publicUser(user), ...(await sessionInfo(user)) });
}

export async function logout(req: Request, res: Response) {
  await authService.logout(currentUser(req), req.ip);
  res.clearCookie(SESSION_COOKIE, sessionCookieOptions);
  res.status(204).end();
}

export async function me(req: Request, res: Response) {
  const user = currentUser(req);
  res.json({ user: publicUser(user), ...(await sessionInfo(user)) });
}

export async function changePassword(req: Request, res: Response) {
  const { currentPassword, newPassword } = changePasswordBody.parse(req.body);
  const user = currentUser(req);
  await authService.changePassword(user, currentPassword, newPassword, req.ip);
  res.json({ user: publicUser({ ...user, mustChangePassword: false }) });
}
