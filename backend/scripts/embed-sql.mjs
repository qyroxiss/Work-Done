// Turns backend/database/*.sql into src/database/sql.generated.ts, so the app never reads SQL files from
// disk (on Vercel the function's files are laid out differently from this folder). Runs in `npm run build`.
import fs from 'node:fs';

const files = ['main.sql', 'client.sql', 'seed.sql'];
const dir = new URL('../database/', import.meta.url);
const out = new URL('../src/database/sql.generated.ts', import.meta.url);

const entries = files.map((name) => {
  const text = fs.readFileSync(new URL(name, dir), 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');
  return `  ${JSON.stringify(name)}: ${JSON.stringify(text)},`;
});
const source = `// Generated from backend/database/*.sql by scripts/embed-sql.mjs (part of npm run build). Do not edit;
// change the .sql files instead.
export const SQL = {
${entries.join('\n')}
} as const;
`;
if (!fs.existsSync(out) || fs.readFileSync(out, 'utf8') !== source) fs.writeFileSync(out, source);
console.log(`embedded ${files.length} SQL files`);
