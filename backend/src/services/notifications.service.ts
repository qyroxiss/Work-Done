import { query, sql, type Params, type Row } from '../database/pool.js';
import type { AuthUser } from '../types/domain.js';
import { localDayStart, parseDateOnly, toIso, todayLocal } from '../utils/dates.js';
import { inList } from '../utils/sqlHelpers.js';
import { publish } from './chatHub.js';

/**
 * In-app notifications: stored per user in the client's database and pushed live over the same
 * event stream as chat. Nobody is ever notified about their own action.
 */

export const NOTIFICATION_KINDS = ['Assigned', 'Status', 'Note', 'Mention', 'Attachment', 'DueToday', 'Overdue', 'Created'] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

const OPEN_STATUS_SQL = `N'Pending', N'In Progress', N'On Hold', N'Reopened'`;

function mapNotification(r: Row) {
  return {
    notificationId: Number(r.NotificationId),
    kind: r.Kind as NotificationKind,
    workId: r.WorkId as number | null,
    actorName: (r.ActorName ?? null) as string | null,
    message: r.Message as string,
    createdAt: toIso(r.CreatedAt),
    readAt: toIso(r.ReadAt),
  };
}
export type AppNotification = ReturnType<typeof mapNotification>;

export function actorName(user: AuthUser): string {
  return user.employeeName ?? user.username;
}

/** "@priya", "@a.sharma" -> usernames (lower-case, unique). A trailing dot ends the sentence, not the name. */
export function extractMentions(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/(^|[^\w@.])@([A-Za-z0-9._-]{3,50})/g)) {
    const name = m[2].replace(/[._-]+$/, '');
    if (name.length >= 3) found.add(name.toLowerCase());
  }
  return [...found];
}

export function snippet(text: string, max = 120): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Inserts one notification per user and pushes it to their open tabs. */
export async function notify(
  clientId: string,
  entry: { userIds: number[]; kind: NotificationKind; workId: number | null; actor?: AuthUser | null; message: string },
) {
  const targets = [...new Set(entry.userIds)].filter((id) => id !== entry.actor?.userId);
  if (targets.length === 0) return;
  const params: Params = {
    kind: [sql.NVarChar(20), entry.kind],
    workId: [sql.Int, entry.workId],
    actor: [sql.Int, entry.actor?.userId ?? null],
    message: [sql.NVarChar(400), entry.message.slice(0, 400)],
  };
  const values = targets
    .map((id, i) => {
      params[`u${i}`] = [sql.Int, id];
      return `(@u${i}, @kind, @workId, @actor, @message)`;
    })
    .join(', ');
  const r = await query(
    `INSERT INTO dbo.Notifications (UserId, Kind, WorkId, ActorUserId, Message)
     OUTPUT INSERTED.NotificationId, INSERTED.UserId, INSERTED.Kind, INSERTED.WorkId, INSERTED.Message, INSERTED.CreatedAt, INSERTED.ReadAt
     VALUES ${values}`,
    params,
  );
  const name = entry.actor ? actorName(entry.actor) : null;
  for (const row of r.recordset) {
    publish(clientId, [row.UserId as number], 'notification', mapNotification({ ...row, ActorName: name }));
  }
}

/** Who follows a work item: users of its active assignees, and the user who created it. */
export async function workAudience(workId: number) {
  const r = await query(
    `SELECT w.WorkNo, w.Title, w.CreatedByUserId, cu.IsActive AS CreatorActive
     FROM dbo.WorkItems w JOIN dbo.Users cu ON cu.UserId = w.CreatedByUserId WHERE w.WorkId = @id;
     SELECT u.UserId FROM dbo.WorkAssignments wa
     JOIN dbo.Users u ON u.EmployeeId = wa.EmployeeId AND u.IsActive = 1
     WHERE wa.WorkId = @id AND wa.IsActive = 1;`,
    { id: [sql.Int, workId] },
  );
  const [workRows, userRows] = r.recordsets as unknown as Row[][];
  const work = workRows[0];
  const assigneeUserIds = userRows.map((u) => u.UserId as number);
  const creatorUserId = work?.CreatorActive ? (work.CreatedByUserId as number) : null;
  return {
    workNo: (work?.WorkNo ?? '') as string,
    title: (work?.Title ?? '') as string,
    assigneeUserIds,
    creatorUserId,
    everyone: [...new Set([...assigneeUserIds, ...(creatorUserId ? [creatorUserId] : [])])],
  };
}

