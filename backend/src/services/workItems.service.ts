import { query, recordsets, sql, withTransaction, type Params, type Row, type Tx } from '../database/pool.js';
import type { AuthUser, Paged, Priority, WorkStatus } from '../types/domain.js';
import {
  localDayEndExclusive,
  localDayStart,
  parseDateOnly,
  toDateOnly,
  toIso,
  todayLocal,
} from '../utils/dates.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/httpError.js';
import { inList, likeParam, whereClause } from '../utils/sqlHelpers.js';
import type { NewAttachment } from './chat.service.js';
import type {
  CreateWorkInput,
  StatusInput,
  UpdateWorkInput,
  WorkListQuery,
} from '../validators/work.validators.js';
import {
  actorName,
  extractMentions,
  mentionedUserIds,
  notify,
  snippet,
  userIdsForEmployees,
  workAudience,
} from './notifications.service.js';
import { allowedTransitions, isManager, NOTES_REQUIRED } from './workflow.js';

/** The RowVer column as the 16-hex-digit token clients send back to prove they saw the latest version. */
function rowVersionToken(value: unknown): string {
  return BigInt(value as number).toString(16).padStart(16, '0');
}

const CONCURRENCY_MESSAGE =
  'This work item was changed by someone else since you opened it. Reload it and try again.';

/** SQL condition: the work item is past its due date and not yet completed/closed. */
const OVERDUE_SQL = `(w.DueDate < @today AND w.Status NOT IN ('Completed', 'Closed'))`;

const PRIORITY_RANK_SQL = `CASE w.Priority WHEN 'Urgent' THEN 4 WHEN 'High' THEN 3 WHEN 'Medium' THEN 2 ELSE 1 END`;

const SORT_COLUMNS: Record<WorkListQuery['sortBy'], string> = {
  workNo: 'w.WorkId',
  title: 'w.Title',
  priority: PRIORITY_RANK_SQL,
  status: 'w.Status',
  startDate: 'w.StartDate',
  dueDate: 'w.DueDate',
  createdAt: 'w.CreatedAt',
  updatedAt: 'w.UpdatedAt',
  product: 'p.ProductName',
};

const LIST_COLUMNS = `w.WorkId, w.WorkNo, w.Title, w.Priority, w.Status, w.StartDate, w.DueDate,
  w.CreatedAt, w.UpdatedAt, w.ClosedAt, w.ProductId, p.ProductCode, p.ProductName,
  w.ProductGroupId, g.GroupName, ${OVERDUE_SQL} AS IsOverdue`;

const LIST_FROM = `dbo.WorkItems w
  LEFT JOIN dbo.Products p ON p.ProductId = w.ProductId
  LEFT JOIN dbo.ProductGroups g ON g.ProductGroupId = w.ProductGroupId`;

export interface Assignee {
  employeeId: number;
  employeeCode: string;
  employeeName: string;
  assignedAt?: string | null;
  assignedByName?: string | null;
}

export function mapWorkRow(r: Row) {
  return {
    workId: r.WorkId as number,
    workNo: r.WorkNo as string,
    title: r.Title as string,
    priority: r.Priority as Priority,
    status: r.Status as WorkStatus,
    startDate: toDateOnly(r.StartDate),
    dueDate: toDateOnly(r.DueDate),
    createdAt: toIso(r.CreatedAt),
    updatedAt: toIso(r.UpdatedAt),
    closedAt: toIso(r.ClosedAt),
    productId: r.ProductId as number | null,
    productCode: r.ProductCode as string | null,
    productName: r.ProductName as string | null,
    productGroupId: r.ProductGroupId as number | null,
    groupName: r.GroupName as string | null,
    isOverdue: Boolean(r.IsOverdue),
    assignees: [] as Assignee[],
  };
}
export type WorkListItem = ReturnType<typeof mapWorkRow>;

