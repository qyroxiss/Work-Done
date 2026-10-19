import { query, sql, type Params, type Row } from '../database/pool.js';
import type { AuthUser, Role } from '../types/domain.js';
import { toIso } from '../utils/dates.js';
import { badRequest, notFound } from '../utils/httpError.js';
import { likeParam, pagedQuery, whereClause } from '../utils/sqlHelpers.js';
import type { CreateUserInput, UpdateUserInput } from '../validators/user.validators.js';
import { logSecurityEvent } from './audit.service.js';
import { disconnectUser } from './chatHub.js';
import { hashPassword, revokeUserSessions } from './auth.service.js';

// PasswordHash is intentionally never selected here.
const COLUMNS = `u.UserId, u.ClientId, u.Username, u.Email, u.Role, u.EmployeeId, e.EmployeeName, e.EmployeeCode,
  u.IsActive, u.MustChangePassword, u.LastLoginAt, u.CreatedAt, u.UpdatedAt`;
const FROM = `dbo.Users u LEFT JOIN dbo.Employees e ON e.EmployeeId = u.EmployeeId`;

function map(r: Row) {
  return {
    userId: r.UserId as number,
    clientId: r.ClientId as string,
    username: r.Username as string,
    email: r.Email as string | null,
    role: r.Role as Role,
    employeeId: r.EmployeeId as number | null,
    employeeName: r.EmployeeName as string | null,
    employeeCode: r.EmployeeCode as string | null,
    isActive: Boolean(r.IsActive),
    mustChangePassword: Boolean(r.MustChangePassword),
    lastLoginAt: toIso(r.LastLoginAt),
    createdAt: toIso(r.CreatedAt),
    updatedAt: toIso(r.UpdatedAt),
  };
}

async function assertEmployeeUsable(employeeId: number | null, currentEmployeeId?: number | null) {
  if (employeeId === null) return;
  const r = await query(`SELECT IsActive FROM dbo.Employees WHERE EmployeeId = @id`, { id: [sql.Int, employeeId] });
  if (!r.recordset[0]) throw badRequest('Selected employee does not exist.');
  if (!r.recordset[0].IsActive && employeeId !== currentEmployeeId) {
    throw badRequest('Selected employee is inactive.');
  }
}

export async function listUsers(q: { search?: string; isActive?: boolean; role?: Role; page: number; pageSize: number }) {
  const where: string[] = [];
  const params: Params = {};
  if (q.search) {
    where.push('(u.Username LIKE @s OR u.Email LIKE @s OR e.EmployeeName LIKE @s OR e.EmployeeCode LIKE @s)');
    params.s = likeParam(q.search);
  }
  if (q.isActive !== undefined) {
    where.push('u.IsActive = @active');
    params.active = [sql.Bit, q.isActive];
  }
  if (q.role) {
    where.push('u.Role = @role');
    params.role = [sql.NVarChar(20), q.role];
  }
  const w = whereClause(where);
  return pagedQuery(
    `SELECT COUNT(*) AS Total FROM ${FROM} ${w}`,
    `SELECT ${COLUMNS} FROM ${FROM} ${w} ORDER BY u.Username`,
    params,
    q.page,
    q.pageSize,
    map,
  );
}

export async function getUser(id: number) {
  const r = await query(`SELECT ${COLUMNS} FROM ${FROM} WHERE u.UserId = @id`, { id: [sql.Int, id] });
  if (!r.recordset[0]) throw notFound('User');
  return map(r.recordset[0]);
}

export async function createUser(data: CreateUserInput, actor: AuthUser, ip?: string) {
  await assertEmployeeUsable(data.employeeId);
  const r = await query(
    `INSERT INTO dbo.Users (ClientId, Username, Email, PasswordHash, Role, EmployeeId, MustChangePassword, IsActive)
     OUTPUT INSERTED.UserId
     VALUES (@clientId, @username, @email, @hash, @role, @employeeId, @mustChange, @active)`,
    {
      // New users always belong to the same client as the administrator creating them
      clientId: [sql.NVarChar(30), actor.clientId],
      username: [sql.NVarChar(50), data.username],
      email: [sql.NVarChar(150), data.email],
      hash: [sql.NVarChar(255), await hashPassword(data.password)],
      role: [sql.NVarChar(20), data.role],
      employeeId: [sql.Int, data.employeeId],
      mustChange: [sql.Bit, data.mustChangePassword],
      active: [sql.Bit, data.isActive],
    },
  );
  const user = await getUser(r.recordset[0].UserId);
  await logSecurityEvent('USER_CREATED', {
    userId: actor.userId,
    username: actor.username,
    ip,
    details: `Created user "${user.username}" with role ${user.role}`,
  });
  return user;
}

export async function updateUser(id: number, data: UpdateUserInput, actor: AuthUser, ip?: string) {
  const existing = await getUser(id);
  if (id === actor.userId && (data.role !== 'Admin' || !data.isActive)) {
    throw badRequest('You cannot remove your own administrator access or deactivate your own account.');
  }
  await assertEmployeeUsable(data.employeeId, existing.employeeId);

  await query(
    `UPDATE dbo.Users SET Email = @email, Role = @role, EmployeeId = @employeeId, IsActive = @active, UpdatedAt = SYSUTCDATETIME()
     WHERE UserId = @id`,
    {
      email: [sql.NVarChar(150), data.email],
      role: [sql.NVarChar(20), data.role],
      employeeId: [sql.Int, data.employeeId],
      active: [sql.Bit, data.isActive],
      id: [sql.Int, id],
    },
  );
  if (!data.isActive && existing.isActive) {
    await revokeUserSessions(id);
    disconnectUser(actor.clientId, id);
  }

  const changes: string[] = [];
  if (existing.role !== data.role) changes.push(`role ${existing.role} -> ${data.role}`);
  if (existing.isActive !== data.isActive) changes.push(data.isActive ? 'activated' : 'deactivated');
  if (existing.employeeId !== data.employeeId) changes.push('employee link changed');
  if (changes.length) {
    await logSecurityEvent('USER_UPDATED', {
      userId: actor.userId,
      username: actor.username,
      ip,
      details: `User "${existing.username}": ${changes.join(', ')}`,
    });
  }
  return getUser(id);
}

export async function resetPassword(id: number, password: string, actor: AuthUser, ip?: string) {
  const existing = await getUser(id);
  await query(
    `UPDATE dbo.Users SET PasswordHash = @hash, MustChangePassword = 1, UpdatedAt = SYSUTCDATETIME()
     WHERE UserId = @id`,
    { hash: [sql.NVarChar(255), await hashPassword(password)], id: [sql.Int, id] },
  );
  await revokeUserSessions(id);
  await logSecurityEvent('PASSWORD_RESET', {
    userId: actor.userId,
    username: actor.username,
    ip,
    details: `Password reset for user "${existing.username}"`,
  });
}
