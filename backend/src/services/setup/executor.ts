import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sql from 'mssql';
import type { DbConfig } from '../../config/env.js';
import { buildConfig } from '../../database/pool.js';
import { splitBatches } from '../../database/sqlFiles.js';
import { run } from './processUtil.js';

export interface ConnectionInput {
  /** e.g. "localhost", "localhost\SQL2022", "192.168.1.10" */
  server: string;
  port: number | null;
  authType: 'windows' | 'sql';
  user?: string;
  password?: string;
  encrypt: boolean;
  trustServerCertificate: boolean;
}

/** Runs setup SQL with administrator rights on the target server. */
export interface SetupExecutor {
  /** Returns the first column of the first row as text (or null). */
  scalar(text: string, database?: string): Promise<string | null>;
  /** Runs a script that may contain GO batch separators. */
  script(text: string, database?: string): Promise<void>;
  close(): Promise<void>;
}

/** Driver-level config (as the app will use it) for a given login. */
export function toDbConfig(input: ConnectionInput, user: string, password: string, database: string): DbConfig {
  const [host, instance] = input.server.split('\\');
  return {
    server: host,
    instanceName: instance || undefined,
    port: input.port ?? undefined,
    database,
    user,
    password,
    encrypt: input.encrypt,
    trustServerCertificate: input.trustServerCertificate,
  };
}

/** SQL authentication (e.g. "sa") through the same driver the app uses. */
class SqlLoginExecutor implements SetupExecutor {
  private pools = new Map<string, sql.ConnectionPool>();
  constructor(private input: ConnectionInput) {}

  private async pool(database = 'master') {
    let pool = this.pools.get(database);
    if (!pool) {
      const cfg = buildConfig(database, toDbConfig(this.input, this.input.user ?? '', this.input.password ?? '', database));
      cfg.pool = { max: 1, min: 0 };
      pool = await new sql.ConnectionPool(cfg).connect();
      this.pools.set(database, pool);
    }
    return pool;
  }

  async scalar(text: string, database?: string) {
    const r = await (await this.pool(database)).request().query(text);
    const row = r.recordset?.[0];
    if (!row) return null;
    const v = Object.values(row)[0];
    return v === null || v === undefined ? null : String(v);
  }

  async script(text: string, database?: string) {
    const pool = await this.pool(database);
    for (const batch of splitBatches(text)) await pool.request().batch(batch);
  }

  async close() {
    await Promise.all([...this.pools.values()].map((p) => p.close().catch(() => undefined)));
    this.pools.clear();
  }
}

/**
 * Windows authentication through sqlcmd (-E), i.e. as the Windows user running the server.
 * The Node driver cannot do integrated authentication, so this is only used during setup.
 */
class SqlcmdExecutor implements SetupExecutor {
  private trustCert = false;
  constructor(private input: ConnectionInput) {}

  private serverArg() {
    return this.input.port ? `${this.input.server.split('\\')[0]},${this.input.port}` : this.input.server;
  }

  private async sqlcmd(args: string[]) {
    const base = ['-S', this.serverArg(), '-E', '-b', '-l', '15'];
    let r = await run('sqlcmd', [...base, ...(this.trustCert ? ['-C'] : []), ...args], 120_000);
    // Newer sqlcmd versions encrypt by default and reject self-signed certificates: retry trusting it
    if (r.code !== 0 && !this.trustCert && /certificate/i.test(r.stdout + r.stderr)) {
      this.trustCert = true;
      r = await run('sqlcmd', [...base, '-C', ...args], 120_000);
    }
    if (r.notFound) throw new Error('sqlcmd was not found. Use SQL Server authentication (e.g. the sa login) instead.');
    if (r.code !== 0) throw new Error(cleanSqlcmdError(r.stdout + '\n' + r.stderr));
    return r.stdout;
  }

  async scalar(text: string, database = 'master') {
    const out = await this.sqlcmd(['-d', database, '-h', '-1', '-W', '-Q', `SET NOCOUNT ON; ${text}`]);
    const line = out.split(/\r?\n/).map((l) => l.trim()).find((l) => l !== '');
    return line === undefined || line === 'NULL' ? null : line;
  }

  async script(text: string, database = 'master') {
    const file = path.join(os.tmpdir(), `workdone-setup-${crypto.randomBytes(8).toString('hex')}.sql`);
    fs.writeFileSync(file, text, { encoding: 'utf8', mode: 0o600 });
    try {
      await this.sqlcmd(['-d', database, '-i', file]);
    } finally {
      fs.rmSync(file, { force: true });
    }
  }

  async close() {
    /* nothing to release */
  }
}

function cleanSqlcmdError(output: string): string {
  const lines = output
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^Msg \d+, Level/i.test(l) && !/^HResult/i.test(l));
  return (lines.join(' ') || 'sqlcmd failed').slice(0, 500);
}

export function createExecutor(input: ConnectionInput): SetupExecutor {
  return input.authType === 'windows' ? new SqlcmdExecutor(input) : new SqlLoginExecutor(input);
}

export async function sqlcmdAvailable(): Promise<boolean> {
  if (process.platform !== 'win32') return false;
  const r = await run('sqlcmd', ['-?'], 10_000);
  return !r.notFound;
}

/**
 * Checks that the server is reachable over TCP with the given encryption settings,
 * which is what the app's driver needs (sqlcmd may connect via shared memory instead).
 * A login failure means the network path works.
 */
export async function probeTcp(input: ConnectionInput): Promise<string | null> {
  const cfg = buildConfig('master', toDbConfig(input, '__workdone_probe__', crypto.randomBytes(12).toString('hex'), 'master'));
  cfg.connectionTimeout = 10_000;
  const pool = new sql.ConnectionPool(cfg);
  try {
    await pool.connect();
    return null;
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e.code === 'ELOGIN') return null;
    return friendlyConnectionError(err);
  } finally {
    await pool.close().catch(() => undefined);
  }
}

export function friendlyConnectionError(err: unknown): string {
  const e = err as { code?: string; message?: string };
  const msg = e.message ?? String(err);
  if (/Port for .* not found/i.test(msg)) {
    return 'Could not find the SQL Server instance over the network. TCP/IP is probably disabled for this instance, or the SQL Server Browser service is not running.';
  }
  if (e.code === 'ESOCKET' || /ECONNREFUSED|getaddrinfo|Failed to connect/i.test(msg)) {
    return `Could not connect to SQL Server over TCP/IP. Check that the service is running and TCP/IP is enabled. (${msg})`;
  }
  if (/certificate|self[- ]signed|SSL|TLS/i.test(msg)) {
    return `Encrypted connection failed: ${msg}. For a local server enable "Trust server certificate", or install a trusted certificate on SQL Server.`;
  }
  if (e.code === 'ELOGIN') return `Login failed: ${msg}`;
  if (e.code === 'ETIMEOUT') return 'Connection timed out. Check the server name and that SQL Server is running.';
  return msg.slice(0, 500);
}