/** Loads active assignees for a set of work items in one query. */
export async function attachAssignees<T extends { workId: number; assignees: Assignee[] }>(items: T[]): Promise<T[]> {
  if (items.length === 0) return items;
  const params: Params = {};
  const ids = inList(params, 'w', items.map((i) => i.workId), sql.Int);
  const r = await query(
    `SELECT wa.WorkId, e.EmployeeId, e.EmployeeCode, e.EmployeeName
     FROM dbo.WorkAssignments wa
     JOIN dbo.Employees e ON e.EmployeeId = wa.EmployeeId
     WHERE wa.IsActive AND wa.WorkId IN (${ids})
     ORDER BY e.EmployeeName`,
    params,
  );
  const byWork = new Map<number, Assignee[]>();
  for (const row of r.recordset) {
    const list = byWork.get(row.WorkId) ?? [];
    list.push({ employeeId: row.EmployeeId, employeeCode: row.EmployeeCode, employeeName: row.EmployeeName });
    byWork.set(row.WorkId, list);
  }
  for (const item of items) item.assignees = byWork.get(item.workId) ?? [];
  return items;
}

/** Restricts employees to work items actively assigned to them. */
function scopeToUser(user: AuthUser, where: string[], params: Params): boolean {
  if (isManager(user.role)) return true;
  if (!user.employeeId) return false;
  where.push(`EXISTS (SELECT 1 FROM dbo.WorkAssignments sa
                      WHERE sa.WorkId = w.WorkId AND sa.IsActive AND sa.EmployeeId = @scopeEmployeeId)`);
  params.scopeEmployeeId = [sql.Int, user.employeeId];
  return true;
}

export async function listWorkItems(q: WorkListQuery, user: AuthUser): Promise<Paged<WorkListItem>> {
  const where: string[] = [];
  const params: Params = { today: [sql.Date, parseDateOnly(todayLocal())] };

  if (!scopeToUser(user, where, params)) return { items: [], total: 0, page: q.page, pageSize: q.pageSize };

  if (q.search) {
    where.push('(w.WorkNo ILIKE @search OR w.Title ILIKE @search OR w.Description ILIKE @search)');
    params.search = likeParam(q.search);
  }
  if (q.status?.length) {
    where.push(`w.Status IN (${inList(params, 'st', q.status, sql.NVarChar(20))})`);
  }
  if (q.priority) {
    where.push('w.Priority = @priority');
    params.priority = [sql.NVarChar(10), q.priority];
  }
  if (q.productGroupId) {
    where.push('w.ProductGroupId = @groupId');
    params.groupId = [sql.Int, q.productGroupId];
  }
  if (q.productId) {
    where.push('w.ProductId = @productId');
    params.productId = [sql.Int, q.productId];
  }
  if (q.employeeId) {
    where.push(`EXISTS (SELECT 1 FROM dbo.WorkAssignments fa
                        WHERE fa.WorkId = w.WorkId AND fa.IsActive AND fa.EmployeeId = @employeeId)`);
    params.employeeId = [sql.Int, q.employeeId];
  }
  if (q.assignment) {
    const exists = `EXISTS (SELECT 1 FROM dbo.WorkAssignments xa WHERE xa.WorkId = w.WorkId AND xa.IsActive)`;
    where.push(q.assignment === 'assigned' ? exists : `NOT ${exists}`);
  }
  if (q.overdue) {
    where.push(OVERDUE_SQL);
  }
  if (q.fromDate || q.toDate) {
    if (q.dateField === 'created') {
      // CreatedAt is a UTC timestamp: compare against local-day boundaries
      if (q.fromDate) {
        where.push('w.CreatedAt >= @fromTs');
        params.fromTs = [sql.DateTime2(0), localDayStart(q.fromDate)];
      }
      if (q.toDate) {
        where.push('w.CreatedAt < @toTs');
        params.toTs = [sql.DateTime2(0), localDayEndExclusive(q.toDate)];
      }
    } else {
      const column = q.dateField === 'start' ? 'w.StartDate' : 'w.DueDate';
      if (q.fromDate) {
        where.push(`${column} >= @fromDate`);
        params.fromDate = [sql.Date, parseDateOnly(q.fromDate)];
      }
      if (q.toDate) {
        where.push(`${column} <= @toDate`);
        params.toDate = [sql.Date, parseDateOnly(q.toDate)];
      }
    }
  }

  const w = whereClause(where);
  const dir = q.sortDir === 'asc' ? 'ASC' : 'DESC';
  // Empty dates / products sort last in both directions
  const sortCol = SORT_COLUMNS[q.sortBy];
  const nullsLast = ['startDate', 'dueDate', 'product'].includes(q.sortBy) ? ' NULLS LAST' : '';

  const result = await query(
    `SELECT COUNT(*) AS Total FROM ${LIST_FROM} ${w};
     SELECT ${LIST_COLUMNS} FROM ${LIST_FROM} ${w}
     ORDER BY ${sortCol} ${dir}${nullsLast}, w.WorkId DESC
     OFFSET @pgOffset ROWS FETCH NEXT @pgSize ROWS ONLY;`,
    { ...params, pgOffset: [sql.Int, (q.page - 1) * q.pageSize], pgSize: [sql.Int, q.pageSize] },
  );
  const [countRows, rows] = recordsets(result);
  const items = await attachAssignees(rows.map(mapWorkRow));
  return { items, total: Number(countRows[0]?.Total ?? 0), page: q.page, pageSize: q.pageSize };
}

