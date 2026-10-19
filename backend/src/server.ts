import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { createApp } from './app.js';
import { config, isConfigured } from './config/env.js';
import { closePool, getPool } from './database/pool.js';
import { purgeOldSessionsAllClients } from './services/auth.service.js';
import { startJobs } from './services/jobs.js';

const app = createApp();

const server = config.https
  ? https.createServer(
      { key: fs.readFileSync(config.https.keyPath), cert: fs.readFileSync(config.https.certPath) },
      app,
    )
  : http.createServer(app);

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\nPort ${config.port} is already in use. Q-WorkDone (or another program) is already running on it.`);
    console.error(`Open http://localhost:${config.port}, or change PORT in backend/.env.\n`);
  } else {
    console.error('Server failed to start:', err.message);
  }
  process.exit(1);
});

server.listen(config.port, config.host, () => {
  const scheme = config.https ? 'https' : 'http';
  console.log(`Q-WorkDone API listening on ${scheme}://${config.host}:${config.port} (${config.nodeEnv})`);
});

if (!isConfigured()) {
  console.log(`\n  Setup required: open http://localhost:${config.port} in a browser on this computer.\n`);
} else {
  // Verify DB connectivity at startup (the server keeps running and retries on demand if it fails)
  const db = config.db!;
  getPool()
    .then(() => {
      console.log(`[db] connected to ${db.database} on ${db.server}${db.instanceName ? `\\${db.instanceName}` : ''}`);
      // Fails harmlessly until setup / the database upgrade has created the client registry
      purgeOldSessionsAllClients().catch((err: Error) => console.error('[sessions] cleanup failed:', err.message));
    })
    .catch((err: Error) => console.error('[db] initial connection failed:', err.message));
}

// Repeating work and due-date reminders (skips itself until setup is complete)
if (isConfigured()) startJobs();

const cleanup = setInterval(() => {
  if (!isConfigured()) return;
  purgeOldSessionsAllClients().catch((err: Error) => console.error('[sessions] cleanup failed:', err.message));
}, 60 * 60 * 1000);
cleanup.unref();

async function shutdown(signal: string) {
  console.log(`${signal} received, shutting down...`);
  server.close();
  await closePool();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
