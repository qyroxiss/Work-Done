import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, ENV_EXAMPLE_PATH, ENV_PATH, isConfigured, reloadConfig } from '../../config/env.js';
import { closePool, query, requireDbConfig, runInDatabase, sql } from '../../database/pool.js';
import { readSqlFile } from '../../database/sqlFiles.js';
import { badRequest, conflict, HttpError } from '../../utils/httpError.js';
import { logSecurityEvent } from '../audit.service.js';
import { hashPassword } from '../auth.service.js';
import { databaseNameFor, findClient, listClients, normalizeClientId, registerClient } from '../clients.service.js';
import {
  createExecutor,
  friendlyConnectionError,
  probeTcp,
  sqlcmdAvailable,
  type ConnectionInput,
} from './executor.js';
import { run } from './processUtil.js';
import { detectLocalInstances, sqlBrowserRunning, type SqlInstance } from './sqlInstances.js';

export type SetupStep = 'database' | 'upgrade' | 'admin' | 'company' | 'done';

/** Fixed name of the least-privilege login the app uses at runtime. */
const APP_LOGIN = 'workdone_app';

let completed = false;

/** Determines which setup step is pending. Once everything is set up the result is cached. */
export async function getSetupStep(): Promise<{ step: SetupStep; dbError?: string }> {
  if (completed) return { step: 'done' };
  if (!isConfigured()) return { step: 'database' };
  try {
    const t = await query(`SELECT OBJECT_ID(N'dbo.Users', N'U') AS UsersTable`);
    if (t.recordset[0].UsersTable === null) return { step: 'database' };
    // Database created by an older version of WorkDone: needs the latest schema scripts
    const v = await query(
      `SELECT OBJECT_ID(N'dbo.Clients', N'U') AS ClientsTable, COL_LENGTH(N'dbo.Users', N'Email') AS EmailColumn,
              COL_LENGTH(N'dbo.Users', N'ClientId') AS ClientIdColumn, OBJECT_ID(N'dbo.ChatAttachments', N'U') AS ChatTable,
              OBJECT_ID(N'dbo.Notifications', N'U') AS NotificationsTable, COL_LENGTH(N'dbo.WorkItems', N'RecurringId') AS RecurringColumn,
              OBJECT_ID(N'dbo.WorkAttachments', N'U') AS WorkFilesTable`,
    );
    const ver = v.recordset[0];
    const required = [ver.ClientsTable, ver.EmailColumn, ver.ClientIdColumn, ver.ChatTable, ver.NotificationsTable, ver.RecurringColumn, ver.WorkFilesTable];
    if (required.includes(null)) return { step: 'upgrade' };
    const a = await query(`SELECT COUNT(*) AS Admins FROM dbo.Users WHERE Role = N'Admin' AND IsActive = 1`);
    if (Number(a.recordset[0].Admins) === 0) return { step: 'admin' };
    // The main database is the first client's database
    const main = config.db!.database.toLowerCase();
    if (!(await listClients()).some((c) => c.databaseName.toLowerCase() === main)) return { step: 'company' };
    completed = true;
    return { step: 'done' };
  } catch (err) {
    // Wrong/removed app login: let the wizard run again to repair the configuration
    if ((err as { code?: string }).code === 'ELOGIN') return { step: 'database', dbError: friendlyConnectionError(err) };
    // Unreachable (e.g. SQL Server stopped): not a setup problem
    return { step: 'done', dbError: friendlyConnectionError(err) };
  }
}

export async function assertStep(expected: SetupStep) {
  const { step } = await getSetupStep();
  if (step !== expected) {
    throw new HttpError(403, step === 'done' ? 'Setup has already been completed.' : 'This setup step is not available now.', 'SETUP_STEP');
  }
}

/** SQL Server 2019 (v15) and newer are the supported targets. */
const MIN_SUPPORTED_MAJOR = 15;

export interface AutoPlan {
  instanceName: string;
  server: string;
  version: string;
  supported: boolean;
  /** Changes needed before WorkDone can use the instance (need one administrator prompt). */
  fixes: ('start' | 'tcp' | 'mixed')[];
}

/**
 * Picks the SQL Server instance to use automatically: supported versions first, then the one
 * needing the fewest changes, then the default instance (no SQL Browser needed), then the newest.
 */
