import { query, recordsets, sql, withTransaction, type Params, type Row, type Tx } from '../database/pool.js';
import type { AuthUser, Paged, Priority } from '../types/domain.js';
import { parseDateOnly, toDateOnly, toIso, todayLocal } from '../utils/dates.js';
import { badRequest, notFound } from '../utils/httpError.js';
import { inList, likeParam, whereClause } from '../utils/sqlHelpers.js';
import type { RecurringInput, RecurringListQuery } from '../validators/recurring.validators.js';
import { notify, userIdsForEmployees } from './notifications.service.js';
import { anchorDayOf, createOn, dueOccurrences, fillTitle, nextOccurrence, type Frequency } from './recurrence.js';
import { insertWorkItem, resolveProductGroup } from './workItems.service.js';

/**
 * Repeating work: templates that create a normal work item every week / month / quarter / year.
 * Items are created by the background job (see jobs.ts) and right after a template is saved.
 */

function upcoming(nextDue: string, frequency: Frequency, anchorDay: number, endDate: string | null, count = 3): string[] {
  const dates: string[] = [];
  let d = nextDue;
  while (dates.length < count && (!endDate || d <= endDate)) {
    dates.push(d);
    d = nextOccurrence(d, frequency, anchorDay);
  }
  return dates;
}

function mapTemplate(r: Row) {
  const nextDueDate = toDateOnly(r.NextDueDate)!;
  const endDate = toDateOnly(r.EndDate);
  const frequency = r.Frequency as Frequency;
  const leadDays = r.LeadDays as number;
  const ended = Boolean(endDate && nextDueDate > endDate);
  return {
    recurringId: r.RecurringId as number,
    title: r.Title as string,
    description: r.Description as string | null,
    productGroupId: r.ProductGroupId as number | null,
    groupName: r.GroupName as string | null,
    productId: r.ProductId as number | null,
    productName: r.ProductName as string | null,
    priority: r.Priority as Priority,
    frequency,
    nextDueDate,
    nextCreateDate: ended ? null : createOn(nextDueDate, leadDays),
    leadDays,
    endDate,
    ended,
    isActive: Boolean(r.IsActive),
    createdCount: Number(r.CreatedCount ?? 0),
    lastCreatedAt: toIso(r.LastCreatedAt),
    createdByName: r.CreatedByName as string,
    upcoming: ended ? [] : upcoming(nextDueDate, frequency, r.AnchorDay as number, endDate),
    assignees: [] as { employeeId: number; employeeName: string }[],
  };
}
export type RecurringTemplate = ReturnType<typeof mapTemplate>;

const SELECT = `SELECT r.RecurringId, r.Title, r.Description, r.ProductGroupId, g.GroupName, r.ProductId, p.ProductName,
         r.Priority, r.Frequency, r.AnchorDay, r.NextDueDate, r.LeadDays, r.EndDate, r.IsActive, r.LastCreatedAt,
         COALESCE(ce.EmployeeName, cu.Username) AS CreatedByName,
         (SELECT COUNT(*) FROM dbo.WorkItems w WHERE w.RecurringId = r.RecurringId) AS CreatedCount
  FROM dbo.RecurringWork r
  LEFT JOIN dbo.ProductGroups g ON g.ProductGroupId = r.ProductGroupId
  LEFT JOIN dbo.Products p ON p.ProductId = r.ProductId
  JOIN dbo.Users cu ON cu.UserId = r.CreatedByUserId
  LEFT JOIN dbo.Employees ce ON ce.EmployeeId = cu.EmployeeId`;

async function attachAssignees(items: RecurringTemplate[]) {
  if (items.length === 0) return items;
  const params: Params = {};
  const ids = inList(params, 'r', items.map((i) => i.recurringId), sql.Int);
  const r = await query(
    `SELECT ra.RecurringId, e.EmployeeId, e.EmployeeName FROM dbo.RecurringWorkAssignees ra
     JOIN dbo.Employees e ON e.EmployeeId = ra.EmployeeId WHERE ra.RecurringId IN (${ids}) ORDER BY e.EmployeeName`,
    params,
  );
  for (const item of items) {
    item.assignees = r.recordset
      .filter((a) => a.RecurringId === item.recurringId)
      .map((a) => ({ employeeId: a.EmployeeId as number, employeeName: a.EmployeeName as string }));
  }
  return items;
}