/** Users of the given employees (to notify newly assigned people). */
export async function userIdsForEmployees(employeeIds: number[]): Promise<number[]> {
  if (employeeIds.length === 0) return [];
  const params: Params = {};
  const list = inList(params, 'e', employeeIds, sql.Int);
  const r = await query(`SELECT UserId FROM dbo.Users WHERE IsActive = 1 AND EmployeeId IN (${list})`, params);
  return r.recordset.map((u) => u.UserId as number);
}

/**
 * Resolves @usernames to users who may see the work item (managers, or employees assigned to it),
 * so a mention never reveals work to someone who cannot open it.
 */
export async function mentionedUserIds(workId: number, usernames: string[]): Promise<number[]> {
  if (usernames.length === 0) return [];
  const params: Params = { workId: [sql.Int, workId] };
  const list = inList(params, 'n', usernames, sql.NVarChar(50));
  const r = await query(
    `SELECT u.UserId FROM dbo.Users u
     WHERE u.IsActive = 1 AND LOWER(u.Username) IN (${list})
       AND (u.Role IN (N'Admin', N'Manager')
            OR EXISTS (SELECT 1 FROM dbo.WorkAssignments wa WHERE wa.WorkId = @workId AND wa.IsActive = 1 AND wa.EmployeeId = u.EmployeeId))`,
    params,
  );
  return r.recordset.map((u) => u.UserId as number);
}

/** People who can be @mentioned on a work item (for the note box suggestions). */
export async function mentionableUsers(workId: number) {
  const r = await query(
    `SELECT u.UserId, u.Username, COALESCE(e.EmployeeName, u.Username) AS Name, u.Role
     FROM dbo.Users u LEFT JOIN dbo.Employees e ON e.EmployeeId = u.EmployeeId
     WHERE u.IsActive = 1
       AND (u.Role IN (N'Admin', N'Manager')
            OR EXISTS (SELECT 1 FROM dbo.WorkAssignments wa WHERE wa.WorkId = @workId AND wa.IsActive = 1 AND wa.EmployeeId = u.EmployeeId))
     ORDER BY Name`,
    { workId: [sql.Int, workId] },
  );
  return r.recordset.map((u) => ({ userId: u.UserId as number, username: u.Username as string, name: u.Name as string, role: u.Role as string }));
}

export async function listNotifications(user: AuthUser, limit: number, beforeId?: number) {
  const r = await query(
    `SELECT TOP (@limit) n.NotificationId, n.Kind, n.WorkId, n.Message, n.CreatedAt, n.ReadAt,
            COALESCE(ae.EmployeeName, au.Username) AS ActorName
     FROM dbo.Notifications n
     LEFT JOIN dbo.Users au ON au.UserId = n.ActorUserId
     LEFT JOIN dbo.Employees ae ON ae.EmployeeId = au.EmployeeId
     WHERE n.UserId = @me AND (@before IS NULL OR n.NotificationId < @before)
     ORDER BY n.NotificationId DESC;
     SELECT COUNT(*) AS Unread FROM dbo.Notifications WHERE UserId = @me AND ReadAt IS NULL;`,
    { me: [sql.Int, user.userId], limit: [sql.Int, limit], before: [sql.BigInt, beforeId ?? null] },
  );
  const [rows, count] = r.recordsets as unknown as Row[][];
  return { items: rows.map(mapNotification), unread: Number(count[0]?.Unread ?? 0) };
}

export async function unreadCount(user: AuthUser): Promise<number> {
  const r = await query(`SELECT COUNT(*) AS Unread FROM dbo.Notifications WHERE UserId = @me AND ReadAt IS NULL`, {
    me: [sql.Int, user.userId],
  });
  return Number(r.recordset[0]?.Unread ?? 0);
}

