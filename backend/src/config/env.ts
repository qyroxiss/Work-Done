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
  /**
   * Serverless hosting (Vercel sets VERCEL=1): no long-running process, so live events go through the
   * database, background work runs from a cron request, and requests are limited to 4.5 MB.
   * REALTIME_MODE=poll turns this on elsewhere (e.g. to test it locally).
   */
  const serverless = Boolean(get('VERCEL')) || get('REALTIME_MODE') === 'poll';

  // The database section is null until setup has been completed ("setup mode").
  // DATABASE_URL is a PostgreSQL connection string, e.g. postgres://user:pass@host:5432/workdone
  // (hosted databases such as Neon add ?sslmode=require).
  const url = get('DATABASE_URL');
  const db: DbConfig | null = url ? { url, poolSize: int('DB_POOL_SIZE', serverless ? 3 : 10) } : null;
  // Vercel's request limit is 4.5 MB, so files there are capped at 4 MB
  const uploadMb = int('UPLOAD_LIMIT_MB', serverless ? 4 : 20);

  const keyPath = get('HTTPS_KEY_PATH');
  const certPath = get('HTTPS_CERT_PATH');

  return {
    nodeEnv,
    isProd,
    port: int('PORT', 3000),
    host: get('HOST') ?? '0.0.0.0',
    // Behind Vercel's proxy the visitor's address is in X-Forwarded-For (used by the sign-in rate limit)
    trustProxy: bool('TRUST_PROXY', serverless),
    serverless,
    db,
    uploads: {
      workFileBytes: uploadMb * 1024 * 1024,
      chatFileBytes: Math.min(uploadMb, 10) * 1024 * 1024,
    },
    /** Shared secret of the daily background request (Vercel Cron sends it as a Bearer token) */
    cronSecret: get('CRON_SECRET'),
    session: {
      idleMinutes: int('SESSION_IDLE_MINUTES', 30),
      maxHours: int('SESSION_MAX_HOURS', 12),
      cookieSecure: bool('COOKIE_SECURE', isProd),
    },
    https: keyPath && certPath ? { keyPath, certPath } : undefined,
    /**
     * Lets setup and client management be done from another computer by entering this key
     * (needed on cloud hosts, where nobody uses "the server computer"). Unset = server computer only.
     */
    setupKey: get('SETUP_KEY'),
  };
}

export interface DbConfig {
  /** PostgreSQL connection string */
  url: string;
  /** Connections kept open by this server process */
  poolSize: number;
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
