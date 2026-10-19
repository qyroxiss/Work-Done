import { runInDatabase } from '../database/pool.js';
import { listClients } from './clients.service.js';
import { sendDueAlerts } from './notifications.service.js';
import { runDueTemplates } from './recurring.service.js';

/**
 * Background work for every active client company: creates due repeating work and sends the
 * "due today" / "overdue" reminders. Each step is idempotent, so running it often is harmless.
 */
const INTERVAL_MS = 15 * 60 * 1000;
const warned = new Set<string>();

export async function runJobsOnce() {
  for (const client of await listClients()) {
    if (!client.isActive) continue;
    await runInDatabase(client.databaseName, async () => {
      try {
        const created = await runDueTemplates(client.clientId);
        const alerts = await sendDueAlerts(client.clientId);
        if (created || alerts) console.log(`[jobs] ${client.clientId}: ${created} repeating work item(s), ${alerts} reminder(s)`);
        warned.delete(client.clientId);
      } catch (err) {
        // Typically a database that still needs "Update database"; say so once, not every run
        if (!warned.has(client.clientId)) console.error(`[jobs] ${client.clientId}: ${(err as Error).message}`);
        warned.add(client.clientId);
      }
    });
  }
}

export function startJobs() {
  const run = () => runJobsOnce().catch((err: Error) => console.error('[jobs] failed:', err.message));
  setTimeout(run, 5_000).unref();
  setInterval(run, INTERVAL_MS).unref();
}
