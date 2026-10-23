import { query, recordsets, sql, type Params, type Row } from '../database/pool.js';
import {
  eachDay,
  localDayEndExclusive,
  localDayStart,
  localOffsetMinutes,
  parseDateOnly,
  toDateOnly,
  toIso,
  todayLocal,
} from '../utils/dates.js';
import type { ListFilterQuery, OptionalRangeQuery, RequiredRangeQuery } from '../validators/report.validators.js';
import { attachAssignees, mapWorkRow } from './workItems.service.js';

/** Upper bound for list reports so a single request cannot return an unbounded result. */
const MAX_REPORT_ROWS = 5000;

const WORK_FROM = `dbo.WorkItems w
  LEFT JOIN dbo.Products p ON p.ProductId = w.ProductId
  LEFT JOIN dbo.ProductGroups g ON g.ProductGroupId = w.ProductGroupId`;

const WORK_COLUMNS = `w.WorkId, w.WorkNo, w.Title, w.Priority, w.Status, w.StartDate, w.DueDate,
  w.CreatedAt, w.UpdatedAt, w.ClosedAt, w.ProductId, p.ProductCode, p.ProductName, w.ProductGroupId, g.GroupName,
  (w.DueDate < @today AND w.Status NOT IN ('Completed', 'Closed')) AS IsOverdue,
  CASE WHEN w.DueDate < @today AND w.Status NOT IN ('Completed', 'Closed') THEN @today::date - w.DueDate ELSE 0 END AS DaysOverdue`;

/**
 * SQL for the office's local calendar day of a timestamp column (@tz = minutes ahead of UTC).
 * Computed from UTC, so it does not depend on the database server's time zone.
 */
function localDay(column: string): string {
  return `((${column} AT TIME ZONE 'UTC') + make_interval(mins => @tz::int))::date`;
}

function commonFilters(q: ListFilterQuery, where: string[], params: Params) {
  if (q.employeeId) {
    where.push(`EXISTS (SELECT 1 FROM dbo.WorkAssignments fa
                        WHERE fa.WorkId = w.WorkId AND fa.IsActive AND fa.EmployeeId = @employeeId)`);
    params.employeeId = [sql.Int, q.employeeId];
  }
  if (q.productGroupId) {
    where.push('w.ProductGroupId = @groupId');
    params.groupId = [sql.Int, q.productGroupId];
  }
}

function todayParam(): Params {
  return { today: [sql.Date, parseDateOnly(todayLocal())] };
}

async function workList(where: string[], params: Params, orderBy: string, extraColumns = '', extraFrom = '') {
  const r = await query(
    `SELECT ${WORK_COLUMNS}${extraColumns}
     FROM ${WORK_FROM} ${extraFrom}
     WHERE ${where.join(' AND ')}
     ORDER BY ${orderBy}
     LIMIT ${MAX_REPORT_ROWS}`,
    params,
  );
  return { rows: r.recordset as Row[], items: await attachAssignees(r.recordset.map(mapWorkRow)) };
}