async function isAssigned(workId: number, employeeId: number | null, tx?: Tx): Promise<boolean> {
  if (!employeeId) return false;
  const r = await query(
    `SELECT 1 AS Ok FROM dbo.WorkAssignments WHERE WorkId = @workId AND EmployeeId = @emp AND IsActive`,
    { workId: [sql.Int, workId], emp: [sql.Int, employeeId] },
    tx,
  );
  return r.recordset.length > 0;
}

/** Employees get a 404 (not 403) for work that is not theirs, so IDs of other work are not revealed. */
export async function assertCanAccess(workId: number, user: AuthUser, tx?: Tx) {
  if (isManager(user.role)) return;
  if (!(await isAssigned(workId, user.employeeId, tx))) throw notFound('Work item');
}

export async function getWorkItem(workId: number, user: AuthUser) {
  await assertCanAccess(workId, user);

  const result = await query(
    `SELECT ${LIST_COLUMNS}, w.Description, w.RowVer, w.CreatedByUserId,
            cu.Username AS CreatedByUsername, ce.EmployeeName AS CreatedByName,
            w.RecurringId, rw.Frequency AS RecurringFrequency
     FROM ${LIST_FROM}
     JOIN dbo.Users cu ON cu.UserId = w.CreatedByUserId
     LEFT JOIN dbo.Employees ce ON ce.EmployeeId = cu.EmployeeId
     LEFT JOIN dbo.RecurringWork rw ON rw.RecurringId = w.RecurringId
     WHERE w.WorkId = @id;

     SELECT wa.EmployeeId, e.EmployeeCode, e.EmployeeName, wa.AssignedAt,
            COALESCE(ae.EmployeeName, au.Username) AS AssignedByName
     FROM dbo.WorkAssignments wa
     JOIN dbo.Employees e ON e.EmployeeId = wa.EmployeeId
     JOIN dbo.Users au ON au.UserId = wa.AssignedByUserId
     LEFT JOIN dbo.Employees ae ON ae.EmployeeId = au.EmployeeId
     WHERE wa.WorkId = @id AND wa.IsActive
     ORDER BY e.EmployeeName;

     SELECT h.HistoryId, h.EntryType, h.OldStatus, h.NewStatus, h.Notes, h.ChangedAt,
            u.Username AS ChangedByUsername, COALESCE(e.EmployeeName, u.Username) AS ChangedByName
     FROM dbo.WorkStatusHistory h
     JOIN dbo.Users u ON u.UserId = h.ChangedByUserId
     LEFT JOIN dbo.Employees e ON e.EmployeeId = u.EmployeeId
     WHERE h.WorkId = @id
     ORDER BY h.ChangedAt DESC, h.HistoryId DESC;

     SELECT a.AttachmentId, a.FileName, a.ContentType, a.SizeBytes, a.CreatedAt, a.UploadedByUserId,
            COALESCE(ue.EmployeeName, uu.Username) AS UploadedByName
     FROM dbo.WorkAttachments a
     JOIN dbo.Users uu ON uu.UserId = a.UploadedByUserId
     LEFT JOIN dbo.Employees ue ON ue.EmployeeId = uu.EmployeeId
     WHERE a.WorkId = @id AND a.DeletedAt IS NULL
     ORDER BY a.CreatedAt DESC, a.AttachmentId DESC;`,
    { id: [sql.Int, workId], today: [sql.Date, parseDateOnly(todayLocal())] },
  );
  const [workRows, assignmentRows, historyRows, fileRows] = recordsets(result);
  const row = workRows[0];
  if (!row) throw notFound('Work item');

  const base = mapWorkRow(row);
  const manager = isManager(user.role);
  return {
    ...base,
    description: row.Description as string | null,
    rowVersion: rowVersionToken(row.RowVer),
    createdByUserId: row.CreatedByUserId as number,
    createdByName: (row.CreatedByName ?? row.CreatedByUsername) as string,
    assignees: assignmentRows.map(
      (a): Assignee => ({
        employeeId: a.EmployeeId,
        employeeCode: a.EmployeeCode,
        employeeName: a.EmployeeName,
        assignedAt: toIso(a.AssignedAt),
        assignedByName: a.AssignedByName,
      }),
    ),
    history: historyRows.map((h) => ({
      historyId: Number(h.HistoryId),
      entryType: h.EntryType as string,
      oldStatus: h.OldStatus as WorkStatus | null,
      newStatus: h.NewStatus as WorkStatus,
      notes: h.Notes as string | null,
      changedAt: toIso(h.ChangedAt),
      changedByName: h.ChangedByName as string,
    })),
    attachments: fileRows.map((a) => ({
      attachmentId: a.AttachmentId as number,
      fileName: a.FileName as string,
      contentType: a.ContentType as string,
      size: a.SizeBytes as number,
      createdAt: toIso(a.CreatedAt),
      uploadedByName: a.UploadedByName as string,
      canDelete: base.status !== 'Closed' && (manager || a.UploadedByUserId === user.userId),
    })),
    canAttach: base.status !== 'Closed',
    recurringId: (row.RecurringId ?? null) as number | null,
    recurringFrequency: (row.RecurringFrequency ?? null) as string | null,
    allowedTransitions: allowedTransitions(base.status, user.role),
    notesRequiredFor: NOTES_REQUIRED,
    canEdit: manager && base.status !== 'Closed',
    canAssign: manager && base.status !== 'Closed',
  };
}

