import { SQL } from './sql.generated.js';

/**
 * The SQL scripts of backend/database, embedded at build time (scripts/embed-sql.mjs), so the app runs the
 * same wherever its files end up (office server, Vercel function). Edit the .sql files, then build.
 */
export type SqlFile = keyof typeof SQL;

export function readSqlFile(file: SqlFile): string {
  return SQL[file];
}
