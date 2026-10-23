import { runInDatabase } from '../database/pool.js';
import { purgeOldSessions } from './auth.service.js';
import { purgeLiveEvents } from './chatHub.js';
import { listClients } from './clients.service.js';
import { sendDueAlerts } from './notifications.service.js';
import { runDueTemplates } from './recurring.service.js';

/**
 * Background work for every active client company: creates due repeating work and sends the
 * "due today" / "overdue" reminders. Each step is idempotent, so running it often is harmless.
 * A long-running server runs it every 15 minutes; serverless hosting runs it from the daily cron
 * request (GET /api/cron/daily), which also does the clean-up.
 */
const INTERVAL_MS = 15 * 60 * 1000;
const warned = new Set<string>();

export async function runJobsOnce(options: { cleanUp?: boolean } = {}) {
  const summary: Record<string, { created: number; reminders: number } | { error: string }> = {};
  for (const client of await listClients()) {
    if (!client.isActive) continue;
    await runInDatabase(client.schemaName, async () => {
      try {
        const created = await runDueTemplates(client.clientId);
        const reminders = await sendDueAlerts(client.clientId);
        if (options.cleanUp) {
          await purgeOldSessions();
          await purgeLiveEvents();
        }
        if (created || reminders) console.log(`[jobs] ${client.clientId}: ${created} repeating work item(s), ${reminders} reminder(s)`);
        summary[client.clientId] = { created, reminders };
        warned.delete(client.clientId);
      } catch (err) {
        // Say so once, not every run
        if (!warned.has(client.clientId)) console.error(`[jobs] ${client.clientId}: ${(err as Error).message}`);
        warned.add(client.clientId);
        summary[client.clientId] = { error: (err as Error).message };
      }
    });
  }
  return summary;
}

export function startJobs() {
  const run = () => runJobsOnce().catch((err: Error) => console.error('[jobs] failed:', err.message));
  setTimeout(run, 5_000).unref();
  setInterval(run, INTERVAL_MS).unref();
}