/**
 * Validates the product/group selection and returns the group to store.
 * When a product is chosen its group is always stored, so group filters include product-level work.
 * Inactive masters can be kept on existing work but not newly selected.
 */
export async function resolveProductGroup(
  tx: Tx,
  productId: number | null,
  productGroupId: number | null,
  current?: { productId: number | null; productGroupId: number | null },
): Promise<number | null> {
  if (productId) {
    const r = await query(`SELECT ProductGroupId, IsActive FROM dbo.Products WHERE ProductId = @id`, {
      id: [sql.Int, productId],
    }, tx);
    const product = r.recordset[0];
    if (!product) throw badRequest('Selected product does not exist.');
    if (!product.IsActive && productId !== current?.productId) throw badRequest('Selected product is inactive.');
    if (productGroupId && productGroupId !== product.ProductGroupId) {
      throw badRequest('Selected product does not belong to the selected product group.');
    }
    return product.ProductGroupId as number;
  }
  if (productGroupId) {
    const r = await query(`SELECT IsActive FROM dbo.ProductGroups WHERE ProductGroupId = @id`, {
      id: [sql.Int, productGroupId],
    }, tx);
    const group = r.recordset[0];
    if (!group) throw badRequest('Selected product group does not exist.');
    if (!group.IsActive && productGroupId !== current?.productGroupId) {
      throw badRequest('Selected product group is inactive.');
    }
    return productGroupId;
  }
  return null;
}

export async function addHistory(
  tx: Tx,
  entry: {
    workId: number;
    entryType: 'Created' | 'StatusChange' | 'Note' | 'Assignment' | 'Edit' | 'Attachment';
    oldStatus: WorkStatus | null;
    newStatus: WorkStatus;
    userId: number;
    notes: string | null;
  },
) {
  await query(
    `INSERT INTO dbo.WorkStatusHistory (WorkId, EntryType, OldStatus, NewStatus, ChangedByUserId, Notes)
     VALUES (@workId, @type, @old, @new, @userId, @notes)`,
    {
      workId: [sql.Int, entry.workId],
      type: [sql.NVarChar(20), entry.entryType],
      old: [sql.NVarChar(20), entry.oldStatus],
      new: [sql.NVarChar(20), entry.newStatus],
      userId: [sql.Int, entry.userId],
      notes: [sql.NVarChar(2000), entry.notes?.slice(0, 2000) ?? null],
    },
    tx,
  );
}

