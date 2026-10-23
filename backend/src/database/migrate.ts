import { assertSchemaName, getPool, MAIN_SCHEMA } from './pool.js';
import { readSqlFile } from './sqlFiles.js';

/**
 * Creates and upgrades the tables. backend/database/client.sql is idempotent; SCHEMA_VERSION records which
 * version each company schema has, so start-up only runs it when this build is newer.
 * Raise SCHEMA_VERSION whenever client.sql changes (add new columns with ADD COLUMN IF NOT EXISTS).
 */
export const SCHEMA_VERSION = 2; // 2: LiveEvents

let mainReady: Promise<void> | null = null;
const clientReady = new Map<string, Promise<boolean>>();

/**
 * Upgrades a company's schema at most once per process. On a long-running server start-up already did
 * this; on serverless hosting each new instance checks on the company's first request.
 */
export function ensureClientSchemaOnce(schema: string): Promise<boolean> {
  let ready = clientReady.get(schema);
  if (!ready) {
    ready = ensureClientSchema(schema).catch((err) => {
      clientReady.delete(schema); // retry on the next request
      throw err;
    });
    clientReady.set(schema, ready);
  }
  return ready;
}

/** Shared tables (client registry, versions). Runs once per process. */
export function ensureMainSchema(): Promise<void> {
  mainReady ??= (async () => {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('workdone:main'))`);
      await client.query(readSqlFile('main.sql'));
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  })().catch((err) => {
    mainReady = null; // retry on the next call
    throw err;
  });
  return mainReady;
}

/** Creates or upgrades one company's schema (no-op when it is already current). */
export async function ensureClientSchema(schema: string, options: { seed?: boolean } = {}): Promise<boolean> {
  assertSchemaName(schema);
  if (schema === MAIN_SCHEMA) throw new Error('Company data cannot live in the public schema');
  await ensureMainSchema();
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    // One upgrade at a time per schema, even with several app instances starting together
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`workdone:${schema}`]);
    const v = await client.query('SELECT Version FROM public.SchemaVersions WHERE SchemaName = $1', [schema]);
    const current = Number(v.rows[0]?.version ?? 0);
    if (current >= SCHEMA_VERSION && !options.seed) {
      await client.query('COMMIT');
      return false;
    }
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    await client.query(readSqlFile('client.sql').replace(/\bdbo\./g, `"${schema}".`));
    if (options.seed) await client.query(readSqlFile('seed.sql').replace(/\bdbo\./g, `"${schema}".`));
    await client.query(
      `INSERT INTO public.SchemaVersions (SchemaName, Version) VALUES ($1, $2)
       ON CONFLICT (SchemaName) DO UPDATE SET Version = EXCLUDED.Version, UpdatedAt = now()`,
      [schema, SCHEMA_VERSION],
    );
    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Brings every registered company up to date (run at start-up). */
export async function migrateAll(): Promise<string[]> {
  await ensureMainSchema();
  const r = await getPool().query('SELECT SchemaName FROM public.Clients ORDER BY ClientId');
  const upgraded: string[] = [];
  for (const row of r.rows) {
    if (await ensureClientSchema(row.schemaname as string)) upgraded.push(row.schemaname as string);
  }
  return upgraded;
}