/** Marks the given notifications (or all of them) as read. Other open tabs refresh their badge. */
export async function markRead(user: AuthUser, ids: number[] | 'all') {
  const params: Params = { me: [sql.Int, user.userId] };
  const filter = ids === 'all' ? '' : ids.length ? `AND NotificationId IN (${inList(params, 'n', ids, sql.BigInt)})` : 'AND 1 = 0';
  await query(`UPDATE dbo.Notifications SET ReadAt = SYSUTCDATETIME() WHERE UserId = @me AND ReadAt IS NULL ${filter}`, params);
  const unread = await unreadCount(user);
  publish(user.clientId, [user.userId], 'notifications-read', { unread });
  return { unread };
}

/**
 * Morning reminders, run by the background job: "due today" for assignees, and "overdue" (once per due
 * date) for assignees and the person who created the work. Safe to run repeatedly.
 */
export async function sendDueAlerts(clientId: string) {
  const today = todayLocal();
  const r = await query(
    `INSERT INTO dbo.Notifications (UserId, Kind, WorkId, Message)
     OUTPUT INSERTED.NotificationId, INSERTED.UserId, INSERTED.Kind, INSERTED.WorkId, INSERTED.Message, INSERTED.CreatedAt, INSERTED.ReadAt
     SELECT u.UserId, N'DueToday', w.WorkId, LEFT(w.WorkNo + N' is due today: ' + w.Title, 400)
     FROM dbo.WorkItems w
     JOIN dbo.WorkAssignments wa ON wa.WorkId = w.WorkId AND wa.IsActive = 1
     JOIN dbo.Users u ON u.EmployeeId = wa.EmployeeId AND u.IsActive = 1
     WHERE w.DueDate = @today AND w.Status IN (${OPEN_STATUS_SQL})
       AND NOT EXISTS (SELECT 1 FROM dbo.Notifications n
                       WHERE n.WorkId = w.WorkId AND n.UserId = u.UserId AND n.Kind = N'DueToday' AND n.CreatedAt >= @dayStart);

     WITH Late AS (
       SELECT w.WorkId, w.WorkNo, w.Title, w.DueDate FROM dbo.WorkItems w
       WHERE w.DueDate < @today AND w.Status IN (${OPEN_STATUS_SQL})
     ), Recipients AS (
       SELECT l.WorkId, u.UserId FROM Late l
       JOIN dbo.WorkAssignments wa ON wa.WorkId = l.WorkId AND wa.IsActive = 1
       JOIN dbo.Users u ON u.EmployeeId = wa.EmployeeId AND u.IsActive = 1
       UNION
       SELECT l.WorkId, w.CreatedByUserId FROM Late l
       JOIN dbo.WorkItems w ON w.WorkId = l.WorkId
       JOIN dbo.Users cu ON cu.UserId = w.CreatedByUserId AND cu.IsActive = 1
     )
     INSERT INTO dbo.Notifications (UserId, Kind, WorkId, Message)
     OUTPUT INSERTED.NotificationId, INSERTED.UserId, INSERTED.Kind, INSERTED.WorkId, INSERTED.Message, INSERTED.CreatedAt, INSERTED.ReadAt
     SELECT r.UserId, N'Overdue', l.WorkId, LEFT(l.WorkNo + N' is overdue: ' + l.Title, 400)
     FROM Recipients r JOIN Late l ON l.WorkId = r.WorkId
     WHERE NOT EXISTS (SELECT 1 FROM dbo.Notifications n
                       WHERE n.WorkId = l.WorkId AND n.UserId = r.UserId AND n.Kind = N'Overdue'
                         AND n.CreatedAt > CAST(l.DueDate AS DATETIME2(0)));`,
    { today: [sql.Date, parseDateOnly(today)], dayStart: [sql.DateTime2(0), localDayStart(today)] },
  );
  let sent = 0;
  for (const set of r.recordsets as unknown as Row[][]) {
    for (const row of set) {
      publish(clientId, [row.UserId as number], 'notification', mapNotification({ ...row, ActorName: null }));
      sent++;
    }
  }
  return sent;
}