/**
 * Makes the active assignees of a work item exactly `employeeIds`.
 * Removed assignments are deactivated (kept for history), new ones inserted.
 * The filtered unique index UX_WorkAssignments_Active rejects concurrent duplicates.
 * Returns the employees who were newly assigned (so they can be notified).
 */
async function syncAssignments(
  tx: Tx,
  workId: number,
  status: WorkStatus,
  employeeIds: number[],
  userId: number,
): Promise<number[]> {
  const current = await query(
    `SELECT wa.EmployeeId, e.EmployeeName
     FROM dbo.WorkAssignments wa
     JOIN dbo.Employees e ON e.EmployeeId = wa.EmployeeId
     WHERE wa.WorkId = @workId AND wa.IsActive
     FOR UPDATE OF wa`,
    { workId: [sql.Int, workId] },
    tx,
  );
  const currentIds = new Map<number, string>(current.recordset.map((r) => [r.EmployeeId, r.EmployeeName]));
  const wanted = new Set(employeeIds);
  const toAdd = [...wanted].filter((id) => !currentIds.has(id));
  const toRemove = [...currentIds.keys()].filter((id) => !wanted.has(id));
  if (toAdd.length === 0 && toRemove.length === 0) return [];

  const addedNames: string[] = [];
  if (toAdd.length) {
    const params: Params = {};
    const list = inList(params, 'e', toAdd, sql.Int);
    const r = await query(
      `SELECT EmployeeId, EmployeeName, IsActive FROM dbo.Employees WHERE EmployeeId IN (${list})`,
      params,
      tx,
    );
    const found = new Map<number, Row>(r.recordset.map((row) => [row.EmployeeId, row]));
    for (const id of toAdd) {
      const emp = found.get(id);
      if (!emp) throw badRequest('One of the selected employees does not exist.');
      if (!emp.IsActive) throw badRequest(`${emp.EmployeeName} is inactive and cannot be assigned work.`);
      addedNames.push(emp.EmployeeName);
    }
  }

  for (const employeeId of toRemove) {
    await query(
      `UPDATE dbo.WorkAssignments
       SET IsActive = false, UnassignedAt = now(), UnassignedByUserId = @userId
       WHERE WorkId = @workId AND EmployeeId = @emp AND IsActive`,
      { workId: [sql.Int, workId], emp: [sql.Int, employeeId], userId: [sql.Int, userId] },
      tx,
    );
  }
  for (const employeeId of toAdd) {
    await query(
      `INSERT INTO dbo.WorkAssignments (WorkId, EmployeeId, AssignedByUserId) VALUES (@workId, @emp, @userId)`,
      { workId: [sql.Int, workId], emp: [sql.Int, employeeId], userId: [sql.Int, userId] },
      tx,
    );
  }

  const parts: string[] = [];
  if (addedNames.length) parts.push(`Assigned: ${addedNames.join(', ')}`);
  if (toRemove.length) parts.push(`Unassigned: ${toRemove.map((id) => currentIds.get(id)).join(', ')}`);
  await addHistory(tx, {
    workId,
    entryType: 'Assignment',
    oldStatus: status,
    newStatus: status,
    userId,
    notes: parts.join('; '),
  });
  await query(`UPDATE dbo.WorkItems SET UpdatedAt = now() WHERE WorkId = @workId`, {
    workId: [sql.Int, workId],
  }, tx);
  return toAdd;
}

function workParams(data: CreateWorkInput | UpdateWorkInput, groupId: number | null): Params {
  return {
    title: [sql.NVarChar(200), data.title],
    description: [sql.NVarChar(sql.MAX), data.description],
    groupId: [sql.Int, groupId],
    productId: [sql.Int, data.productId],
    priority: [sql.NVarChar(10), data.priority],
    startDate: [sql.Date, parseDateOnly(data.startDate)],
    dueDate: [sql.Date, parseDateOnly(data.dueDate)],
  };
}

/**
 * Inserts a work item with its history and assignments inside an open transaction.
 * Shared by manual creation and repeating work (which passes its template id).
 */