export function chooseInstance(instances: SqlInstance[]): AutoPlan | null {
  // Optional override, e.g. SETUP_SQL_INSTANCE=SQL2022 (or MSSQLSERVER for the default instance)
  const forced = process.env.SETUP_SQL_INSTANCE?.trim().toUpperCase();
  const candidates = forced ? instances.filter((i) => i.name.toUpperCase() === forced) : instances;
  const ranked = candidates
    .map((i) => {
      const fixes: AutoPlan['fixes'] = [];
      if (!i.running) fixes.push('start');
      if (!i.tcpEnabled) fixes.push('tcp');
      if (!i.mixedMode) fixes.push('mixed');
      const supported = i.major >= MIN_SUPPORTED_MAJOR;
      const score =
        (supported ? 10_000 : 0) + (3 - fixes.length) * 1_000 + (i.name.toUpperCase() === 'MSSQLSERVER' ? 500 : 0) + i.major;
      return { i, fixes, supported, score };
    })
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (!best) return null;
  return { instanceName: best.i.name, server: best.i.server, version: best.i.version, supported: best.supported, fixes: best.fixes };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Fully automatic database setup on this computer's SQL Server, signing in with the
 * Windows account that runs WorkDone. Falls back to the manual wizard on failure.
 */
export async function autoSetup() {
  const log: string[] = [];
  const instances = await detectLocalInstances();
  const plan = chooseInstance(instances);
  if (!plan) {
    throw badRequest('No SQL Server was found on this computer. Install SQL Server (Express is free) and start Q-WorkDone again, or use manual setup to connect to another server.');
  }
  if (!(await sqlcmdAvailable())) {
    throw badRequest('Automatic setup needs the sqlcmd tool, which was not found. Use manual setup and sign in with an SQL login such as sa.');
  }
  log.push(`Using ${plan.server} (${plan.version})`);

  if (plan.fixes.length) {
    const r = await runSystemAction('prepare', plan.instanceName);
    log.push(r.message);
  }

  const conn: ConnectionInput = {
    server: plan.server,
    port: null,
    authType: 'windows',
    encrypt: true,
    trustServerCertificate: true,
  };

  // After a (re)start SQL Server needs a few seconds before it accepts connections
  let tcpError: string | null = null;
  for (let attempt = 0; attempt < 20; attempt++) {
    tcpError = await probeTcp(conn);
    if (!tcpError) break;
    await sleep(3000);
  }
  if (tcpError) throw badRequest(tcpError);

  const test = await testConnection(conn, 'WorkDoneDB');
  if (!test.ok) throw badRequest(test.error);
  if (!test.isSysadmin) {
    throw badRequest(`Your Windows account is not an administrator of ${plan.server}. Use manual setup and sign in with an SQL login such as sa.`);
  }
  if (!test.mixedMode) throw badRequest('SQL logins are still disabled on this SQL Server. Use manual setup.');

  const result = await install(conn, 'WorkDoneDB', false);
  log.push(...result.log);
  return { server: plan.server, log };
}

export async function getEnvironmentInfo() {
  const [instances, sqlcmd, browser] = await Promise.all([detectLocalInstances(), sqlcmdAvailable(), sqlBrowserRunning()]);
  return {
    autoPlan: chooseInstance(instances),
    platform: process.platform,
    computerName: os.hostname(),
    lanAddresses: Object.values(os.networkInterfaces())
      .flat()
      .filter((i) => i && i.family === 'IPv4' && !i.internal)
      .map((i) => i!.address),
    port: config.port,
    instances,
    sqlBrowserRunning: browser,
    sqlcmdAvailable: sqlcmd,
  };
}

const SERVER_RE = /^[A-Za-z0-9._-]+(\\[A-Za-z0-9_$]+)?$/;
const DB_NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,99}$/;

function validateConnection(input: ConnectionInput) {
  if (!SERVER_RE.test(input.server)) throw badRequest('Invalid server name. Use e.g. localhost or localhost\\SQL2022.');
  if (input.authType === 'sql' && !input.user) throw badRequest('Enter the SQL login (e.g. sa).');
}

export async function testConnection(input: ConnectionInput, database: string) {
  validateConnection(input);
  if (!DB_NAME_RE.test(database)) throw badRequest('Database name may contain letters, numbers and underscore only.');

  const tcpError = await probeTcp(input);
  if (tcpError) return { ok: false as const, error: tcpError };

  const exec = createExecutor(input);
  try {
    const info = await exec.scalar(
      `SELECT CAST(SERVERPROPERTY('ProductVersion') AS NVARCHAR(50)) + N'|' +
              CAST(ISNULL(IS_SRVROLEMEMBER('sysadmin'), 0) AS NVARCHAR(5)) + N'|' +
              CAST(SERVERPROPERTY('IsIntegratedSecurityOnly') AS NVARCHAR(5)) + N'|' +
              ISNULL(CAST(DB_ID(N'${database}') AS NVARCHAR(10)), N'')`,
    );
    const [version, sysadmin, integratedOnly, dbId] = (info ?? '').split('|');
    return {
      ok: true as const,
      version,
      isSysadmin: sysadmin === '1',
      mixedMode: integratedOnly === '0',
      databaseExists: Boolean(dbId),
    };
  } catch (err) {
    return { ok: false as const, error: friendlyConnectionError(err) };
  } finally {
    await exec.close();
  }
}

