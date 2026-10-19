import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
/** backend/ folder (works from both src/config and dist/config) */
export const BACKEND_ROOT = path.resolve(here, '../..');
/** The .env file is always read from the backend folder, regardless of the working directory. */
export const ENV_PATH = path.join(BACKEND_ROOT, '.env');
export const ENV_EXAMPLE_PATH = path.join(BACKEND_ROOT, '.env.example');

type Env = Record<string, string | undefined>;

/** Values set in the real process environment take precedence over the .env file. */
function readEnv(): Env {
  const fileVars = fs.existsSync(ENV_PATH) ? dotenv.parse(fs.readFileSync(ENV_PATH)) : {};
  return { ...fileVars, ...process.env };
}

function build(env: Env) {
  const get = (name: string): string | undefined => {
    const v = env[name];
    return v !== undefined && v.trim() !== '' ? v.trim() : undefined;
  };
  const bool = (name: string, fallback: boolean): boolean => {
    const v = get(name);
    return v === undefined ? fallback : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
  };
  const int = (name: string, fallback: number): number => {
    const v = get(name);
    if (v === undefined) return fallback;
    const n = Number.parseInt(v, 10);
    if (Number.isNaN(n)) throw new Error(`Environment variable ${name} must be a number`);
    return n;
  };

  const nodeEnv = get('NODE_ENV') ?? 'development';
  const isProd = nodeEnv === 'production';

  // The database section is null until setup has been completed ("setup mode").
  const rawServer = get('DB_SERVER');
  const dbUser = get('DB_USER');
  const dbPassword = get('DB_PASSWORD');
  let db: DbConfig | null = null;
  if (rawServer && dbUser && dbPassword !== undefined) {
    const [host, instance] = rawServer.split('\\');
    db = {
      server: host,
      instanceName: instance || undefined,
      port: get('DB_PORT') ? int('DB_PORT', 1433) : undefined,
      database: get('DB_DATABASE') ?? 'WorkDoneDB',
      user: dbUser,
      password: dbPassword,
      encrypt: bool('DB_ENCRYPT', true),
      trustServerCertificate: bool('DB_TRUST_SERVER_CERTIFICATE', false),
    };
  }

  const keyPath = get('HTTPS_KEY_PATH');
  const certPath = get('HTTPS_CERT_PATH');

  return {
    nodeEnv,
    isProd,
    port: int('PORT', 3000),
    host: get('HOST') ?? '0.0.0.0',
    trustProxy: bool('TRUST_PROXY', false),
    db,
    session: {
      idleMinutes: int('SESSION_IDLE_MINUTES', 30),
      maxHours: int('SESSION_MAX_HOURS', 12),
      cookieSecure: bool('COOKIE_SECURE', isProd),
    },
    https: keyPath && certPath ? { keyPath, certPath } : undefined,
  };
}

export interface DbConfig {
  server: string;
  instanceName?: string;
  port?: number;
  database: string;
  user: string;
  password: string;
  encrypt: boolean;
  trustServerCertificate: boolean;
}

export type AppConfig = ReturnType<typeof build>;

export const config: AppConfig = build(readEnv());

/** Re-reads .env (used after the setup wizard writes it). Mutates the shared config object. */
export function reloadConfig(): void {
  Object.assign(config, build(readEnv()));
}

export function isConfigured(): boolean {
  return config.db !== null;
}
