/**
 * One-off move of an existing SQL Server installation (the version before PostgreSQL) into PostgreSQL.
 *
 *   npm run import:sqlserver                 -> imports every client company
 *   npm run import:sqlserver -- --client DEMO
 *   add --replace                            -> overwrite a company that was already imported
 *
 * Reads the old SQL Server settings (DB_SERVER, DB_DATABASE, DB_USER, DB_PASSWORD, DB_PORT, DB_ENCRYPT,
 * DB_TRUST_SERVER_CERTIFICATE) from backend/.env or the environment, and writes to DATABASE_URL.
 * Everything is copied with its original ids (work numbers stay the same). Signed-in sessions are not
 * copied: everyone signs in again. SQL Server is only read, never changed.
 */
import fs from 'node:fs';
import dotenv from 'dotenv';
import mssql from 'mssql';
import type pg from 'pg';
import { ENV_PATH } from '../config/env.js';
import { ensureClientSchema, ensureMainSchema } from '../database/migrate.js';
import { closePool, getPool } from '../database/pool.js';
import { findClient, invalidateClients, normalizeClientId, registerClient, schemaNameFor } from '../services/clients.service.js';
import { argValue } from './prompt.js';

/** In foreign-key order. Sessions are deliberately left out. */
const TABLES = [
  'Employees',
  'Users',
  'AppSettings',
  'ProductGroups',
  'Products',
  'RecurringWork',
  'RecurringWorkAssignees',
  'WorkItems',
  'WorkAssignments',
  'WorkStatusHistory',
  'WorkAttachments',
  'SecurityEvents',
  'ChatConversations',
  'ChatMembers',
  'ChatMessages',
  'ChatAttachments',
  'Notifications',
];

function legacyConfig(database?: string): mssql.config {
  const env = { ...(fs.existsSync(ENV_PATH) ? dotenv.parse(fs.readFileSync(ENV_PATH)) : {}), ...process.env };
  const raw = env.DB_SERVER?.trim();
  if (!raw || !env.DB_USER || env.DB_PASSWORD === undefined) {
    throw new Error('The old SQL Server settings (DB_SERVER, DB_USER, DB_PASSWORD, DB_DATABASE) were not found in backend/.env.');
  }
  const [server, instanceName] = raw.split('\\');
  const port = env.DB_PORT ? Number(env.DB_PORT) : undefined;
  return {
    server,
    database: database ?? env.DB_DATABASE ?? 'WorkDoneDB',
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    ...(port ? { port } : {}),
    options: {
      ...(port ? {} : { instanceName: instanceName || undefined }),
      encrypt: (env.DB_ENCRYPT ?? 'true') !== 'false',
      trustServerCertificate: (env.DB_TRUST_SERVER_CERTIFICATE ?? 'false') === 'true',
      useUTC: true,
    },
    requestTimeout: 120_000,
  };
}

interface Column {
  name: string;
  type: string;
}