/** Strong random password meeting SQL Server's complexity policy. */
function generatePassword(): string {
  // No '#', quotes or '$': keeps the value safe in .env files and SQL literals
  return `Wd${crypto.randomBytes(18).toString('base64url').replace(/[-_]/g, 'x')}9aZ!`;
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
    // Single quotes: dotenv takes the value literally (backslashes, '#', '!' are kept)
    const line = value === '' ? `${key}=` : `${key}='${value}'`;
    const re = new RegExp(`^${key}=.*$`, 'm');
    text = re.test(text) ? text.replace(re, () => line) : `${text.replace(/\s*$/, '')}\n${line}\n`;
  }
  fs.writeFileSync(ENV_PATH, text, { encoding: 'utf8', mode: 0o600 });
}

/** Gives the app login read/write access (no DDL) to the database the script runs in. */
function grantAppAccessScript(): string {
  return `IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'${APP_LOGIN}')
         CREATE USER [${APP_LOGIN}] FOR LOGIN [${APP_LOGIN}];
       ELSE
         ALTER USER [${APP_LOGIN}] WITH LOGIN = [${APP_LOGIN}];
       ALTER ROLE db_datareader ADD MEMBER [${APP_LOGIN}];
       ALTER ROLE db_datawriter ADD MEMBER [${APP_LOGIN}];`;
}

export async function install(input: ConnectionInput, database: string, loadSampleData: boolean) {
  validateConnection(input);
  if (!DB_NAME_RE.test(database)) throw badRequest('Database name may contain letters, numbers and underscore only.');

  const log: string[] = [];
  const appPassword = generatePassword();
  const exec = createExecutor(input);
  try {
    await exec.script(`IF DB_ID(N'${database}') IS NULL CREATE DATABASE [${database}];`);
    log.push(`Database ${database} ready`);

    await exec.script(
      `IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'${APP_LOGIN}')
         CREATE LOGIN [${APP_LOGIN}] WITH PASSWORD = N'${appPassword}', CHECK_POLICY = ON, DEFAULT_DATABASE = [${database}];
       ELSE
         ALTER LOGIN [${APP_LOGIN}] WITH PASSWORD = N'${appPassword}', DEFAULT_DATABASE = [${database}];
       ALTER LOGIN [${APP_LOGIN}] ENABLE;`,
    );
    await exec.script(grantAppAccessScript(), database);
    log.push(`Application login "${APP_LOGIN}" created with read/write access only`);

    await exec.script(readSqlFile('schema.sql'), database);
    log.push('Tables created');
    await exec.script(readSqlFile('indexes.sql'), database);
    await exec.script(readSqlFile('clients.sql'), database);
    log.push('Indexes created');
    if (loadSampleData) {
      await exec.script(readSqlFile('seed.sql'), database);
      log.push('Sample employees and products added');
    }
  } catch (err) {
    throw badRequest(`Setup failed: ${friendlyConnectionError(err)}`);
  } finally {
    await exec.close();
  }

  const previousEnv = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : null;
  writeEnv({
    DB_SERVER: input.server,
    DB_PORT: input.port ? String(input.port) : '',
    DB_DATABASE: database,
    DB_USER: APP_LOGIN,
    DB_PASSWORD: appPassword,
    DB_ENCRYPT: String(input.encrypt),
    DB_TRUST_SERVER_CERTIFICATE: String(input.trustServerCertificate),
  });
  log.push('Configuration saved to backend/.env');

  // Switch the running server to the new configuration and verify the app login works
  await closePool();
  reloadConfig();
  try {
    await query('SELECT TOP 1 UserId FROM dbo.Users');
  } catch (err) {
    // Roll back to the previous configuration so the wizard can be run again
    await closePool();
    if (previousEnv === null) fs.rmSync(ENV_PATH, { force: true });
    else fs.writeFileSync(ENV_PATH, previousEnv, 'utf8');
    reloadConfig();
    throw badRequest(`The database was created, but the app could not connect with the new login: ${friendlyConnectionError(err)}`);
  }
  log.push('Application connected successfully');
  return { log };
}

