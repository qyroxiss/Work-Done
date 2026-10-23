import { query, recordsets, sql, type Params } from '../database/pool.js';
import { WORK_STATUSES, type AuthUser, type WorkStatus } from '../types/domain.js';
import { parseDateOnly, toIso, todayLocal } from '../utils/dates.js';
import { attachAssignees, mapWorkRow } from './workItems.service.js';
import { isManager } from './workflow.js';

export async function getDashboard(user: AuthUser) {
  const manager = isManager(user.role);
  const statusCounts = Object.fromEntries(WORK_STATUSES.map((s) => [s, 0])) as Record<WorkStatus, number>;
  const empty = {
    statusCounts,
    overdue: 0,
    dueToday: 0,
    dueThisWeek: 0,
    unassigned: 0,
    upcoming: [],
    recentActivity: [],
  };
  if (!manager && !user.employeeId) return empty;

  const today = todayLocal();
  const weekEnd = new Date(`${today}T00:00:00Z`);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);

  const params: Params = {
    today: [sql.Date, parseDateOnly(today)],
    weekEnd: [sql.Date, weekEnd],
  };
  // Employees only see their own assigned work
  let scope = 'true';
  if (!manager) {
    scope = `EXISTS (SELECT 1 FROM dbo.WorkAssignments sa
                     WHERE sa.WorkId = w.WorkId AND sa.IsActive AND sa.EmployeeId = @emp)`;
    params.emp = [sql.Int, user.employeeId];
  }
  const open = `w.Status NOT IN ('Completed', 'Closed')`;

  const result = await query(
    `SELECT w.Status, COUNT(*) AS Cnt FROM dbo.WorkItems w WHERE ${scope} GROUP BY w.Status;

     SELECT
       SUM(CASE WHEN ${open} AND w.DueDate < @today THEN 1 ELSE 0 END) AS Overdue,
       SUM(CASE WHEN ${open} AND w.DueDate = @today THEN 1 ELSE 0 END) AS DueToday,
       SUM(CASE WHEN ${open} AND w.DueDate >= @today AND w.DueDate < @weekEnd THEN 1 ELSE 0 END) AS DueThisWeek,
       SUM(CASE WHEN ${open} AND a.HasAssignee IS NULL THEN 1 ELSE 0 END) AS Unassigned
     FROM dbo.WorkItems w
     LEFT JOIN LATERAL (SELECT 1 AS HasAssignee FROM dbo.WorkAssignments xa
                        WHERE xa.WorkId = w.WorkId AND xa.IsActive LIMIT 1) a ON true
     WHERE ${scope};

     SELECT w.WorkId, w.WorkNo, w.Title, w.Priority, w.Status, w.StartDate, w.DueDate,
            w.CreatedAt, w.UpdatedAt, w.ClosedAt, w.ProductId, p.ProductCode, p.ProductName,
            w.ProductGroupId, g.GroupName,
            (w.DueDate < @today) AS IsOverdue
     FROM dbo.WorkItems w
     LEFT JOIN dbo.Products p ON p.ProductId = w.ProductId
     LEFT JOIN dbo.ProductGroups g ON g.ProductGroupId = w.ProductGroupId
     WHERE ${scope} AND ${open}
     ORDER BY w.DueDate NULLS LAST,
              CASE w.Priority WHEN 'Urgent' THEN 1 WHEN 'High' THEN 2 WHEN 'Medium' THEN 3 ELSE 4 END
     LIMIT 10;

     SELECT h.HistoryId, h.WorkId, w.WorkNo, w.Title, h.EntryType, h.OldStatus, h.NewStatus,
            h.Notes, h.ChangedAt, COALESCE(e.EmployeeName, u.Username) AS ChangedByName
     FROM dbo.WorkStatusHistory h
     JOIN dbo.WorkItems w ON w.WorkId = h.WorkId
     JOIN dbo.Users u ON u.UserId = h.ChangedByUserId
     LEFT JOIN dbo.Employees e ON e.EmployeeId = u.EmployeeId
     WHERE ${scope}
     ORDER BY h.ChangedAt DESC, h.HistoryId DESC
     LIMIT 12;`,
    params,
  );
  const [statusRows, countRows, upcomingRows, activityRows] = recordsets(result);
  for (const r of statusRows) statusCounts[r.Status as WorkStatus] = Number(r.Cnt);
  const c = countRows[0] ?? {};

  return {
    statusCounts,
    overdue: Number(c.Overdue ?? 0),
    dueToday: Number(c.DueToday ?? 0),
    dueThisWeek: Number(c.DueThisWeek ?? 0),
    unassigned: manager ? Number(c.Unassigned ?? 0) : 0,
    upcoming: await attachAssignees(upcomingRows.map(mapWorkRow)),
    recentActivity: activityRows.map((h) => ({
      historyId: Number(h.HistoryId),
      workId: h.WorkId as number,
      workNo: h.WorkNo as string,
      title: h.Title as string,
      entryType: h.EntryType as string,
      oldStatus: h.OldStatus as WorkStatus | null,
      newStatus: h.NewStatus as WorkStatus,
      notes: h.Notes as string | null,
      changedAt: toIso(h.ChangedAt),
      changedByName: h.ChangedByName as string,
    })),
  };
}