export async function listRecurring(q: RecurringListQuery): Promise<Paged<RecurringTemplate>> {
  const where: string[] = [];
  const params: Params = {};
  if (q.search) {
    where.push('(r.Title ILIKE @search OR r.Description ILIKE @search)');
    params.search = likeParam(q.search);
  }
  if (q.isActive !== undefined) {
    where.push('r.IsActive = @active');
    params.active = [sql.Bit, q.isActive];
  }
  const w = whereClause(where);
  const result = await query(
    `SELECT COUNT(*) AS Total FROM dbo.RecurringWork r ${w};
     ${SELECT} ${w}
     ORDER BY r.IsActive DESC, r.NextDueDate, r.RecurringId
     OFFSET @pgOffset ROWS FETCH NEXT @pgSize ROWS ONLY;`,
    { ...params, pgOffset: [sql.Int, (q.page - 1) * q.pageSize], pgSize: [sql.Int, q.pageSize] },
  );
  const [count, rows] = recordsets(result);
  return { items: await attachAssignees(rows.map(mapTemplate)), total: Number(count[0]?.Total ?? 0), page: q.page, pageSize: q.pageSize };
}

export async function getRecurring(id: number): Promise<RecurringTemplate> {
  const r = await query(`${SELECT} WHERE r.RecurringId = @id`, { id: [sql.Int, id] });
  if (!r.recordset[0]) throw notFound('Repeating work');
  return (await attachAssignees([mapTemplate(r.recordset[0])]))[0];
}

async function checkEmployees(employeeIds: number[], tx: Tx) {
  if (employeeIds.length === 0) return;
  const params: Params = {};
  const list = inList(params, 'e', employeeIds, sql.Int);
  const r = await query(`SELECT EmployeeId, EmployeeName, IsActive FROM dbo.Employees WHERE EmployeeId IN (${list})`, params, tx);
  if (r.recordset.length !== employeeIds.length) throw badRequest('One of the selected employees does not exist.');
  const inactive = r.recordset.find((e) => !e.IsActive);
  if (inactive) throw badRequest(`${inactive.EmployeeName} is inactive and cannot be assigned work.`);
}

function templateParams(data: RecurringInput, groupId: number | null): Params {
  return {
    title: [sql.NVarChar(200), data.title],
    description: [sql.NVarChar(sql.MAX), data.description],
    groupId: [sql.Int, groupId],
    productId: [sql.Int, data.productId],
    priority: [sql.NVarChar(10), data.priority],
    frequency: [sql.NVarChar(10), data.frequency],
    nextDue: [sql.Date, parseDateOnly(data.nextDueDate)],
    leadDays: [sql.SmallInt, data.leadDays],
    endDate: [sql.Date, parseDateOnly(data.endDate)],
    active: [sql.Bit, data.isActive],
  };
}

async function saveAssignees(tx: Tx, recurringId: number, employeeIds: number[]) {
  await query(`DELETE FROM dbo.RecurringWorkAssignees WHERE RecurringId = @id`, { id: [sql.Int, recurringId] }, tx);
  for (const employeeId of employeeIds) {
    await query(`INSERT INTO dbo.RecurringWorkAssignees (RecurringId, EmployeeId) VALUES (@id, @emp)`, {
      id: [sql.Int, recurringId],
      emp: [sql.Int, employeeId],
    }, tx);
  }
}

export async function createRecurring(data: RecurringInput, user: AuthUser) {
  if (data.nextDueDate < todayLocal()) throw badRequest('The first due date cannot be in the past.');
  const id = await withTransaction(async (tx) => {
    const groupId = await resolveProductGroup(tx, data.productId, data.productGroupId);
    await checkEmployees(data.employeeIds, tx);
    const r = await query(
      `INSERT INTO dbo.RecurringWork (Title, Description, ProductGroupId, ProductId, Priority, Frequency, AnchorDay, NextDueDate, LeadDays, EndDate, IsActive, CreatedByUserId)
       VALUES (@title, @description, @groupId, @productId, @priority, @frequency, @anchor, @nextDue, @leadDays, @endDate, @active, @userId)
       RETURNING RecurringId`,
      { ...templateParams(data, groupId), anchor: [sql.TinyInt, anchorDayOf(data.nextDueDate)], userId: [sql.Int, user.userId] },
      tx,
    );
    const recurringId = r.recordset[0].RecurringId as number;
    await saveAssignees(tx, recurringId, data.employeeIds);
    return recurringId;
  });
  const created = await runTemplate(user.clientId, id);
  return { template: await getRecurring(id), created };
}

