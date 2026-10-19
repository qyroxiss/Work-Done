import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import { config, isConfigured } from './config/env.js';
import { query } from './database/pool.js';
import { csrfGuard } from './middleware/csrf.js';
import { apiNotFound, errorHandler } from './middleware/errorHandler.js';
import { requestLogger } from './middleware/requestLogger.js';
import { authRoutes } from './routes/auth.routes.js';
import { apiRoutes } from './routes/index.js';
import { setupRoutes } from './routes/setup.routes.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// backend/src (dev) or backend/dist (prod) -> ../../frontend/dist
const frontendDist = path.resolve(here, '../../frontend/dist');

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          // Forcing HTTPS sub-requests would break the app when served over plain HTTP on the LAN
          upgradeInsecureRequests: config.https ? [] : null,
        },
      },
      // HSTS only makes sense once the app is served over HTTPS
      strictTransportSecurity: config.https ? undefined : false,
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use('/api', requestLogger);
  app.use('/api', csrfGuard);
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  app.get('/api/health', async (_req, res) => {
    if (!isConfigured()) {
      res.json({ status: 'setup-required', database: 'not configured', time: new Date().toISOString() });
      return;
    }
    try {
      await query('SELECT 1 AS Ok');
      res.json({ status: 'ok', database: 'connected', time: new Date().toISOString() });
    } catch {
      res.status(503).json({ status: 'degraded', database: 'unavailable', time: new Date().toISOString() });
    }
  });

  app.use('/api/setup', setupRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api', apiRoutes);
  app.use('/api', apiNotFound);

  // Serve the built React app (production / LAN deployment) from the same origin
  if (fs.existsSync(path.join(frontendDist, 'index.html'))) {
    app.use(express.static(frontendDist, { index: false, maxAge: '1h' }));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
      res.sendFile(path.join(frontendDist, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
}
