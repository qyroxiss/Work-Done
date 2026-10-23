import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
/** Project-level database/ folder (from backend/src/database or backend/dist/database) */
export const DATABASE_DIR = path.resolve(here, '../../../database');

const cache = new Map<string, string>();

export function readSqlFile(file: string): string {
  let text = cache.get(file);
  if (text === undefined) {
    text = fs.readFileSync(path.join(DATABASE_DIR, file), 'utf8').replace(/^﻿/, '');
    cache.set(file, text);
  }
  return text;
}
