/**
 * Adds a client company with its own tables (schema) and first administrator.
 *
 *   npm run add-client                                              -> prompts for everything
 *   npm run add-client -- --client ACME --name "Acme Pvt Ltd" --username admin [--email a@acme.com]
 *
 * The admin password may be given via ADMIN_PASSWORD for this single command.
 * The client's administrator must change the password at first sign-in.
 *
 * The same can be done in the browser: /clients on the server computer (or with the setup key).
 */
import type { z } from 'zod';
import { closePool } from '../database/pool.js';
import { createClient } from '../services/setup/setup.service.js';
import { clientIdRule, companyNameRule, passwordRule } from '../validators/common.js';
import { argValue, ask, askNewPassword, closePrompt } from './prompt.js';

function check<T>(rule: z.ZodType<T, z.ZodTypeDef, unknown>, value: unknown): T {
  const r = rule.safeParse(value);
  if (!r.success) throw new Error(r.error.issues[0].message);
  return r.data;
}

async function main() {
  const clientId = check(clientIdRule, argValue('--client') ?? (await ask('Client ID (e.g. ACME): ')));
  const companyName = check(companyNameRule, argValue('--name') ?? (await ask('Company name: ')));
  const username = argValue('--username') ?? ((await ask('Administrator username [admin]: ')) || 'admin');
  if (!/^[A-Za-z0-9._-]{3,50}$/.test(username)) {
    throw new Error('Username must be 3-50 characters: letters, numbers, dot, dash or underscore.');
  }
  const email = argValue('--email') ?? null;
  const password = check(passwordRule, await askNewPassword());

  console.log(`\nCreating client ${clientId}...`);
  const { log } = await createClient({ clientId, companyName, admin: { username, email, password }, mustChangePassword: true });
  for (const line of log) console.log(`  - ${line}`);
  console.log(`\nDone. Sign in with Client ID "${clientId}" and user "${username}".`);
}

main()
  .catch((err: Error) => {
    console.error('Error:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    closePrompt();
    await closePool();
  });
