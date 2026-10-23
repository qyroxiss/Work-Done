import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config, ENV_EXAMPLE_PATH, ENV_PATH, isConfigured, reloadConfig } from '../../config/env.js';
import { ensureClientSchema, ensureMainSchema } from '../../database/migrate.js';
import { closePool, poolConfig, query, runInDatabase, runInMainDatabase, sql } from '../../database/pool.js';
import { badRequest, conflict, HttpError } from '../../utils/httpError.js';
import { logSecurityEvent } from '../audit.service.js';
import { hashPassword } from '../auth.service.js';
import { findClient, normalizeClientId, registerClient, schemaNameFor } from '../clients.service.js';
import { run } from './processUtil.js';

/**
 * First-run setup:
 *   database -> the app has no DATABASE_URL yet (or cannot sign in with it)
 *   admin    -> connected, but no company exists yet: create the first company and its administrator
 *   done
 * Tables are created by the app itself (backend/database/main.sql and client.sql), so no database
 * administrator steps are needed.
 */
export type SetupStep = 'database' | 'admin' | 'done';

let completed = false;

/** Readable explanation of a PostgreSQL connection failure (never includes the password). */
export function friendlyConnectionError(err: unknown): string {
  const e = err as { code?: string; message?: string };
  switch (e.code) {
    case 'ECONNREFUSED':
      return 'Nothing is accepting connections at that address. Check that PostgreSQL is running and the host and port are right.';
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return 'The server name could not be found. Check the host name in the connection string.';
    case 'ETIMEDOUT':
      return 'The server did not answer in time. Check the host, port and firewall.';
    case '28P01':
    case '28000':
      return 'PostgreSQL refused the user name or password.';
    case '3D000':
      return 'That database does not exist on the server. Create it first, or use an existing one.';
    case '42501':
      return 'The database user is not allowed to create tables in this database. Use the database owner.';
    default:
      if (/SSL|certificate/i.test(e.message ?? '')) return `Secure connection failed: ${e.message}`;
      return e.message ?? 'Unknown error';
  }
}

/** Determines which setup step is pending. Once everything is set up the result is cached. */
export async function getSetupStep(): Promise<{ step: SetupStep; dbError?: string }> {
  if (completed) return { step: 'done' };
  if (!isConfigured()) return { step: 'database' };
  try {
    await ensureMainSchema();
    const r = await runInMainDatabase(() => query(`SELECT COUNT(*) AS Clients FROM public.Clients`));
    if (Number(r.recordset[0].Clients) === 0) return { step: 'admin' };
    completed = true;
    return { step: 'done' };
  } catch (err) {
    const code = (err as { code?: string }).code ?? '';
    // Wrong password / missing database: let the wizard run again to repair the configuration
    if (['28P01', '28000', '3D000', '42501'].includes(code)) return { step: 'database', dbError: friendlyConnectionError(err) };
    // Unreachable (e.g. PostgreSQL stopped): not a setup problem
    return { step: 'done', dbError: friendlyConnectionError(err) };
  }
}

export async function assertStep(expected: SetupStep) {
  const { step } = await getSetupStep();
  if (step !== expected) {
    throw new HttpError(403, step === 'done' ? 'Setup has already been completed.' : 'This setup step is not available now.', 'SETUP_STEP');
  }
}

export function getEnvironmentInfo() {
  return {
    platform: process.platform,
    computerName: os.hostname(),
    lanAddresses: Object.values(os.networkInterfaces())
      .flat()
      .filter((i) => i && i.family === 'IPv4' && !i.internal)
      .map((i) => i!.address),
    port: config.port,
  };
}

const URL_RE = /^postgres(ql)?:\/\/[^\s]+$/i;

function checkUrl(url: string) {
  if (!URL_RE.test(url)) throw badRequest('Enter a PostgreSQL connection string starting with postgres:// or postgresql://');
  try {
    new URL(url);
  } catch {
    throw badRequest('The connection string is not a valid address. Special characters in the password must be URL-encoded.');
  }
}

