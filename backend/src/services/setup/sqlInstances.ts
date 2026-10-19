import { run } from './processUtil.js';

export interface SqlInstance {
  /** Instance name as registered, e.g. "SQL2022" or "MSSQLSERVER" (default instance) */
  name: string;
  /** Registry id, e.g. "MSSQL16.SQL2022" */
  id: string;
  /** Value to use as DB_SERVER, e.g. "localhost\SQL2022" or "localhost" */
  server: string;
  serviceName: string;
  version: string;
  /** Major version number, e.g. 16 for SQL Server 2022 (10.5 for 2008 R2) */
  major: number;
  running: boolean;
  tcpEnabled: boolean;
  mixedMode: boolean;
}

const ROOT = 'HKLM\\SOFTWARE\\Microsoft\\Microsoft SQL Server';

const VERSIONS: Record<string, string> = {
  '17': 'SQL Server 2025',
  '16': 'SQL Server 2022',
  '15': 'SQL Server 2019',
  '14': 'SQL Server 2017',
  '13': 'SQL Server 2016',
  '12': 'SQL Server 2014',
  '11': 'SQL Server 2012',
  '10_50': 'SQL Server 2008 R2',
  '10': 'SQL Server 2008',
};

async function regValue(key: string, value: string): Promise<string | null> {
  const r = await run('reg', ['query', key, '/v', value], 10_000);
  if (r.code !== 0) return null;
  const m = r.stdout.match(new RegExp(`^\\s+${value}\\s+REG_\\w+\\s+(.*)$`, 'im'));
  return m ? m[1].trim() : null;
}

async function serviceRunning(name: string): Promise<boolean> {
  const r = await run('sc', ['query', name], 10_000);
  return /STATE\s*:\s*4\s+RUNNING/i.test(r.stdout);
}

/** Lists SQL Server instances installed on this computer (Windows only; best effort). */
export async function detectLocalInstances(): Promise<SqlInstance[]> {
  if (process.platform !== 'win32') return [];
  const r = await run('reg', ['query', `${ROOT}\\Instance Names\\SQL`], 10_000);
  if (r.code !== 0) return [];

  const entries = [...r.stdout.matchAll(/^\s+(\S+)\s+REG_SZ\s+(\S+)\s*$/gim)].map((m) => ({ name: m[1], id: m[2] }));
  const instances = await Promise.all(
    entries.map(async ({ name, id }): Promise<SqlInstance> => {
      const isDefault = name.toUpperCase() === 'MSSQLSERVER';
      const serviceName = isDefault ? 'MSSQLSERVER' : `MSSQL$${name}`;
      const major = id.match(/^MSSQL(\d+(?:_\d+)?)\./)?.[1] ?? '';
      const [tcp, loginMode, running] = await Promise.all([
        regValue(`${ROOT}\\${id}\\MSSQLServer\\SuperSocketNetLib\\Tcp`, 'Enabled'),
        regValue(`${ROOT}\\${id}\\MSSQLServer`, 'LoginMode'),
        serviceRunning(serviceName),
      ]);
      return {
        name,
        id,
        server: isDefault ? 'localhost' : `localhost\\${name}`,
        serviceName,
        version: VERSIONS[major] ?? `SQL Server (${id})`,
        major: Number(major.replace('_', '.')) || 0,
        running,
        tcpEnabled: tcp === '0x1',
        mixedMode: loginMode === '0x2',
      };
    }),
  );
  // Newest versions first
  return instances.sort((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true }));
}

export async function sqlBrowserRunning(): Promise<boolean> {
  return process.platform === 'win32' ? serviceRunning('SQLBrowser') : false;
}
