import { query, recordsets, sql, type Params, type Row, type SqlType } from '../database/pool.js';
import type { Paged } from '../types/domain.js';

/**
 * Escapes LIKE wildcards in user input and wraps it for a "contains" search.
 * Use with ILIKE, so searches ignore case (as users expect).
 */
export function likeParam(term: string): [SqlType, string] {
  const escaped = term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  return [sql.NVarChar(210), `%${escaped}%`];
}

/**
 * Builds "@p0, @p1, ..." for an IN (...) list and adds the parameters.
 * Values are always passed as parameters, never concatenated into SQL.
 */
export function inList(params: Params, prefix: string, values: readonly unknown[], type: SqlType): string {
  return values
    .map((value, i) => {
      const name = `${prefix}${i}`;
      params[name] = [type, value];
      return `@${name}`;
    })
    .join(', ');
}

export function whereClause(conditions: string[]): string {
  return conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
}

/**
 * Runs a count query and a page query on one connection.
 * `dataSql` must end with an ORDER BY clause.
 */
export async function pagedQuery<T>(
  countSql: string,
  dataSql: string,
  params: Params,
  page: number,
  pageSize: number,
  map: (row: Row) => T,
): Promise<Paged<T>> {
  const result = await query(
    `${countSql};
     ${dataSql} OFFSET @pgOffset ROWS FETCH NEXT @pgSize ROWS ONLY;`,
    { ...params, pgOffset: [sql.Int, (page - 1) * pageSize], pgSize: [sql.Int, pageSize] },
  );
  const [countRows, dataRows] = recordsets(result);
  return {
    items: dataRows.map(map),
    total: Number(countRows[0]?.Total ?? 0),
    page,
    pageSize,
  };
}