export async function insertWorkItem(
  tx: Tx,
  data: CreateWorkInput,
  createdByUserId: number,
  options: { recurringId?: number; historyNote?: string; keepInactiveProduct?: boolean } = {},
): Promise<{ workId: number; added: number[] }> {
  const current = options.keepInactiveProduct ? { productId: data.productId, productGroupId: data.productGroupId } : undefined;
  const groupId = await resolveProductGroup(tx, data.productId, data.productGroupId, current);
  const r = await query(
    `INSERT INTO dbo.WorkItems (Title, Description, ProductGroupId, ProductId, Priority, Status, StartDate, DueDate, CreatedByUserId, RecurringId)
     VALUES (@title, @description, @groupId, @productId, @priority, 'Pending', @startDate, @dueDate, @userId, @recurringId)
     RETURNING WorkId`,
    { ...workParams(data, groupId), userId: [sql.Int, createdByUserId], recurringId: [sql.Int, options.recurringId ?? null] },
    tx,
  );
  const workId = r.recordset[0].WorkId as number;
  await addHistory(tx, {
    workId,
    entryType: 'Created',
    oldStatus: null,
    newStatus: 'Pending',
    userId: createdByUserId,
    notes: options.historyNote ?? 'Work item created',
  });
  const added = data.employeeIds.length ? await syncAssignments(tx, workId, 'Pending', data.employeeIds, createdByUserId) : [];
  return { workId, added };
}

async function notifyAssigned(user: AuthUser, workId: number, employeeIds: number[]) {
  if (employeeIds.length === 0) return;
  const [userIds, audience] = await Promise.all([userIdsForEmployees(employeeIds), workAudience(workId)]);
  await notify(user.clientId, {
    userIds,
    kind: 'Assigned',
    workId,
    actor: user,
    message: `${actorName(user)} assigned you ${audience.workNo}: ${audience.title}`,
  });
}

/** Notifications never fail the request that triggered them. */
function quietly(task: Promise<unknown>) {
  task.catch((err: Error) => console.error('[notifications] failed:', err.message));
}

export async function createWorkItem(data: CreateWorkInput, user: AuthUser) {
  const { workId, added } = await withTransaction((tx) => insertWorkItem(tx, data, user.userId));
  quietly(notifyAssigned(user, workId, added));
  return getWorkItem(workId, user);
}

/** Locks the work row for the rest of the transaction and checks the concurrency token. */
async function lockWorkItem(tx: Tx, workId: number, rowVersion?: string) {
  const r = await query(
    `SELECT WorkId, Status, ProductId, ProductGroupId, RowVer
     FROM dbo.WorkItems WHERE WorkId = @id
     FOR UPDATE`,
    { id: [sql.Int, workId] },
    tx,
  );
  const row = r.recordset[0];
  if (!row) throw notFound('Work item');
  const current = {
    status: row.Status as WorkStatus,
    productId: row.ProductId as number | null,
    productGroupId: row.ProductGroupId as number | null,
    rowVersion: rowVersionToken(row.RowVer),
  };
  if (rowVersion !== undefined) assertVersion(current, rowVersion);
  return current;
}

function assertVersion(current: { rowVersion: string }, rowVersion: string) {
  if (current.rowVersion !== rowVersion.toLowerCase()) throw conflict(CONCURRENCY_MESSAGE);
}

export async function updateWorkItem(workId: number, data: UpdateWorkInput, user: AuthUser) {
  const added = await withTransaction(async (tx) => {
    const current = await lockWorkItem(tx, workId, data.rowVersion);
    if (current.status === 'Closed') throw badRequest('Closed work cannot be edited. Reopen it first.');
    const groupId = await resolveProductGroup(tx, data.productId, data.productGroupId, current);

    await query(
      `UPDATE dbo.WorkItems
       SET Title = @title, Description = @description, ProductGroupId = @groupId, ProductId = @productId,
           Priority = @priority, StartDate = @startDate, DueDate = @dueDate, UpdatedAt = now()
       WHERE WorkId = @id`,
      { ...workParams(data, groupId), id: [sql.Int, workId] },
      tx,
    );
    await addHistory(tx, {
      workId,
      entryType: 'Edit',
      oldStatus: current.status,
      newStatus: current.status,
      userId: user.userId,
      notes: 'Work details updated',
    });
    return data.employeeIds ? syncAssignments(tx, workId, current.status, data.employeeIds, user.userId) : [];
  });
  quietly(notifyAssigned(user, workId, added));
  return getWorkItem(workId, user);
}