/** Columns the app writes (generated columns such as WorkNo and the RowVer token are left to PostgreSQL). */
async function targetColumns(client: pg.PoolClient, schema: string, table: string): Promise<Column[]> {
  const r = await client.query(
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2 AND is_generated = 'NEVER' AND column_name <> 'rowver'
     ORDER BY ordinal_position`,
    [schema, table.toLowerCase()],
  );
  return r.rows.map((c) => ({ name: c.column_name as string, type: c.data_type as string }));
}

function toPg(value: unknown, type: string): unknown {
  if (value === null || value === undefined) return null;
  // DATE columns arrive as UTC-midnight Dates; send the calendar date itself
  if (type === 'date' && value instanceof Date) return value.toISOString().slice(0, 10);
  return value;
}

async function copyTable(source: mssql.ConnectionPool, target: pg.PoolClient, schema: string, table: string): Promise<number> {
  const exists = await source.request().query(`SELECT OBJECT_ID(N'dbo.${table}', N'U') AS Id`);
  if (exists.recordset[0].Id === null) return 0; // older SQL Server version without this feature

  const columns = await targetColumns(target, schema, table);
  const sourceCols = await source
    .request()
    .query(`SELECT LOWER(name) AS name FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.${table}')`);
  const available = new Set(sourceCols.recordset.map((c) => c.name as string));
  const cols = columns.filter((c) => available.has(c.name));

  const rows = (await source.request().query(`SELECT ${cols.map((c) => `[${c.name}]`).join(', ')} FROM dbo.${table}`)).recordset;
  const batch = Math.max(1, Math.floor(30_000 / cols.length));
  for (let i = 0; i < rows.length; i += batch) {
    const chunk = rows.slice(i, i + batch);
    const values: unknown[] = [];
    const tuples = chunk.map((row) => {
      const placeholders = cols.map((c) => {
        values.push(toPg(row[c.name], c.type));
        return `$${values.length}`;
      });
      return `(${placeholders.join(', ')})`;
    });
    await target.query(`INSERT INTO "${schema}".${table.toLowerCase()} (${cols.map((c) => c.name).join(', ')}) VALUES ${tuples.join(', ')}`, values);
  }

  // Identity columns continue after the highest imported id
  const identity = await target.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2 AND is_identity = 'YES'`,
    [schema, table.toLowerCase()],
  );
  for (const { column_name } of identity.rows) {
    await target.query(
      `SELECT setval(pg_get_serial_sequence('"${schema}".${table.toLowerCase()}', '${column_name}'),
                     COALESCE((SELECT MAX(${column_name}) FROM "${schema}".${table.toLowerCase()}), 0) + 1, false)`,
    );
  }
  return rows.length;
}

async function importClient(client: { clientId: string; companyName: string; databaseName: string; isActive: boolean }, replace: boolean) {
  const clientId = normalizeClientId(client.clientId);
  const schema = schemaNameFor(clientId);
  const pool = getPool();

  if (await findClient(clientId)) {
    if (!replace) {
      console.log(`- ${clientId}: already imported (use --replace to import again)`);
      return;
    }
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await pool.query(`DELETE FROM public.SchemaVersions WHERE SchemaName = $1`, [schema]);
    await pool.query(`DELETE FROM public.Clients WHERE ClientId = $1`, [clientId]);
    invalidateClients();
  }

  console.log(`- ${clientId} (${client.companyName}) from ${client.databaseName}`);
  await ensureClientSchema(schema);
  const source = await new mssql.ConnectionPool(legacyConfig(client.databaseName)).connect();
  const target = await pool.connect();
  try {
    await target.query('BEGIN');
    // Imported rows keep their original RowVer-free state; the trigger is only for later edits
    for (const table of TABLES) {
      const n = await copyTable(source, target, schema, table);
      if (n) console.log(`    ${table.padEnd(24)} ${n}`);
    }
    await target.query('COMMIT');
  } catch (err) {
    await target.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    target.release();
    await source.close();
  }
  await registerClient({ clientId, companyName: client.companyName, schemaName: schema });
  if (!client.isActive) await pool.query(`UPDATE public.Clients SET IsActive = false WHERE ClientId = $1`, [clientId]);
  console.log(`    registered as ${clientId} (schema ${schema})`);
}

async function main() {
  const only = argValue('--client');
  const replace = process.argv.includes('--replace');
  await ensureMainSchema();

  const main = await new mssql.ConnectionPool(legacyConfig()).connect();
  let clients: { clientId: string; companyName: string; databaseName: string; isActive: boolean }[];
  try {
    const r = await main.request().query(`SELECT ClientId, CompanyName, DatabaseName, IsActive FROM dbo.Clients ORDER BY ClientId`);
    clients = r.recordset.map((c) => ({ clientId: c.ClientId, companyName: c.CompanyName, databaseName: c.DatabaseName, isActive: Boolean(c.IsActive) }));
  } finally {
    await main.close();
  }
  if (only) clients = clients.filter((c) => normalizeClientId(c.clientId) === normalizeClientId(only));
  if (clients.length === 0) throw new Error(only ? `Client ID "${only}" was not found in SQL Server.` : 'No client companies found in SQL Server.');

  console.log(`Importing ${clients.length} compan${clients.length === 1 ? 'y' : 'ies'} into PostgreSQL:`);
  for (const c of clients) await importClient(c, replace);
  console.log('\nDone. Everyone signs in again with the same Client ID, username and password.');
}

main()
  .catch((err: Error) => {
    console.error('\nImport failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => closePool());
