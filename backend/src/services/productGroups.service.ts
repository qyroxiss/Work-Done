import { query, sql, type Params, type Row } from '../database/pool.js';
import { toIso } from '../utils/dates.js';
import { notFound } from '../utils/httpError.js';
import { likeParam, pagedQuery, whereClause } from '../utils/sqlHelpers.js';
import type { ProductGroupInput } from '../validators/master.validators.js';

const COLUMNS = `g.ProductGroupId, g.GroupCode, g.GroupName, g.Description, g.IsActive, g.CreatedAt, g.UpdatedAt,
  (SELECT COUNT(*) FROM dbo.Products p WHERE p.ProductGroupId = g.ProductGroupId) AS ProductCount`;

function map(r: Row) {
  return {
    productGroupId: r.ProductGroupId as number,
    groupCode: r.GroupCode as string,
    groupName: r.GroupName as string,
    description: r.Description as string | null,
    isActive: Boolean(r.IsActive),
    productCount: Number(r.ProductCount ?? 0),
    createdAt: toIso(r.CreatedAt),
    updatedAt: toIso(r.UpdatedAt),
  };
}

function inputParams(data: ProductGroupInput): Params {
  return {
    code: [sql.NVarChar(20), data.groupCode],
    name: [sql.NVarChar(100), data.groupName],
    desc: [sql.NVarChar(500), data.description],
    active: [sql.Bit, data.isActive],
  };
}

export async function listProductGroups(q: { search?: string; isActive?: boolean; page: number; pageSize: number }) {
  const where: string[] = [];
  const params: Params = {};
  if (q.search) {
    where.push('(g.GroupCode ILIKE @s OR g.GroupName ILIKE @s OR g.Description ILIKE @s)');
    params.s = likeParam(q.search);
  }
  if (q.isActive !== undefined) {
    where.push('g.IsActive = @active');
    params.active = [sql.Bit, q.isActive];
  }
  const w = whereClause(where);
  return pagedQuery(
    `SELECT COUNT(*) AS Total FROM dbo.ProductGroups g ${w}`,
    `SELECT ${COLUMNS} FROM dbo.ProductGroups g ${w} ORDER BY g.GroupName, g.ProductGroupId`,
    params,
    q.page,
    q.pageSize,
    map,
  );
}

export async function getProductGroup(id: number) {
  const r = await query(`SELECT ${COLUMNS} FROM dbo.ProductGroups g WHERE g.ProductGroupId = @id`, {
    id: [sql.Int, id],
  });
  if (!r.recordset[0]) throw notFound('Product group');
  return map(r.recordset[0]);
}

export async function createProductGroup(data: ProductGroupInput) {
  const r = await query(
    `INSERT INTO dbo.ProductGroups (GroupCode, GroupName, Description, IsActive)
     VALUES (@code, @name, @desc, @active)
     RETURNING ProductGroupId`,
    inputParams(data),
  );
  return getProductGroup(r.recordset[0].ProductGroupId);
}

export async function updateProductGroup(id: number, data: ProductGroupInput) {
  const r = await query(
    `UPDATE dbo.ProductGroups
     SET GroupCode = @code, GroupName = @name, Description = @desc, IsActive = @active, UpdatedAt = now()
     WHERE ProductGroupId = @id`,
    { ...inputParams(data), id: [sql.Int, id] },
  );
  if (r.rowsAffected[0] === 0) throw notFound('Product group');
  return getProductGroup(id);
}
