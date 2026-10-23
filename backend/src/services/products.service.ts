import { query, sql, type Params, type Row } from '../database/pool.js';
import { toIso } from '../utils/dates.js';
import { badRequest, notFound } from '../utils/httpError.js';
import { likeParam, pagedQuery, whereClause } from '../utils/sqlHelpers.js';
import type { ProductInput } from '../validators/master.validators.js';

const COLUMNS = `p.ProductId, p.ProductCode, p.ProductName, p.ProductGroupId, g.GroupName, g.GroupCode,
  p.Description, p.IsActive, p.CreatedAt, p.UpdatedAt`;
const FROM = `dbo.Products p JOIN dbo.ProductGroups g ON g.ProductGroupId = p.ProductGroupId`;

function map(r: Row) {
  return {
    productId: r.ProductId as number,
    productCode: r.ProductCode as string,
    productName: r.ProductName as string,
    productGroupId: r.ProductGroupId as number,
    groupName: r.GroupName as string,
    groupCode: r.GroupCode as string,
    description: r.Description as string | null,
    isActive: Boolean(r.IsActive),
    createdAt: toIso(r.CreatedAt),
    updatedAt: toIso(r.UpdatedAt),
  };
}

function inputParams(data: ProductInput): Params {
  return {
    code: [sql.NVarChar(20), data.productCode],
    name: [sql.NVarChar(150), data.productName],
    groupId: [sql.Int, data.productGroupId],
    desc: [sql.NVarChar(500), data.description],
    active: [sql.Bit, data.isActive],
  };
}

/** A product may only be moved into (or created in) an existing, active group. */
async function assertGroupUsable(groupId: number, currentGroupId?: number) {
  const r = await query(`SELECT IsActive FROM dbo.ProductGroups WHERE ProductGroupId = @id`, {
    id: [sql.Int, groupId],
  });
  if (!r.recordset[0]) throw badRequest('Selected product group does not exist.');
  if (!r.recordset[0].IsActive && groupId !== currentGroupId) {
    throw badRequest('Selected product group is inactive.');
  }
}

export async function listProducts(q: {
  search?: string;
  isActive?: boolean;
  productGroupId?: number;
  page: number;
  pageSize: number;
}) {
  const where: string[] = [];
  const params: Params = {};
  if (q.search) {
    where.push('(p.ProductCode ILIKE @s OR p.ProductName ILIKE @s OR p.Description ILIKE @s OR g.GroupName ILIKE @s)');
    params.s = likeParam(q.search);
  }
  if (q.isActive !== undefined) {
    where.push('p.IsActive = @active');
    params.active = [sql.Bit, q.isActive];
  }
  if (q.productGroupId) {
    where.push('p.ProductGroupId = @groupId');
    params.groupId = [sql.Int, q.productGroupId];
  }
  const w = whereClause(where);
  return pagedQuery(
    `SELECT COUNT(*) AS Total FROM ${FROM} ${w}`,
    `SELECT ${COLUMNS} FROM ${FROM} ${w} ORDER BY p.ProductName, p.ProductId`,
    params,
    q.page,
    q.pageSize,
    map,
  );
}

export async function getProduct(id: number) {
  const r = await query(`SELECT ${COLUMNS} FROM ${FROM} WHERE p.ProductId = @id`, { id: [sql.Int, id] });
  if (!r.recordset[0]) throw notFound('Product');
  return map(r.recordset[0]);
}

export async function createProduct(data: ProductInput) {
  await assertGroupUsable(data.productGroupId);
  const r = await query(
    `INSERT INTO dbo.Products (ProductCode, ProductName, ProductGroupId, Description, IsActive)
     VALUES (@code, @name, @groupId, @desc, @active)
     RETURNING ProductId`,
    inputParams(data),
  );
  return getProduct(r.recordset[0].ProductId);
}

export async function updateProduct(id: number, data: ProductInput) {
  const existing = await getProduct(id);
  await assertGroupUsable(data.productGroupId, existing.productGroupId);
  await query(
    `UPDATE dbo.Products
     SET ProductCode = @code, ProductName = @name, ProductGroupId = @groupId, Description = @desc,
         IsActive = @active, UpdatedAt = now()
     WHERE ProductId = @id`,
    { ...inputParams(data), id: [sql.Int, id] },
  );
  return getProduct(id);
}