export async function createFirstAdmin(
  admin: { username: string; email: string | null; password: string },
  company: { companyName: string; clientId: string },
  ip?: string,
) {
  const existing = await query(`SELECT 1 AS X FROM dbo.Users WHERE Username = @u`, { u: [sql.NVarChar(50), admin.username] });
  if (existing.recordset.length) throw conflict(`User "${admin.username}" already exists.`);
  if (await findClient(company.clientId)) throw conflict(`Client ID "${normalizeClientId(company.clientId)}" is already in use.`);
  const r = await query(
    `INSERT INTO dbo.Users (ClientId, Username, Email, PasswordHash, Role, MustChangePassword, IsActive)
     OUTPUT INSERTED.UserId VALUES (@clientId, @u, @email, @hash, N'Admin', 0, 1)`,
    {
      clientId: [sql.NVarChar(30), normalizeClientId(company.clientId)],
      u: [sql.NVarChar(50), admin.username],
      email: [sql.NVarChar(150), admin.email],
      hash: [sql.NVarChar(255), await hashPassword(admin.password)],
    },
  );
  // The main database becomes the first client's database
  await registerClient({ ...company, databaseName: config.db!.database });
  await logSecurityEvent('ADMIN_BOOTSTRAP', {
    userId: r.recordset[0].UserId,
    username: admin.username,
    ip,
    details: `Created via setup wizard (Client ID ${company.clientId})`,
  });
  completed = true;
}

/** For databases upgraded from an older version: register the main database as the first client. */
export async function setCompany(company: { companyName: string; clientId: string }, ip?: string) {
  await registerClient({ ...company, databaseName: config.db!.database });
  await logSecurityEvent('SETTINGS_UPDATED', { ip, details: `Client ID set to ${company.clientId} via setup` });
  completed = true;
}

/**
 * Administrator connection to the configured SQL Server, for schema changes the app login is not
 * allowed to make: the Windows account running WorkDone (via sqlcmd) or a given SQL login.
 */
async function adminConnection(adminLogin?: { user: string; password: string }): Promise<ConnectionInput> {
  const db = config.db;
  if (!db) throw badRequest('Q-WorkDone is not configured.');
  if (!adminLogin && !(await sqlcmdAvailable())) {
    throw badRequest('sqlcmd was not found. Sign in with an SQL Server administrator login (e.g. sa).');
  }
  return {
    server: db.instanceName ? `${db.server}\\${db.instanceName}` : db.server,
    port: db.port ?? null,
    authType: adminLogin ? 'sql' : 'windows',
    user: adminLogin?.user,
    password: adminLogin?.password,
    encrypt: db.encrypt,
    trustServerCertificate: db.trustServerCertificate,
  };
}

export interface NewClientInput {
  clientId: string;
  companyName: string;
  admin: { username: string; email: string | null; password: string };
  /** SQL Server administrator login; when omitted the Windows account running WorkDone is used */
  adminLogin?: { user: string; password: string };
}

/**
 * Adds a client company: creates its own database (WorkDone_<CLIENTID>) with the WorkDone tables,
 * gives the app login read/write access, creates its first administrator and registers the
 * Client ID. The administrator must change the password at first login.
 */
export async function createClient(input: NewClientInput, ip?: string) {
  const clientId = normalizeClientId(input.clientId);
  if (await findClient(clientId)) throw conflict(`Client ID "${clientId}" is already in use.`);
  const database = databaseNameFor(clientId);
  if (!DB_NAME_RE.test(database)) throw badRequest('This Client ID cannot be used as a database name.');

  const log: string[] = [];
  const exec = createExecutor(await adminConnection(input.adminLogin));
  try {
    if ((await exec.scalar(`SELECT DB_ID(N'${database}')`)) !== null) {
      // Left over from an earlier attempt that did not finish: reuse it only while it has no users
      const users = await exec.scalar(
        `IF OBJECT_ID(N'dbo.Users', N'U') IS NULL SELECT 0 ELSE EXEC(N'SELECT COUNT(*) FROM dbo.Users')`,
        database,
      );
      if (Number(users) > 0) {
        throw conflict(`Database ${database} already exists on the server and contains data. Choose another Client ID.`);
      }
    } else {
      await exec.script(`CREATE DATABASE [${database}];`);
    }
    log.push(`Database ${database} ready`);
    await exec.script(grantAppAccessScript(), database);
    await exec.script(readSqlFile('schema.sql'), database);
    await exec.script(readSqlFile('indexes.sql'), database);
    log.push('Tables and indexes created');
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw badRequest(`Creating the client database failed: ${friendlyConnectionError(err)}`);
  } finally {
    await exec.close();
  }

  await runInDatabase(database, async () => {
    const r = await query(
      `INSERT INTO dbo.Users (ClientId, Username, Email, PasswordHash, Role, MustChangePassword, IsActive)
       OUTPUT INSERTED.UserId VALUES (@clientId, @u, @email, @hash, N'Admin', 1, 1)`,
      {
        clientId: [sql.NVarChar(30), clientId],
        u: [sql.NVarChar(50), input.admin.username],
        email: [sql.NVarChar(150), input.admin.email],
        hash: [sql.NVarChar(255), await hashPassword(input.admin.password)],
      },
    );
    await logSecurityEvent('ADMIN_BOOTSTRAP', {
      userId: r.recordset[0].UserId,
      username: input.admin.username,
      ip,
      details: `Created with new client ${clientId}`,
    });
  });
  log.push(`Administrator "${input.admin.username}" created (must change the password at first login)`);

  // Registered last, so the client can only sign in once everything above has worked
  const client = await registerClient({ clientId, companyName: input.companyName, databaseName: database });
  log.push(`Client ID ${clientId} registered`);
  return { client, log };
}

