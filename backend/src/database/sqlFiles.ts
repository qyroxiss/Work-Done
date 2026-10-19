import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
/** Project-level database/ folder (from backend/src/database or backend/dist/database) */
export const DATABASE_DIR = path.resolve(here, '../../../database');

export function readSqlFile(file: string): string {
  return fs.readFileSync(path.join(DATABASE_DIR, file), 'utf8').replace(/^﻿/, '');
}

/** Splits a script into batches on lines containing only "GO" (as SSMS/sqlcmd do). */
export function splitBatches(script: string): string[] {
  return script
    .split(/^\s*GO\s*;?\s*$/im)
    .map((b) => b.trim())
    .filter((b) => b.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '').trim() !== '');
}
