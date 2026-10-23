/**
 * Creates or upgrades the tables (the server also does this by itself at start-up).
 *
 *   npm run db:setup                         -> shared tables + every registered company's tables
 *   npm run db:seed -- --client ACME         -> adds development sample data to that company
 *
 * Uses DATABASE_URL from backend/.env (or the environment).
 */
import { ensureClientSchema, migrateAll } from '../database/migrate.js';
import { closePool } from '../database/pool.js';
import { findClient } from '../services/clients.service.js';
import { argValue } from './prompt.js';

async function main() {
  if (process.argv.includes('--seed-only')) {
    const wanted = argValue('--client');
    if (!wanted) throw new Error('Choose the company with --client <Client ID>.');
    const client = await findClient(wanted);
    if (!client) throw new Error(`Client ID "${wanted}" does not exist.`);
    await ensureClientSchema(client.schemaName, { seed: true });
    console.log(`Sample employees and products added to ${client.clientId}.`);
    return;
  }
  const upgraded = await migrateAll();
  console.log(upgraded.length ? `Tables created/upgraded for: ${upgraded.join(', ')}` : 'All tables are up to date.');
}

main()
  .catch((err: Error) => {
    console.error('\nDatabase setup failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => closePool());