/**
 * Applies the latest schema.sql / indexes.sql to the configured database. The app login
 * cannot change the schema, so this signs in with the Windows account (or a given SQL admin login).
 */
export async function upgradeDatabase(adminLogin?: { user: string; password: string }) {
  const main = requireDbConfig().database;
  const exec = createExecutor(await adminConnection(adminLogin));
  const log: string[] = [];
  try {
    await exec.script(readSqlFile('schema.sql'), main);
    await exec.script(readSqlFile('indexes.sql'), main);
    await exec.script(readSqlFile('clients.sql'), main);
    log.push(`${main} upgraded to the latest version`);
    // Every other client database gets the same tables
    for (const client of await listClients()) {
      if (client.databaseName.toLowerCase() === main.toLowerCase()) continue;
      await exec.script(readSqlFile('schema.sql'), client.databaseName);
      await exec.script(readSqlFile('indexes.sql'), client.databaseName);
      log.push(`${client.databaseName} (${client.clientId}) upgraded`);
    }
  } catch (err) {
    throw badRequest(`Database upgrade failed: ${friendlyConnectionError(err)}`);
  } finally {
    await exec.close();
  }
  return { log };
}

// ---------------------------------------------------------------------------
// Windows system actions that need administrator rights. They run scripts/sql-tools.ps1
// elevated, which shows a Windows UAC prompt on the server's own screen.
// ---------------------------------------------------------------------------

export type SystemAction = 'enable-tcp' | 'start-service' | 'enable-mixed-mode' | 'firewall' | 'autostart' | 'prepare';

const here = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(here, '../../../..');
const TOOLS_SCRIPT = path.join(PROJECT_ROOT, 'scripts', 'sql-tools.ps1');
const SERVER_SCRIPT = path.resolve(here, '../../../dist/server.js');

/** Quotes a value for Start-Process -ArgumentList inside a single-quoted PowerShell string. */
function psArg(value: string): string {
  if (/["\r\n]/.test(value)) throw badRequest('Invalid argument.');
  return `'"${value.replace(/'/g, "''")}"'`;
}

export async function runSystemAction(action: SystemAction, instanceName?: string) {
  if (process.platform !== 'win32') throw badRequest('This action is only available on Windows.');
  if (!fs.existsSync(TOOLS_SCRIPT)) throw badRequest('scripts/sql-tools.ps1 is missing.');

  const args: string[] = [];
  if (action === 'enable-tcp' || action === 'start-service' || action === 'enable-mixed-mode' || action === 'prepare') {
    const instance = (await detectLocalInstances()).find((i) => i.name === instanceName);
    if (!instance) throw badRequest('SQL Server instance not found on this computer.');
    const ps = { 'enable-tcp': 'EnableTcp', 'start-service': 'StartService', 'enable-mixed-mode': 'EnableMixedMode', prepare: 'Prepare' }[action];
    args.push('-Action', ps, '-InstanceId', instance.id, '-ServiceName', instance.serviceName);
    if (instance.name.toUpperCase() !== 'MSSQLSERVER') args.push('-NamedInstance');
    if (action === 'prepare') {
      if (!instance.tcpEnabled) args.push('-FixTcp');
      if (!instance.mixedMode) args.push('-FixMixed');
    }
  } else if (action === 'firewall') {
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
