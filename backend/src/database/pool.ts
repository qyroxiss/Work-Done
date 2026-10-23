import { AsyncLocalStorage } from 'node:async_hooks';
import pg from 'pg';
import { config, type DbConfig } from '../config/env.js';
import { HttpError } from '../utils/httpError.js';

/**
 * PostgreSQL access for the services.
 *
 * - Queries use named parameters (`@userId`) bound to `[type, value]` pairs; they are sent to
 *   PostgreSQL as `$1, $2…`, never concatenated into SQL.
 * - Each client company has its own schema. Services write `dbo.Users`; `dbo.` is replaced by the
 *   schema of the current request (see runInDatabase), so services never need to know the client.
 * - PostgreSQL returns column names in lower case; result rows get back the spelling used in the
 *   query text (`w.WorkId` -> row.WorkId), so services read rows the same way everywhere.
 * - A batch may contain several statements separated by ";". They run in order on one connection;
 *   every statement that returns rows (SELECT, RETURNING) adds one entry to `recordsets`.
 */

// int8 (COUNT(*), BIGINT ids) as numbers; all our values are far below 2^53
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));
// DATE as UTC midnight, the convention of utils/dates.ts ("calendar date", independent of time zones)
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => new Date(`${v}T00:00:00Z`));

/** Parameter type hints. Dates are sent as plain "YYYY-MM-DD" so the server's time zone never shifts them. */
export type SqlType = 'int' | 'bigint' | 'smallint' | 'text' | 'date' | 'timestamptz' | 'bool' | 'bytea';

export const sql = {
  Int: 'int',
  BigInt: 'bigint',
  SmallInt: 'smallint',
  TinyInt: 'smallint',
  Bit: 'bool',
  Date: 'date',
  NVarChar: (_length?: number): SqlType => 'text',
  Char: (_length?: number): SqlType => 'text',
  DateTime2: (_scale?: number): SqlType => 'timestamptz',
  VarBinary: (_length?: number): SqlType => 'bytea',
  /** Length "max" (kept so call sites read like column definitions) */
  MAX: -1,
} as const satisfies Record<string, SqlType | number | ((n?: number) => SqlType)>;

/** Named query parameter: [type, value] */
export type Param = [SqlType, unknown];
export type Params = Record<string, Param>;
/** Database rows are mapped explicitly to API DTOs, so they are loosely typed here. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;

/** An open transaction (one dedicated connection). */
export type Tx = pg.PoolClient;

export interface QueryResult<T extends Row = Row> {
  /** Rows of the first statement that returned rows */
  recordset: T[];
  recordsets: T[][];
  /** Rows changed per statement */
  rowsAffected: number[];
}

export function requireDbConfig(): DbConfig {
  if (!config.db) {
    throw new HttpError(503, 'Q-WorkDone has not been set up yet. Open the app on the server computer to run setup.', 'SETUP_REQUIRED');
  }
  return config.db;
}

/** Connection settings for a connection string (TLS when the string asks for it, e.g. Neon's sslmode=require). */
export function poolConfig(db: DbConfig): pg.PoolConfig {
  return {
    connectionString: db.url,
    max: db.poolSize,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
    statement_timeout: 30_000,
    application_name: 'q-workdone',
  };
}

// ---------------------------------------------------------------- Client schemas

/** Schema of the client registry (and of anything not tied to a client). */
export const MAIN_SCHEMA = 'public';
const SCHEMA_RE = /^[a-z][a-z0-9_]{0,62}$/;

// The schema used by query() / withTransaction() comes from the async context of the current request
// (set by the auth middleware), so the services never need to know which client they are working for.
const schemaContext = new AsyncLocalStorage<string>();

export function assertSchemaName(schema: string): string {
  if (!SCHEMA_RE.test(schema)) throw new Error(`Invalid schema name "${schema}"`);
  return schema;
}

/** Runs `fn` (and everything it awaits) against the given client schema. */
export function runInDatabase<T>(schema: string, fn: () => T): T {
  return schemaContext.run(assertSchemaName(schema), fn);
}

/** Runs `fn` against the main schema (client registry, setup). */
export function runInMainDatabase<T>(fn: () => T): T {
  return schemaContext.run(MAIN_SCHEMA, fn);
}

/** Schema of the current request: the signed-in client's, otherwise the main schema. */
export function currentDatabase(): string {
  return schemaContext.getStore() ?? MAIN_SCHEMA;
}

// ---------------------------------------------------------------- Pool

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool(poolConfig(requireDbConfig()));
    pool.on('error', (err) => console.error('[db] idle connection error:', err.message));
  }
  return pool;
}

export async function closePool(): Promise<void> {
  const p = pool;
  pool = null;
  await p?.end().catch(() => undefined);
}

