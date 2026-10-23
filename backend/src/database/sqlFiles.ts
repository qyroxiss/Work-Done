import fs from 'node:fs';

/**
 * The SQL scripts in backend/database. Each file is named with `new URL('…', import.meta.url)` so that
 * bundlers (Vercel's file tracing) see them and ship them with the function. The paths work from both
 * backend/src/database (development) and backend/dist/database (build).
 */
const FILES = {
  'main.sql': new URL('../../database/main.sql', import.meta.url),
  'client.sql': new URL('../../database/client.sql', import.meta.url),
  'seed.sql': new URL('../../database/seed.sql', import.meta.url),
} as const;

export type SqlFile = keyof typeof FILES;

const cache = new Map<SqlFile, string>();

export function readSqlFile(file: SqlFile): string {
  let text = cache.get(file);
  if (text === undefined) {
    text = fs.readFileSync(FILES[file], 'utf8').replace(/^﻿/, '');
    cache.set(file, text);
  }
  return text;
}