/** Employee-wise counts of active assignments, optionally limited to work created in a date range. */
export async function employeeWork(q: OptionalRangeQuery) {
  const params: Params = todayParam();
  const workConditions: string[] = [];
  if (q.fromDate) {
    workConditions.push('w.CreatedAt >= @fromTs');
    params.fromTs = [sql.DateTime2(0), localDayStart(q.fromDate)];
  }
  if (q.toDate) {
    workConditions.push('w.CreatedAt < @toTs');
    params.toTs = [sql.DateTime2(0), localDayEndExclusive(q.toDate)];
  }
  if (q.productGroupId) {
    workConditions.push('w.ProductGroupId = @groupId');
    params.groupId = [sql.Int, q.productGroupId];
  }
  const employeeConditions = ['(e.IsActive OR w.WorkId IS NOT NULL)'];
  if (q.employeeId) {
    employeeConditions.push('e.EmployeeId = @employeeId');
    params.employeeId = [sql.Int, q.employeeId];
  }
  const joinFilter = workConditions.length ? ` AND ${workConditions.join(' AND ')}` : '';

  const r = await query(
    `SELECT e.EmployeeId, e.EmployeeCode, e.EmployeeName, e.Department, e.IsActive,
       COUNT(w.WorkId) AS Total,
       SUM(CASE WHEN w.Status = 'Pending' THEN 1 ELSE 0 END) AS Pending,
       SUM(CASE WHEN w.Status = 'In Progress' THEN 1 ELSE 0 END) AS InProgress,
       SUM(CASE WHEN w.Status = 'On Hold' THEN 1 ELSE 0 END) AS OnHold,
       SUM(CASE WHEN w.Status = 'Reopened' THEN 1 ELSE 0 END) AS Reopened,
       SUM(CASE WHEN w.Status = 'Completed' THEN 1 ELSE 0 END) AS Completed,
       SUM(CASE WHEN w.Status = 'Closed' THEN 1 ELSE 0 END) AS Closed,
       SUM(CASE WHEN w.DueDate < @today AND w.Status NOT IN ('Completed', 'Closed') THEN 1 ELSE 0 END) AS Overdue
     FROM dbo.Employees e
     LEFT JOIN dbo.WorkAssignments wa ON wa.EmployeeId = e.EmployeeId AND wa.IsActive
     LEFT JOIN dbo.WorkItems w ON w.WorkId = wa.WorkId${joinFilter}
     WHERE ${employeeConditions.join(' AND ')}
     GROUP BY e.EmployeeId, e.EmployeeCode, e.EmployeeName, e.Department, e.IsActive
     ORDER BY e.EmployeeName`,
    params,
  );
  return {
    rows: r.recordset.map((x) => ({
      employeeId: x.EmployeeId as number,
      employeeCode: x.EmployeeCode as string,
      employeeName: x.EmployeeName as string,
      department: x.Department as string | null,
      isActive: Boolean(x.IsActive),
      total: Number(x.Total),
      pending: Number(x.Pending ?? 0),
      inProgress: Number(x.InProgress ?? 0),
      onHold: Number(x.OnHold ?? 0),
      reopened: Number(x.Reopened ?? 0),
      completed: Number(x.Completed ?? 0),
      closed: Number(x.Closed ?? 0),
      overdue: Number(x.Overdue ?? 0),
    })),
  };
}

export async function pendingWork(q: ListFilterQuery) {
  const params: Params = todayParam();
  const where = [`w.Status IN ('Pending', 'In Progress', 'On Hold', 'Reopened')`];
  commonFilters(q, where, params);
  const { rows, items } = await workList(
    where,
    params,
    'w.DueDate NULLS LAST, w.WorkId',
  );
  return { rows: items.map((item, i) => ({ ...item, daysOverdue: Number(rows[i].DaysOverdue) })) };
}

export async function overdueWork(q: ListFilterQuery) {
  const params: Params = todayParam();
  const where = [`w.DueDate < @today`, `w.Status NOT IN ('Completed', 'Closed')`];
  commonFilters(q, where, params);
  const { rows, items } = await workList(where, params, 'w.DueDate, w.WorkId');
  return { rows: items.map((item, i) => ({ ...item, daysOverdue: Number(rows[i].DaysOverdue) })) };
}