// ---------------------------------------------------------------- SQL translation

interface Statement {
  text: string;
  /** Parameter name for $1, $2, … (a name used twice appears twice) */
  names: string[];
}

interface Compiled {
  statements: Statement[];
  /** lower-case column name -> spelling in the query text */
  columns: Map<string, string>;
}

const compiled = new Map<string, Compiled>();

/**
 * Splits a batch on top-level ";", turns @name into $n (outside strings and comments) and
 * collects identifier spellings for the result column names.
 */
export function compile(text: string): Compiled {
  const cached = compiled.get(text);
  if (cached) return cached;

  const statements: Statement[] = [];
  const columns = new Map<string, string>();
  let out = '';
  let names: string[] = [];
  let i = 0;

  const flush = () => {
    if (out.trim()) statements.push({ text: out.trim(), names });
    out = '';
    names = [];
  };

  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === "'" || ch === '"') {
      // String literal or quoted identifier ('' / "" escape themselves)
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === ch) {
          if (text[j + 1] === ch) j += 2;
          else break;
        } else j++;
      }
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (ch === '-' && next === '-') {
      const end = text.indexOf('\n', i);
      i = end === -1 ? text.length : end;
    } else if (ch === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 2;
    } else if (ch === ';') {
      flush();
      i++;
    } else if (ch === '@' && /[A-Za-z_]/.test(next ?? '')) {
      let j = i + 1;
      while (j < text.length && /[A-Za-z0-9_]/.test(text[j])) j++;
      // Every occurrence gets its own placeholder, so PostgreSQL deduces each one's type from its own
      // context (one parameter compared with text and assigned to a varchar column is fine)
      out += `$${names.push(text.slice(i + 1, j))}`;
      i = j;
    } else if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1;
      while (j < text.length && /[A-Za-z0-9_]/.test(text[j])) j++;
      const word = text.slice(i, j);
      const lower = word.toLowerCase();
      // Column spellings (WorkId) win over keywords that happen to match (TOTAL, NAME)
      const known = columns.get(lower);
      if (word !== lower && (!known || (known === known.toUpperCase() && word !== word.toUpperCase()))) columns.set(lower, word);
      out += word;
      i = j;
    } else {
      out += ch;
      i++;
    }
  }
  flush();

  const result = { statements, columns };
  if (compiled.size > 2000) compiled.clear();
  compiled.set(text, result);
  return result;
}

function toDbValue([type, value]: Param): unknown {
  if (value === undefined || value === null) return null;
  if (type === 'date' && value instanceof Date) return value.toISOString().slice(0, 10);
  return value;
}

function withSchema(text: string, schema: string): string {
  return text.replace(/\bdbo\./g, `"${schema}".`);
}

function mapRows(result: pg.QueryResult, columns: Map<string, string>): Row[] {
  const keys = result.fields.map((f) => columns.get(f.name) ?? f.name);
  return result.rows.map((r: Row) => {
    const row: Row = {};
    result.fields.forEach((f, idx) => {
      row[keys[idx]] = r[f.name];
    });
    return row;
  });
}

/** Runs a parameterized query (or a batch of statements), optionally inside a transaction. */
export async function query<T extends Row = Row>(text: string, params: Params = {}, tx?: Tx): Promise<QueryResult<T>> {
  const { statements, columns } = compile(text);
  const schema = currentDatabase();
  const run = async (client: pg.Pool | pg.PoolClient): Promise<QueryResult<T>> => {
    const recordsets: T[][] = [];
    const rowsAffected: number[] = [];
    for (const st of statements) {
      const values = st.names.map((name) => {
        const p = params[name];
        if (!p) throw new Error(`Missing SQL parameter @${name}`);
        return toDbValue(p);
      });
      const r = await client.query({ text: withSchema(st.text, schema), values });
      if (r.fields?.length) recordsets.push(mapRows(r, columns) as T[]);
      rowsAffected.push(r.rowCount ?? 0);
    }
    return { recordset: recordsets[0] ?? [], recordsets, rowsAffected };
  };

  if (tx) return run(tx);
  if (statements.length === 1) return run(getPool());
  // Several statements: one connection, so they see each other's work in order
  const client = await getPool().connect();
  try {
    return await run(client);
  } finally {
    client.release();
  }
}

/** Returns all recordsets of a multi-statement batch. */
export function recordsets(result: QueryResult): Row[][] {
  return result.recordsets;
}

export async function withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Runs a script of DDL statements (no parameters) in the given schema, e.g. table creation. */
export async function runScript(script: string, schema: string): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query(withSchema(script, assertSchemaName(schema)));
  } finally {
    client.release();
  }
}
