import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { config } from '../config/env.js';
import { query, runInDatabase, sql } from '../database/pool.js';
import type { AuthUser, Role } from '../types/domain.js';
import { HttpError } from '../utils/httpError.js';
import { logSecurityEvent } from './audit.service.js';
import { findClient, listClients, type Client } from './clients.service.js';

export const BCRYPT_ROUNDS = 12;

// Compared against when the username does not exist, so response time does not reveal valid usernames.
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), BCRYPT_ROUNDS);

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

interface RequestMeta {
  ip: string | undefined;
  userAgent: string | undefined;
}

export const INVALID_LOGIN_MESSAGE = 'Invalid Client ID, User ID or password.';

/**
 * The session cookie holds "<ClientId>.<random token>": the Client ID routes each request to that
 * client's database, where only the SHA-256 hash of the token is stored.
 */
export function parseSessionCookie(value: string): { clientId: string; token: string } | null {
  if (value.length > 150) return null;
  const dot = value.lastIndexOf('.'); // base64url tokens never contain '.', Client IDs may
  if (dot <= 0 || dot === value.length - 1) return null;
  return { clientId: value.slice(0, dot), token: value.slice(dot + 1) };
}

/**
 * @param clientId   Client ID of the company; selects the database to sign in to
 * @param identifier username, or email address (contains "@")
 */
export async function login(
  clientId: string,
  identifier: string,
  password: string,
  meta: RequestMeta,
): Promise<{ cookie: string; user: AuthUser; client: Client }> {
  const client = await findClient(clientId);
  if (!client) {
    // Same work and message as a wrong password, so Client IDs cannot be probed by timing
    await bcrypt.compare(password, DUMMY_HASH);
    await logSecurityEvent('LOGIN_FAILED', {
      username: identifier.slice(0, 50),
      ip: meta.ip,
      details: `Unknown Client ID "${clientId.slice(0, 30)}"`,
    });
    throw new HttpError(401, INVALID_LOGIN_MESSAGE, 'INVALID_CREDENTIALS');
  }
  return runInDatabase(client.databaseName, async () => {
    const result = await loginToClient(client, identifier, password, meta);
    return { ...result, client };
  });
}

/** Signs in to the current client database (runs inside runInDatabase). */
async function loginToClient(client: Client, identifier: string, password: string, meta: RequestMeta) {
  const byEmail = identifier.includes('@');
  const result = await query(
    `SELECT u.UserId, u.Username, u.PasswordHash, u.Role, u.EmployeeId, u.IsActive,
            u.MustChangePassword, e.EmployeeName, e.IsActive AS EmployeeActive
     FROM dbo.Users u
     LEFT JOIN dbo.Employees e ON e.EmployeeId = u.EmployeeId
     WHERE ${byEmail ? 'u.Email = @id' : 'u.Username = @id'} AND u.ClientId = @clientId`,
    { id: [sql.NVarChar(150), identifier], clientId: [sql.NVarChar(30), client.clientId] },
  );
  const row = result.recordset[0];
  // Always run bcrypt so response time does not reveal whether the user exists
  const passwordOk = await bcrypt.compare(password, row?.PasswordHash ?? DUMMY_HASH);

  if (!row || !passwordOk) {
    await logSecurityEvent('LOGIN_FAILED', { userId: row?.UserId, username: identifier.slice(0, 50), ip: meta.ip });
    throw new HttpError(401, INVALID_LOGIN_MESSAGE, 'INVALID_CREDENTIALS');
  }
  const username = row.Username as string;
  if (!client.isActive) {
    await logSecurityEvent('LOGIN_BLOCKED_INACTIVE', { userId: row.UserId, username, ip: meta.ip, details: 'Client is inactive' });
    throw new HttpError(403, 'This company account is inactive. Please contact your service provider.', 'CLIENT_INACTIVE');
  }
  if (!row.IsActive || (row.EmployeeId !== null && !row.EmployeeActive)) {
    await logSecurityEvent('LOGIN_BLOCKED_INACTIVE', { userId: row.UserId, username, ip: meta.ip });
    throw new HttpError(403, 'Your account is inactive. Please contact the administrator.', 'INACTIVE');
  }

  const token = crypto.randomBytes(32).toString('base64url');
  const inserted = await query(
    `INSERT INTO dbo.Sessions (TokenHash, UserId, ExpiresAt, IpAddress, UserAgent)
     OUTPUT INSERTED.SessionId
     VALUES (@hash, @userId, DATEADD(HOUR, @hours, SYSUTCDATETIME()), @ip, @ua);
     UPDATE dbo.Users SET LastLoginAt = SYSUTCDATETIME() WHERE UserId = @userId;`,
    {
      hash: [sql.Char(64), hashToken(token)],
      userId: [sql.Int, row.UserId],
      hours: [sql.Int, config.session.maxHours],
      ip: [sql.NVarChar(64), meta.ip?.slice(0, 64) ?? null],
      ua: [sql.NVarChar(300), meta.userAgent?.slice(0, 300) ?? null],
    },
  );
  await logSecurityEvent('LOGIN_SUCCESS', { userId: row.UserId, username: row.Username, ip: meta.ip });

  return {
    cookie: `${client.clientId}.${token}`,
    user: {
      userId: row.UserId,
      username: row.Username,
      role: row.Role as Role,
      employeeId: row.EmployeeId,
      employeeName: row.EmployeeName ?? null,
      mustChangePassword: Boolean(row.MustChangePassword),
      sessionId: Number(inserted.recordset[0].SessionId),
      clientId: client.clientId,
    } satisfies AuthUser,
  };
}

