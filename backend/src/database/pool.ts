import { AsyncLocalStorage } from 'node:async_hooks';
import sql from 'mssql';
import { config, type DbConfig } from '../config/env.js';
import { HttpError } from '../utils/httpError.js';

export { sql };

export type SqlType = Parameters<sql.Request['input']>[1];
/** Named query parameter: [type, value] */
export type Param = [SqlType, unknown];
export type Params = Record<string, Param>;
/** Database rows are mapped explicitly to API DTOs, so they are loosely typed here. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;

export function requireDbConfig(): DbConfig {
  if (!config.db) {
    throw new HttpError(503, 'Q-WorkDone has not been set up yet. Open the app on the server computer to run setup.', 'SETUP_REQUIRED');
  }
  return config.db;
}

export function buildConfig(database?: string, db: DbConfig = requireDbConfig()): sql.config {
  return {
    server: db.server,
    database: database ?? db.database,
    user: db.user,
    password: db.password,
    // A fixed port takes precedence over a named instance (tedious rejects both together)
    ...(db.port ? { port: db.port } : {}),
    connectionTimeout: 15_000,
    requestTimeout: 30_000,
    pool: { max: 10, min: 0, idleTimeoutMillis: 30_000 },
    options: {
      ...(db.port ? {} : { instanceName: db.instanceName }),
      encrypt: db.encrypt,
      trustServerCertificate: db.trustServerCertificate,
      useUTC: true,
      enableArithAbort: true,
    },
  };
}

// Each client company has its own database. The database used by query() / withTransaction()
// is taken from the async context of the current request (set by the auth middleware), so the
// services never need to know which client they are working for.
const databaseContext = new AsyncLocalStorage<string>();

/** Runs `fn` (and everything it awaits) against the given client database. */
export function runInDatabase<T>(database: string, fn: () => T): T {
  return databaseContext.run(database, fn);
}

/** Runs `fn` against the main database (client registry, setup). */
export function runInMainDatabase<T>(fn: () => T): T {
  return databaseContext.run(requireDbConfig().database, fn);
}

/** Database of the current request: the signed-in client's, otherwise the main database. */
export function currentDatabase(): string {
  return databaseContext.getStore() ?? requireDbConfig().database;
}

const pools = new Map<string, Promise<sql.ConnectionPool>>();

export function getPool(database: string = currentDatabase()): Promise<sql.ConnectionPool> {
  let poolPromise = pools.get(database);
  if (!poolPromise) {
    let pool: sql.ConnectionPool;
    try {
      pool = new sql.ConnectionPool(buildConfig(database));
    } catch (err) {
      return Promise.reject(err);
    }
    pool.on('error', (err) => console.error(`[db] pool error (${database}):`, err.message));
    poolPromise = pool.connect().catch((err) => {
      pools.delete(database); // allow a retry on the next request
      throw err;
    });
    pools.set(database, poolPromise);
  }
  return poolPromise;
}

export async function closePool(): Promise<void> {
  const all = [...pools.values()];
  pools.clear();
  await Promise.all(all.map(async (p) => (await p.catch(() => null))?.close()));
}

/** Runs a parameterized query, optionally inside a transaction. */
export async function query<T extends Row = Row>(
  text: string,
  params: Params = {},
  tx?: sql.Transaction,
): Promise<sql.IResult<T>> {
  const request = tx ? new sql.Request(tx) : (await getPool()).request();
  for (const [name, [type, value]] of Object.entries(params)) {
    request.input(name, type, value);
  }
  return request.query<T>(text);
}

/** Returns all recordsets of a multi-statement batch. */
export function recordsets(result: sql.IResult<Row>): Row[][] {
  return result.recordsets as unknown as Row[][];
}

export async function withTransaction<T>(fn: (tx: sql.Transaction) => Promise<T>): Promise<T> {
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);
  try {
    const result = await fn(tx);
    await tx.commit();
    return result;
  } catch (err) {
    try {
      await tx.rollback();
    } catch {
      /* transaction may already be aborted by SQL Server */
    }
    throw err;
  }
}