export async function setAssignments(workId: number, employeeIds: number[], user: AuthUser) {
  const added = await withTransaction(async (tx) => {
    const current = await lockWorkItem(tx, workId);
    if (current.status === 'Closed') throw badRequest('Closed work cannot be reassigned. Reopen it first.');
    return syncAssignments(tx, workId, current.status, employeeIds, user.userId);
  });
  quietly(notifyAssigned(user, workId, added));
  return getWorkItem(workId, user);
}

export async function changeStatus(workId: number, data: StatusInput, user: AuthUser) {
  await withTransaction(async (tx) => {
    const current = await lockWorkItem(tx, workId);
    await assertCanAccess(workId, user, tx);
    // Check the token only after access, so employees cannot probe other work items
    assertVersion(current, data.rowVersion);

    if (current.status === data.status) throw badRequest(`Work is already "${data.status}".`);
    const allowed = allowedTransitions(current.status, user.role);
    if (!allowed.includes(data.status)) {
      const anyRole = allowedTransitions(current.status, 'Admin');
      if (anyRole.includes(data.status)) throw forbidden(`Only a manager can change status to "${data.status}".`);
      throw badRequest(`Status cannot change from "${current.status}" to "${data.status}".`);
    }
    if (NOTES_REQUIRED.includes(data.status) && !data.notes) {
      throw badRequest(`Please add a note explaining why the work is "${data.status}".`);
    }

    await query(
      `UPDATE dbo.WorkItems
       SET Status = @status, UpdatedAt = now(),
           ClosedAt = CASE WHEN @status = 'Closed' THEN now()
                           WHEN @status = 'Reopened' THEN NULL ELSE ClosedAt END
       WHERE WorkId = @id`,
      { status: [sql.NVarChar(20), data.status], id: [sql.Int, workId] },
      tx,
    );
    await addHistory(tx, {
      workId,
      entryType: 'StatusChange',
      oldStatus: current.status,
      newStatus: data.status,
      userId: user.userId,
      notes: data.notes,
    });
  });
  quietly(
    (async () => {
      const audience = await workAudience(workId);
      const verb = data.status === 'Completed' ? 'submitted' : `moved ${audience.workNo} to ${data.status}:`;
      const subject = data.status === 'Completed' ? `${audience.workNo} for review:` : '';
      const note = data.notes ? ` · "${snippet(data.notes, 80)}"` : '';
      await notify(user.clientId, {
        userIds: audience.everyone,
        kind: 'Status',
        workId,
        actor: user,
        message: `${actorName(user)} ${verb} ${subject} ${audience.title}${note}`.replace(/\s+/g, ' '),
      });
      if (data.notes) await notifyMentions(user, workId, data.notes, audience.workNo);
    })(),
  );
  return getWorkItem(workId, user);
}

/** Notifies people @mentioned in a note; returns who was notified. */
async function notifyMentions(user: AuthUser, workId: number, text: string, workNo: string): Promise<number[]> {
  const userIds = (await mentionedUserIds(workId, extractMentions(text))).filter((id) => id !== user.userId);
  await notify(user.clientId, {
    userIds,
    kind: 'Mention',
    workId,
    actor: user,
    message: `${actorName(user)} mentioned you on ${workNo}: "${snippet(text)}"`,
  });
  return userIds;
}

export async function addNote(workId: number, notes: string, user: AuthUser) {
  await withTransaction(async (tx) => {
    const current = await lockWorkItem(tx, workId);
    await assertCanAccess(workId, user, tx);
    await addHistory(tx, {
      workId,
      entryType: 'Note',
      oldStatus: current.status,
      newStatus: current.status,
      userId: user.userId,
      notes,
    });
    await query(`UPDATE dbo.WorkItems SET UpdatedAt = now() WHERE WorkId = @id`, {
      id: [sql.Int, workId],
    }, tx);
  });
  quietly(
    (async () => {
      const audience = await workAudience(workId);
      const mentioned = await notifyMentions(user, workId, notes, audience.workNo);
      await notify(user.clientId, {
        userIds: audience.everyone.filter((id) => !mentioned.includes(id)),
        kind: 'Note',
        workId,
        actor: user,
        message: `${actorName(user)} added a note on ${audience.workNo}: "${snippet(notes)}"`,
      });
    })(),
  );
  return getWorkItem(workId, user);
}

