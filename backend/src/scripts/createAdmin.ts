/**
 * Creates the initial administrator account (controlled bootstrap; there is no public sign-up).
 *
 *   npm run create-admin                      -> prompts for username and password
 *   npm run create-admin -- --username admin  -> prompts for password only
 *   npm run create-admin -- --reset           -> reset the password of an existing admin
 *   add --client ACME                         -> for that client company (needed when there are several)
 *
 * For unattended setup the password may be supplied via the ADMIN_PASSWORD environment
 * variable for that single command; do not store it in .env or source control.
 * The admin must change the password at first login.
 */
import { closePool, query, runInDatabase, sql } from '../database/pool.js';
import { logSecurityEvent } from '../services/audit.service.js';
import { hashPassword } from '../services/auth.service.js';
import { listClients, normalizeClientId } from '../services/clients.service.js';
import { passwordRule } from '../validators/common.js';
import { argValue, ask, askNewPassword, closePrompt } from './prompt.js';

/** Client ID of the chosen client. */
let clientId: string | null = null;

/** Schema of the client given with --client (or of the only client). New companies: use add-client. */
async function clientSchema(): Promise<string> {
  const wanted = argValue('--client');
  const clients = await listClients();
  if (clients.length === 0) throw new Error('No company exists yet. Run the setup wizard, or create one with npm run add-client.');
  if (wanted) {
    const client = clients.find((c) => c.clientId === normalizeClientId(wanted));
    if (!client) throw new Error(`Client ID "${wanted}" does not exist.`);
    clientId = client.clientId;
    return client.schemaName;
  }
  if (clients.length > 1) {
    throw new Error(`There are several clients; choose one with --client (${clients.map((c) => c.clientId).join(', ')}).`);
  }
  clientId = clients[0].clientId;
  return clients[0].schemaName;
}

async function main() {
  const reset = process.argv.includes('--reset');
  const username = argValue('--username') ?? (await ask('Admin username: '));
  if (!/^[A-Za-z0-9._-]{3,50}$/.test(username)) {
    throw new Error('Username must be 3-50 characters: letters, numbers, dot, dash or underscore.');
  }

  const existing = await query(`SELECT UserId, Role FROM dbo.Users WHERE Username = @u`, {
    u: [sql.NVarChar(50), username],
  });
  const user = existing.recordset[0];
  if (user && !reset) throw new Error(`User "${username}" already exists. Use --reset to reset its password.`);
  if (!user && reset) throw new Error(`User "${username}" does not exist.`);
  if (user && user.Role !== 'Admin') throw new Error(`User "${username}" is not an administrator.`);

  const password = await askNewPassword();
  const check = passwordRule.safeParse(password);
  if (!check.success) throw new Error(check.error.issues[0].message);

  const hash = await hashPassword(password);
  if (user) {
    await query(
      `UPDATE dbo.Users SET PasswordHash = @hash, MustChangePassword = true, IsActive = true, UpdatedAt = now()
       WHERE UserId = @id;
       UPDATE dbo.Sessions SET RevokedAt = now() WHERE UserId = @id AND RevokedAt IS NULL;`,
      { hash: [sql.NVarChar(255), hash], id: [sql.Int, user.UserId] },
    );
    await logSecurityEvent('PASSWORD_RESET', { userId: user.UserId, username, details: 'Reset via create-admin script' });
    console.log(`Password reset for administrator "${username}". It must be changed at next login.`);
  } else {
    const r = await query(
      `INSERT INTO dbo.Users (ClientId, Username, PasswordHash, Role, MustChangePassword, IsActive)
       VALUES (@clientId, @u, @hash, 'Admin', true, true)
       RETURNING UserId`,
      { clientId: [sql.NVarChar(30), clientId], u: [sql.NVarChar(50), username], hash: [sql.NVarChar(255), hash] },
    );
    await logSecurityEvent('ADMIN_BOOTSTRAP', { userId: r.recordset[0].UserId, username, details: 'Created via create-admin script' });
    console.log(`Administrator "${username}" created. The password must be changed at first login.`);
  }
}

clientSchema()
  .then((schema) => runInDatabase(schema, main))
  .catch((err: Error) => {
    console.error('Error:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    closePrompt();
    await closePool();
  });