export async function updateRecurring(id: number, data: RecurringInput, user: AuthUser) {
  await withTransaction(async (tx) => {
    const r = await query(`SELECT NextDueDate, AnchorDay, ProductId, ProductGroupId FROM dbo.RecurringWork WHERE RecurringId = @id FOR UPDATE`, {
      id: [sql.Int, id],
    }, tx);
    const current = r.recordset[0];
    if (!current) throw notFound('Repeating work');
    const dateChanged = toDateOnly(current.NextDueDate) !== data.nextDueDate;
    if (dateChanged && data.nextDueDate < todayLocal()) throw badRequest('The next due date cannot be in the past.');
    const groupId = await resolveProductGroup(tx, data.productId, data.productGroupId, {
      productId: current.ProductId as number | null,
      productGroupId: current.ProductGroupId as number | null,
    });
    await checkEmployees(data.employeeIds, tx);
    await query(
      `UPDATE dbo.RecurringWork
       SET Title = @title, Description = @description, ProductGroupId = @groupId, ProductId = @productId, Priority = @priority,
           Frequency = @frequency, AnchorDay = @anchor, NextDueDate = @nextDue, LeadDays = @leadDays, EndDate = @endDate,
           IsActive = @active, UpdatedAt = now()
       WHERE RecurringId = @id`,
      {
        ...templateParams(data, groupId),
        anchor: [sql.TinyInt, dateChanged ? anchorDayOf(data.nextDueDate) : (current.AnchorDay as number)],
        id: [sql.Int, id],
      },
      tx,
    );
    await saveAssignees(tx, id, data.employeeIds);
  });
  const created = await runTemplate(user.clientId, id);
  return { template: await getRecurring(id), created };
}

/**
 * Creates the work items of one template that are due by today (if any) and advances its schedule.
 * The row lock makes concurrent runs (job + save) safe: the second run sees the advanced date.
 */
export async function runTemplate(clientId: string, recurringId: number): Promise<number> {
  const today = todayLocal();
  const created = await withTransaction(async (tx) => {
    const r = await query(
      `SELECT RecurringId, Title, Description, ProductGroupId, ProductId, Priority, Frequency, AnchorDay, NextDueDate,
              LeadDays, EndDate, CreatedByUserId
       FROM dbo.RecurringWork WHERE RecurringId = @id AND IsActive
       FOR UPDATE`,
      { id: [sql.Int, recurringId] },
      tx,
    );
    const t = r.recordset[0];
    if (!t) return [];
    const plan = dueOccurrences(
      toDateOnly(t.NextDueDate)!,
      t.Frequency as Frequency,
      t.AnchorDay as number,
      t.LeadDays as number,
      today,
      toDateOnly(t.EndDate),
    );
    if (plan.due.length === 0) return [];

    // Only active employees get the new work; inactive ones stay on the template until edited
    const a = await query(
      `SELECT ra.EmployeeId FROM dbo.RecurringWorkAssignees ra
       JOIN dbo.Employees e ON e.EmployeeId = ra.EmployeeId AND e.IsActive WHERE ra.RecurringId = @id`,
      { id: [sql.Int, recurringId] },
      tx,
    );
    const employeeIds = a.recordset.map((x) => x.EmployeeId as number);
    const made: { workId: number; employeeIds: number[]; title: string; due: string }[] = [];
    for (const due of plan.due) {
      const title = fillTitle(t.Title as string, due).slice(0, 200);
      const { workId, added } = await insertWorkItem(
        tx,
        {
          title,
          description: t.Description as string | null,
          productGroupId: t.ProductGroupId as number | null,
          productId: t.ProductId as number | null,
          priority: t.Priority as Priority,
          startDate: createOn(due, t.LeadDays as number),
          dueDate: due,
          employeeIds,
        },
        t.CreatedByUserId as number,
        { recurringId, historyNote: 'Created automatically from repeating work', keepInactiveProduct: true },
      );
      made.push({ workId, employeeIds: added, title, due });
    }
    await query(
      `UPDATE dbo.RecurringWork SET NextDueDate = @next, LastCreatedAt = now() WHERE RecurringId = @id`,
      { next: [sql.Date, parseDateOnly(plan.nextDue)], id: [sql.Int, recurringId] },
      tx,
    );
    return made;
  });

  for (const item of created) {
    try {
      const r = await query(`SELECT WorkNo FROM dbo.WorkItems WHERE WorkId = @id`, { id: [sql.Int, item.workId] });
      await notify(clientId, {
        userIds: await userIdsForEmployees(item.employeeIds),
        kind: 'Assigned',
        workId: item.workId,
        message: `New repeating work ${r.recordset[0]?.WorkNo ?? ''}: ${item.title} (due ${fillTitle('{date}', item.due)})`,
      });
    } catch (err) {
      console.error('[recurring] notification failed:', (err as Error).message);
    }
  }
  return created.length;
}

/** Runs every active template whose next item is due to be created. Used by the background job. */
export async function runDueTemplates(clientId: string): Promise<number> {
  const today = todayLocal();
  const r = await query(
    `SELECT RecurringId FROM dbo.RecurringWork
     WHERE IsActive AND NextDueDate - LeadDays <= @today AND (EndDate IS NULL OR NextDueDate <= EndDate)`,
    { today: [sql.Date, parseDateOnly(today)] },
  );
  let total = 0;
  for (const row of r.recordset) {
    try {
      total += await runTemplate(clientId, row.RecurringId as number);
    } catch (err) {
      console.error(`[recurring] template ${row.RecurringId} failed:`, (err as Error).message);
    }
  }
  return total;
}