/** Work whose most recent "Completed" status change falls in the range. */
export async function completedWork(q: RequiredRangeQuery) {
  const params: Params = {
    ...todayParam(),
    fromTs: [sql.DateTime2(0), localDayStart(q.fromDate)],
    toTs: [sql.DateTime2(0), localDayEndExclusive(q.toDate)],
    tz: [sql.Int, localOffsetMinutes()],
  };
  const where = [`w.Status IN ('Completed', 'Closed')`, 'c.ChangedAt >= @fromTs', 'c.ChangedAt < @toTs'];
  commonFilters(q, where, params);
  const { rows, items } = await workList(
    where,
    params,
    'c.ChangedAt DESC, w.WorkId DESC',
    `, c.ChangedAt AS CompletedAt, COALESCE(ce.EmployeeName, cu.Username) AS CompletedByName,
       CASE WHEN w.DueDate IS NULL THEN NULL
            ELSE ${localDay('c.ChangedAt')} <= w.DueDate END AS OnTime`,
    `JOIN LATERAL (SELECT h.ChangedAt, h.ChangedByUserId
                   FROM dbo.WorkStatusHistory h
                   WHERE h.WorkId = w.WorkId AND h.EntryType = 'StatusChange' AND h.NewStatus = 'Completed'
                   ORDER BY h.ChangedAt DESC, h.HistoryId DESC
                   LIMIT 1) c ON true
     JOIN dbo.Users cu ON cu.UserId = c.ChangedByUserId
     LEFT JOIN dbo.Employees ce ON ce.EmployeeId = cu.EmployeeId`,
  );
  return {
    rows: items.map((item, i) => ({
      ...item,
      completedAt: toIso(rows[i].CompletedAt),
      completedByName: rows[i].CompletedByName as string,
      onTime: rows[i].OnTime === null ? null : Boolean(rows[i].OnTime),
    })),
  };
}

/** Day-by-day counts of created, due, completed, closed and reopened work. */
export async function workSummary(q: RequiredRangeQuery) {
  const params: Params = {
    fromTs: [sql.DateTime2(0), localDayStart(q.fromDate)],
    toTs: [sql.DateTime2(0), localDayEndExclusive(q.toDate)],
    fromDate: [sql.Date, parseDateOnly(q.fromDate)],
    toDate: [sql.Date, parseDateOnly(q.toDate)],
    tz: [sql.Int, localOffsetMinutes()],
  };
  const where: string[] = [];
  commonFilters(q, where, params);
  const extra = where.length ? ` AND ${where.join(' AND ')}` : '';

  const result = await query(
    `SELECT ${localDay('w.CreatedAt')} AS Day, COUNT(*) AS Cnt
     FROM dbo.WorkItems w
     WHERE w.CreatedAt >= @fromTs AND w.CreatedAt < @toTs${extra}
     GROUP BY 1;

     SELECT w.DueDate AS Day, COUNT(*) AS Cnt
     FROM dbo.WorkItems w
     WHERE w.DueDate BETWEEN @fromDate AND @toDate${extra}
     GROUP BY w.DueDate;

     SELECT ${localDay('h.ChangedAt')} AS Day, h.NewStatus, COUNT(*) AS Cnt
     FROM dbo.WorkStatusHistory h
     JOIN dbo.WorkItems w ON w.WorkId = h.WorkId
     WHERE h.EntryType = 'StatusChange' AND h.NewStatus IN ('Completed', 'Closed', 'Reopened')
       AND h.ChangedAt >= @fromTs AND h.ChangedAt < @toTs${extra}
     GROUP BY 1, h.NewStatus;`,
    params,
  );
  const [createdRows, dueRows, statusRows] = recordsets(result);

  const days = new Map(
    eachDay(q.fromDate, q.toDate).map((date) => [
      date,
      { date, created: 0, due: 0, completed: 0, closed: 0, reopened: 0 },
    ]),
  );
  for (const r of createdRows) {
    const d = days.get(toDateOnly(r.Day)!);
    if (d) d.created = Number(r.Cnt);
  }
  for (const r of dueRows) {
    const d = days.get(toDateOnly(r.Day)!);
    if (d) d.due = Number(r.Cnt);
  }
  for (const r of statusRows) {
    const d = days.get(toDateOnly(r.Day)!);
    if (!d) continue;
    if (r.NewStatus === 'Completed') d.completed = Number(r.Cnt);
    else if (r.NewStatus === 'Closed') d.closed = Number(r.Cnt);
    else if (r.NewStatus === 'Reopened') d.reopened = Number(r.Cnt);
  }
  const rows = [...days.values()];
  const totals = rows.reduce(
    (t, r) => ({
      created: t.created + r.created,
      due: t.due + r.due,
      completed: t.completed + r.completed,
      closed: t.closed + r.closed,
      reopened: t.reopened + r.reopened,
    }),
    { created: 0, due: 0, completed: 0, closed: 0, reopened: 0 },
  );
  return { rows, totals };
}