// ---------------------------------------------------------------- Files

export async function addAttachment(workId: number, file: NewAttachment, user: AuthUser) {
  const attachmentId = await withTransaction(async (tx) => {
    const current = await lockWorkItem(tx, workId);
    await assertCanAccess(workId, user, tx);
    if (current.status === 'Closed') throw badRequest('Closed work cannot get new files. Reopen it first.');
    const r = await query(
      `INSERT INTO dbo.WorkAttachments (WorkId, FileName, ContentType, SizeBytes, Content, UploadedByUserId)
       VALUES (@workId, @name, @type, @size, @content, @userId)
       RETURNING AttachmentId`,
      {
        workId: [sql.Int, workId],
        size: [sql.Int, file.content.length],
        name: [sql.NVarChar(255), file.fileName],
        type: [sql.NVarChar(100), file.contentType],
        content: [sql.VarBinary(sql.MAX), file.content],
        userId: [sql.Int, user.userId],
      },
      tx,
    );
    await addHistory(tx, {
      workId,
      entryType: 'Attachment',
      oldStatus: current.status,
      newStatus: current.status,
      userId: user.userId,
      notes: `Attached ${file.fileName}`,
    });
    await query(`UPDATE dbo.WorkItems SET UpdatedAt = now() WHERE WorkId = @id`, { id: [sql.Int, workId] }, tx);
    return r.recordset[0].AttachmentId as number;
  });
  quietly(
    (async () => {
      const audience = await workAudience(workId);
      await notify(user.clientId, {
        userIds: audience.everyone,
        kind: 'Attachment',
        workId,
        actor: user,
        message: `${actorName(user)} attached ${file.fileName} to ${audience.workNo}`,
      });
    })(),
  );
  return { attachmentId, work: await getWorkItem(workId, user) };
}

async function loadAttachment(attachmentId: number, tx?: Tx) {
  const r = await query(
    `SELECT a.WorkId, a.FileName, a.ContentType, a.Content, a.UploadedByUserId, a.DeletedAt
     FROM dbo.WorkAttachments a WHERE a.AttachmentId = @id`,
    { id: [sql.Int, attachmentId] },
    tx,
  );
  return r.recordset[0] as Row | undefined;
}

export async function getAttachment(attachmentId: number, user: AuthUser) {
  const row = await loadAttachment(attachmentId);
  if (!row) throw notFound('File');
  await assertCanAccess(row.WorkId as number, user);
  if (row.DeletedAt || !row.Content) throw notFound('File');
  return { fileName: row.FileName as string, contentType: row.ContentType as string, content: row.Content as Buffer };
}

/** The uploader or a manager may remove a file; its content is erased, the history entry stays. */
export async function removeAttachment(attachmentId: number, user: AuthUser) {
  const workId = await withTransaction(async (tx) => {
    const row = await loadAttachment(attachmentId, tx);
    if (!row || row.DeletedAt) throw notFound('File');
    const id = row.WorkId as number;
    const current = await lockWorkItem(tx, id);
    await assertCanAccess(id, user, tx);
    if (current.status === 'Closed') throw badRequest('Files of closed work cannot be removed. Reopen it first.');
    if (!isManager(user.role) && row.UploadedByUserId !== user.userId) throw forbidden('You can only remove files you added.');
    await query(
      `UPDATE dbo.WorkAttachments SET Content = NULL, DeletedAt = now(), DeletedByUserId = @userId WHERE AttachmentId = @aid`,
      { aid: [sql.Int, attachmentId], userId: [sql.Int, user.userId] },
      tx,
    );
    await addHistory(tx, {
      workId: id,
      entryType: 'Attachment',
      oldStatus: current.status,
      newStatus: current.status,
      userId: user.userId,
      notes: `Removed ${row.FileName as string}`,
    });
    return id;
  });
  return getWorkItem(workId, user);
}
