/**
 * Applies database/schema.sql, indexes.sql and clients.sql to the main database (and optionally seed.sql).
 * Further client companies get their own database with `npm run add-client`.
 *
 *   npm run db:setup              -> schema + indexes
 *   npm run db:setup -- --seed    -> schema + indexes + development seed data
 *   npm run db:seed               -> seed data only
 *   add --create-db               -> also CREATE DATABASE if it does not exist (needs permission on master)
 *
 * Run with an account that has DDL rights (db_owner) — not the routine app login.
 * Override the login for this run with SETUP_DB_USER / SETUP_DB_PASSWORD.
 */
import sql from 'mssql';
import { buildConfig, requireDbConfig } from '../database/pool.js';
import { readSqlFile, splitBatches } from '../database/sqlFiles.js';

const args = new Set(process.argv.slice(2));

function connectionConfig(database: string): sql.config {
  const cfg = buildConfig(database);
  if (process.env.SETUP_DB_USER) {
    cfg.user = process.env.SETUP_DB_USER;
    cfg.password = process.env.SETUP_DB_PASSWORD ?? '';
  }
  return cfg;
}

async function runFile(pool: sql.ConnectionPool, file: string) {
  const list = splitBatches(readSqlFile(file));
  process.stdout.write(`Running ${file} (${list.length} batches)... `);
  for (const batch of list) {
    await pool.request().batch(batch);
  }
  console.log('done');
}

async function main() {
  const dbName = requireDbConfig().database;
  if (!/^[A-Za-z0-9_]+$/.test(dbName)) throw new Error(`Unsafe database name: ${dbName}`);

  if (args.has('--create-db')) {
    const master = await new sql.ConnectionPool(connectionConfig('master')).connect();
    const exists = await master.request().input('name', sql.NVarChar(128), dbName).query('SELECT DB_ID(@name) AS Id');
    if (exists.recordset[0].Id === null) {
      await master.request().batch(`CREATE DATABASE [${dbName}]`);
      console.log(`Created database ${dbName}`);
    } else {
      console.log(`Database ${dbName} already exists`);
    }
    await master.close();
  }

  const pool = await new sql.ConnectionPool(connectionConfig(dbName)).connect();
  try {
    if (!args.has('--seed-only')) {
      await runFile(pool, 'schema.sql');
      await runFile(pool, 'indexes.sql');
      await runFile(pool, 'clients.sql');
    }
    if (args.has('--seed') || args.has('--seed-only')) {
      await runFile(pool, 'seed.sql');
    }
    console.log('Database setup complete.');
  } finally {
    await pool.close();
  }
}

main().catch((err: Error) => {
  console.error('\nDatabase setup failed:', err.message);
  process.exit(1);
});