/** Signs in with the connection string and reports what the app will be able to do there. */
export async function testConnection(url: string) {
  checkUrl(url);
  const client = new pg.Client({ ...poolConfig({ url, poolSize: 1 }), connectionTimeoutMillis: 10_000 });
  try {
    await client.connect();
    const r = await client.query(
      `SELECT current_setting('server_version') AS version, current_database() AS database, current_user AS "user",
              has_database_privilege(current_database(), 'CREATE') AS can_create`,
    );
    const row = r.rows[0];
    return {
      ok: true as const,
      version: `PostgreSQL ${row.version}`,
      database: row.database as string,
      user: row.user as string,
      canCreate: Boolean(row.can_create),
    };
  } catch (err) {
    return { ok: false as const, error: friendlyConnectionError(err) };
  } finally {
    await client.end().catch(() => undefined);
  }
}

/** Updates (or adds) keys in backend/.env, keeping every other line and comment. */
function writeEnv(values: Record<string, string>) {
  let text = fs.existsSync(ENV_PATH)
    ? fs.readFileSync(ENV_PATH, 'utf8')
    : fs.existsSync(ENV_EXAMPLE_PATH)
      ? fs.readFileSync(ENV_EXAMPLE_PATH, 'utf8')
      : '';
  for (const [key, value] of Object.entries(values)) {
    if (value.includes("'") || /[\r\n]/.test(value)) throw badRequest(`Invalid value for ${key}.`);
    // Single quotes: dotenv takes the value literally
    const line = value === '' ? `${key}=` : `${key}='${value}'`;
    const re = new RegExp(`^${key}=.*$`, 'm');
    text = re.test(text) ? text.replace(re, () => line) : `${text.replace(/\s*$/, '')}\n${line}\n`;
  }
  fs.writeFileSync(ENV_PATH, text, { encoding: 'utf8', mode: 0o600 });
}

/** Saves the connection string and creates the shared tables. */
export async function connectDatabase(url: string) {
  const test = await testConnection(url);
  if (!test.ok) throw badRequest(test.error);
  if (!test.canCreate) throw badRequest(friendlyConnectionError({ code: '42501' }));

  const previousEnv = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : null;
  writeEnv({ DATABASE_URL: url });
  await closePool();
  reloadConfig();
  try {
    await ensureMainSchema();
  } catch (err) {
    // Put the previous configuration back so the wizard can be run again
    await closePool();
    if (previousEnv === null) fs.rmSync(ENV_PATH, { force: true });
    else fs.writeFileSync(ENV_PATH, previousEnv, 'utf8');
    reloadConfig();
    throw badRequest(`Connected, but the tables could not be created: ${friendlyConnectionError(err)}`);
  }
  return { log: [`Connected to ${test.database} (${test.version})`, 'Configuration saved to backend/.env', 'Shared tables created'] };
}

export interface NewClientInput {
  clientId: string;
  companyName: string;
  admin: { username: string; email: string | null; password: string };
  /** The first company's administrator chose the password in the wizard; others must change it at first sign-in */
  mustChangePassword: boolean;
  loadSampleData?: boolean;
}

/**
 * Adds a client company: creates its schema (wd_<clientid>) with the WorkDone tables, its first
 * administrator, and registers the Client ID (last, so it can only sign in once everything worked).
 */
