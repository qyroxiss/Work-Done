import { query, sql, type Params, type Row } from '../database/pool.js';
import { parseDateOnly, toDateOnly, toIso } from '../utils/dates.js';
import { notFound } from '../utils/httpError.js';
import { likeParam, pagedQuery, whereClause } from '../utils/sqlHelpers.js';
import type { EmployeeInput } from '../validators/master.validators.js';

const COLUMNS = `EmployeeId, EmployeeCode, EmployeeName, Department, Phone, Email, JoiningDate, IsActive, CreatedAt, UpdatedAt`;

function map(r: Row) {
  return {
    employeeId: r.EmployeeId as number,
    employeeCode: r.EmployeeCode as string,
    employeeName: r.EmployeeName as string,
    department: r.Department as string | null,
    phone: r.Phone as string | null,
    email: r.Email as string | null,
    joiningDate: toDateOnly(r.JoiningDate),
    isActive: Boolean(r.IsActive),
    createdAt: toIso(r.CreatedAt),
    updatedAt: toIso(r.UpdatedAt),
  };
}

function inputParams(data: EmployeeInput): Params {
  return {
    code: [sql.NVarChar(20), data.employeeCode],
    name: [sql.NVarChar(100), data.employeeName],
    dept: [sql.NVarChar(100), data.department],
    phone: [sql.NVarChar(30), data.phone],
    email: [sql.NVarChar(150), data.email],
    joining: [sql.Date, parseDateOnly(data.joiningDate)],
    active: [sql.Bit, data.isActive],
  };
}

export async function listEmployees(q: { search?: string; isActive?: boolean; page: number; pageSize: number }) {
  const where: string[] = [];
  const params: Params = {};
  if (q.search) {
    where.push('(EmployeeCode LIKE @s OR EmployeeName LIKE @s OR Department LIKE @s OR Email LIKE @s OR Phone LIKE @s)');
    params.s = likeParam(q.search);
  }
  if (q.isActive !== undefined) {
    where.push('IsActive = @active');
    params.active = [sql.Bit, q.isActive];
  }
  const w = whereClause(where);
  return pagedQuery(
    `SELECT COUNT(*) AS Total FROM dbo.Employees ${w}`,
    `SELECT ${COLUMNS} FROM dbo.Employees ${w} ORDER BY EmployeeName, EmployeeId`,
    params,
    q.page,
    q.pageSize,
    map,
  );
}

export async function getEmployee(id: number) {
  const r = await query(`SELECT ${COLUMNS} FROM dbo.Employees WHERE EmployeeId = @id`, { id: [sql.Int, id] });
  if (!r.recordset[0]) throw notFound('Employee');
  return map(r.recordset[0]);
}

export async function createEmployee(data: EmployeeInput) {
  const r = await query(
    `INSERT INTO dbo.Employees (EmployeeCode, EmployeeName, Department, Phone, Email, JoiningDate, IsActive)
     OUTPUT INSERTED.EmployeeId
     VALUES (@code, @name, @dept, @phone, @email, @joining, @active)`,
    inputParams(data),
  );
  return getEmployee(r.recordset[0].EmployeeId);
}

export async function updateEmployee(id: number, data: EmployeeInput) {
  const r = await query(
    `UPDATE dbo.Employees
     SET EmployeeCode = @code, EmployeeName = @name, Department = @dept, Phone = @phone,
         Email = @email, JoiningDate = @joining, IsActive = @active, UpdatedAt = SYSUTCDATETIME()
     WHERE EmployeeId = @id`,
    { ...inputParams(data), id: [sql.Int, id] },
  );
  if (r.rowsAffected[0] === 0) throw notFound('Employee');
  return getEmployee(id);
}