/**
 * Resolves a session token to the current user (runs inside the client's database). Returns null when
 * the session is unknown, revoked, idle too long, past its maximum lifetime, or the user/employee is inactive.
 */
export async function getSessionUser(token: string, client: Client): Promise<AuthUser | null> {
  if (token.length > 100) return null;
  const result = await query(
    `SELECT s.SessionId, DATEDIFF(SECOND, s.LastSeenAt, SYSUTCDATETIME()) AS IdleSeconds,
            u.UserId, u.Username, u.Role, u.EmployeeId, u.MustChangePassword, e.EmployeeName
     FROM dbo.Sessions s
     JOIN dbo.Users u ON u.UserId = s.UserId
     LEFT JOIN dbo.Employees e ON e.EmployeeId = u.EmployeeId
     WHERE s.TokenHash = @hash
       AND s.RevokedAt IS NULL
       AND s.ExpiresAt > SYSUTCDATETIME()
       AND s.LastSeenAt > DATEADD(MINUTE, -@idle, SYSUTCDATETIME())
       AND u.IsActive = 1
       AND u.ClientId = @clientId
       AND (u.EmployeeId IS NULL OR e.IsActive = 1)`,
    {
      hash: [sql.Char(64), hashToken(token)],
      idle: [sql.Int, config.session.idleMinutes],
      clientId: [sql.NVarChar(30), client.clientId],
    },
  );
  const row = result.recordset[0];
  if (!row) return null;

  // Sliding inactivity window; throttle writes to at most once a minute per session
  if (row.IdleSeconds >= 60) {
    await query(`UPDATE dbo.Sessions SET LastSeenAt = SYSUTCDATETIME() WHERE SessionId = @id`, {
      id: [sql.BigInt, row.SessionId],
    });
  }

  return {
    userId: row.UserId,
    username: row.Username,
    role: row.Role as Role,
    employeeId: row.EmployeeId,
    employeeName: row.EmployeeName ?? null,
    mustChangePassword: Boolean(row.MustChangePassword),
    sessionId: Number(row.SessionId),
    clientId: client.clientId,
  };
}

export async function logout(user: AuthUser, ip: string | undefined): Promise<void> {
  await query(
    `UPDATE dbo.Sessions SET RevokedAt = SYSUTCDATETIME() WHERE SessionId = @id AND RevokedAt IS NULL`,
    { id: [sql.BigInt, user.sessionId] },
  );
  await logSecurityEvent('LOGOUT', { userId: user.userId, username: user.username, ip });
}

export async function revokeUserSessions(userId: number, exceptSessionId?: number): Promise<void> {
  await query(
    `UPDATE dbo.Sessions SET RevokedAt = SYSUTCDATETIME()
     WHERE UserId = @userId AND RevokedAt IS NULL AND (@except IS NULL OR SessionId <> @except)`,
    { userId: [sql.Int, userId], except: [sql.BigInt, exceptSessionId ?? null] },
  );
}

export async function changePassword(
  user: AuthUser,
  currentPassword: string,
  newPassword: string,
  ip: string | undefined,
): Promise<void> {
  const result = await query(`SELECT PasswordHash FROM dbo.Users WHERE UserId = @id`, {
    id: [sql.Int, user.userId],
  });
  const hash = result.recordset[0]?.PasswordHash;
  if (!hash || !(await bcrypt.compare(currentPassword, hash))) {
    throw new HttpError(400, 'Current password is incorrect.', 'INVALID_PASSWORD');
  }
  await query(
    `UPDATE dbo.Users SET PasswordHash = @hash, MustChangePassword = 0, UpdatedAt = SYSUTCDATETIME()
     WHERE UserId = @id`,
    { hash: [sql.NVarChar(255), await hashPassword(newPassword)], id: [sql.Int, user.userId] },
  );
  // Sign out every other device that used the old password
  await revokeUserSessions(user.userId, user.sessionId);
  await logSecurityEvent('PASSWORD_CHANGED', { userId: user.userId, username: user.username, ip });
}

/** Removes sessions that ended more than 7 days ago (in the current client database). */
export async function purgeOldSessions(): Promise<void> {
  await query(
    `DELETE FROM dbo.Sessions
     WHERE (RevokedAt IS NOT NULL AND RevokedAt < DATEADD(DAY, -7, SYSUTCDATETIME()))
        OR ExpiresAt < DATEADD(DAY, -7, SYSUTCDATETIME())`,
  );
}

/** Runs the session cleanup in every client database. */
export async function purgeOldSessionsAllClients(): Promise<void> {
  for (const client of await listClients()) {
    await runInDatabase(client.databaseName, purgeOldSessions).catch((err: Error) =>
      console.error(`[sessions] cleanup failed for ${client.clientId}:`, err.message),
    );
  }
}
