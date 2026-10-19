import { query, sql } from '../database/pool.js';

export type SecurityEventType =
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILED'
  | 'LOGIN_BLOCKED_INACTIVE'
  | 'LOGOUT'
  | 'PASSWORD_CHANGED'
  | 'PASSWORD_RESET'
  | 'USER_CREATED'
  | 'USER_UPDATED'
  | 'ADMIN_BOOTSTRAP'
  | 'SETTINGS_UPDATED';

interface EventInfo {
  userId?: number | null;
  username?: string | null;
  ip?: string | null;
  details?: string | null;
}

/**
 * Records a security-relevant event. Never pass passwords, tokens or hashes in `details`.
 * Failures are logged but never break the calling request.
 */
export async function logSecurityEvent(type: SecurityEventType, info: EventInfo = {}): Promise<void> {
  try {
    await query(
      `INSERT INTO dbo.SecurityEvents (EventType, UserId, Username, IpAddress, Details)
       VALUES (@type, @userId, @username, @ip, @details)`,
      {
        type: [sql.NVarChar(50), type],
        userId: [sql.Int, info.userId ?? null],
        username: [sql.NVarChar(50), info.username?.slice(0, 50) ?? null],
        ip: [sql.NVarChar(64), info.ip?.slice(0, 64) ?? null],
        details: [sql.NVarChar(500), info.details?.slice(0, 500) ?? null],
      },
    );
  } catch (err) {
    console.error('[audit] failed to record security event', type, (err as Error).message);
  }
}