export async function createClient(input: NewClientInput, ip?: string) {
  const clientId = normalizeClientId(input.clientId);
  if (await findClient(clientId)) throw conflict(`Client ID "${clientId}" is already in use.`);
  const schema = schemaNameFor(clientId);
  const log: string[] = [];

  await ensureClientSchema(schema, { seed: input.loadSampleData });
  log.push(`Tables created (schema ${schema})`);
  if (input.loadSampleData) log.push('Sample employees and products added');

  await runInDatabase(schema, async () => {
    // Left over from an earlier attempt that did not finish: reuse it only while it has no users
    const existing = await query(`SELECT COUNT(*) AS Users FROM dbo.Users`);
    if (Number(existing.recordset[0].Users) > 0) {
      throw conflict(`Schema ${schema} already exists and contains users. Choose another Client ID.`);
    }
    const r = await query(
      `INSERT INTO dbo.Users (ClientId, Username, Email, PasswordHash, Role, MustChangePassword, IsActive)
       VALUES (@clientId, @u, @email, @hash, 'Admin', @mustChange, true)
       RETURNING UserId`,
      {
        clientId: [sql.NVarChar(30), clientId],
        u: [sql.NVarChar(50), input.admin.username],
        email: [sql.NVarChar(150), input.admin.email],
        hash: [sql.NVarChar(255), await hashPassword(input.admin.password)],
        mustChange: [sql.Bit, input.mustChangePassword],
      },
    );
    await logSecurityEvent('ADMIN_BOOTSTRAP', {
      userId: r.recordset[0].UserId,
      username: input.admin.username,
      ip,
      details: `Created with client ${clientId}`,
    });
  });
  log.push(`Administrator "${input.admin.username}" created${input.mustChangePassword ? ' (must change the password at first sign-in)' : ''}`);

  const client = await registerClient({ clientId, companyName: input.companyName, schemaName: schema });
  log.push(`Client ID ${clientId} registered`);
  return { client, log };
}

/** Setup wizard: the first company and its administrator. */
export async function createFirstCompany(input: Omit<NewClientInput, 'mustChangePassword'>, ip?: string) {
  const result = await createClient({ ...input, mustChangePassword: false }, ip);
  completed = true;
  return result;
}

// ---------------------------------------------------------------------------
// Windows options for an office server: they run scripts/server-tools.ps1 elevated, which shows a
// Windows UAC prompt on the server's own screen.
// ---------------------------------------------------------------------------

export type SystemAction = 'firewall' | 'autostart';

const here = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(here, '../../../..');
const TOOLS_SCRIPT = path.join(PROJECT_ROOT, 'scripts', 'server-tools.ps1');
const SERVER_SCRIPT = path.resolve(here, '../../../dist/server.js');

/** Quotes a value for Start-Process -ArgumentList inside a single-quoted PowerShell string. */
function psArg(value: string): string {
  if (/["\r\n]/.test(value)) throw badRequest('Invalid argument.');
  return `'"${value.replace(/'/g, "''")}"'`;
}

export async function runSystemAction(action: SystemAction) {
  if (process.platform !== 'win32') throw badRequest('This action is only available on Windows.');
  if (!fs.existsSync(TOOLS_SCRIPT)) throw badRequest('scripts/server-tools.ps1 is missing.');

  const args: string[] = [];
  if (action === 'firewall') {
    args.push('-Action', 'Firewall', '-Port', String(config.port));
  } else {
    if (!fs.existsSync(SERVER_SCRIPT)) throw badRequest('Build the backend first (npm run build) to enable auto-start.');
    args.push('-Action', 'Autostart', '-NodePath', process.execPath, '-ServerScript', SERVER_SCRIPT, '-WorkDir', path.dirname(path.dirname(SERVER_SCRIPT)));
  }

  const resultFile = path.join(os.tmpdir(), `workdone-action-${crypto.randomBytes(8).toString('hex')}.txt`);
  args.push('-ResultFile', resultFile);

  const argList = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', TOOLS_SCRIPT, ...args].map(psArg).join(',');
  const command = `try { $p = Start-Process -FilePath powershell.exe -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList @(${argList}); exit $p.ExitCode } catch { Write-Error $_.Exception.Message; exit 99 }`;

  const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], 5 * 60_000);
  const message = fs.existsSync(resultFile) ? fs.readFileSync(resultFile, 'utf8').trim() : '';
  fs.rmSync(resultFile, { force: true });

  if (r.code === 99) throw badRequest('Administrator permission was not granted (the Windows prompt was cancelled).');
  if (r.code !== 0) throw badRequest(message || `The action failed (exit code ${r.code}).`);
  return { message: message || 'Done' };
}
