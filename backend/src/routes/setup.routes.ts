import crypto from 'node:crypto';
import { Router, type Request, type RequestHandler } from 'express';
import { z } from 'zod';
import { config } from '../config/env.js';
import { logSecurityEvent } from '../services/audit.service.js';
import { listClients, updateClient } from '../services/clients.service.js';
import * as setup from '../services/setup/setup.service.js';
import { forbidden } from '../utils/httpError.js';
import { companyBody, companyNameRule, passwordRule } from '../validators/common.js';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function isLocalRequest(req: Request): boolean {
  // Use the socket address (not req.ip / X-Forwarded-For, which a client could spoof)
  return LOOPBACK.has(req.socket.remoteAddress ?? '') && !req.headers['x-forwarded-for'];
}

/** The X-Setup-Key header matches SETUP_KEY (compared in constant time). */
function hasSetupKey(req: Request): boolean {
  const expected = config.setupKey;
  const given = req.get('x-setup-key');
  if (!expected || !given) return false;
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

function canAdminister(req: Request): boolean {
  return isLocalRequest(req) || hasSetupKey(req);
}

/** Setup changes the server itself: only from the server computer, or with the setup key. */
const requireAdminAccess: RequestHandler = (req, _res, next) => {
  if (!canAdminister(req)) {
    next(
      forbidden(
        config.setupKey
          ? 'Enter the setup key to continue.'
          : 'Setup can only be done on the server computer itself (open http://localhost in its browser).',
      ),
    );
    return;
  }
  next();
};

const usernameRule = z
  .string()
  .trim()
  .min(3, 'Username must be at least 3 characters')
  .max(50)
  .regex(/^[A-Za-z0-9._-]+$/, 'Use letters, numbers, dot, dash or underscore only');

const optionalEmail = z
  .union([z.string().trim().toLowerCase().email('Invalid email address').max(150), z.literal(''), z.null()])
  .optional()
  .transform((v) => v || null);

const databaseBody = z.object({ url: z.string().trim().min(1, 'Enter the connection string').max(2000) });

export const setupRoutes = Router();

setupRoutes.get('/status', async (req, res) => {
  const { step, dbError } = await setup.getSetupStep();
  const allowed = canAdminister(req);
  res.json({
    needsSetup: step !== 'done',
    step,
    isLocal: allowed,
    // Windows options (firewall, auto-start) only make sense on the server computer itself
    onServerComputer: isLocalRequest(req),
    // Another computer may continue by entering the setup key
    setupKeyEnabled: Boolean(config.setupKey),
    // File size limits, so the browser can say so before uploading
    uploadLimits: config.uploads,
    dbError: dbError && allowed ? dbError : undefined,
    // Machine details only for whoever may run setup, and only while setting up
    environment: step !== 'done' && allowed ? setup.getEnvironmentInfo() : undefined,
  });
});

setupRoutes.post('/test-connection', requireAdminAccess, async (req, res) => {
  await setup.assertStep('database');
  res.json(await setup.testConnection(databaseBody.parse(req.body).url));
});

setupRoutes.post('/database', requireAdminAccess, async (req, res) => {
  await setup.assertStep('database');
  res.json(await setup.connectDatabase(databaseBody.parse(req.body).url));
});

setupRoutes.post('/admin', requireAdminAccess, async (req, res) => {
  await setup.assertStep('admin');
  const body = companyBody
    .extend({ username: usernameRule, email: optionalEmail, password: passwordRule, loadSampleData: z.boolean().default(false) })
    .parse(req.body);
  const result = await setup.createFirstCompany(
    {
      clientId: body.clientId,
      companyName: body.companyName,
      admin: { username: body.username, email: body.email, password: body.password },
      loadSampleData: body.loadSampleData,
    },
    req.ip,
  );
  res.status(201).json({ log: result.log });
});

setupRoutes.post('/system-action', requireAdminAccess, async (req, res) => {
  const { action } = z.object({ action: z.enum(['firewall', 'autostart']) }).parse(req.body);
  // Only part of the final setup step, and only on the server computer itself
  const { step } = await setup.getSetupStep();
  if (step === 'done' || !isLocalRequest(req)) throw forbidden('This action is not available now.');
  res.json(await setup.runSystemAction(action));
});

// ---------------------------------------------------------------- Client companies
// Each client has its own schema. Managed from the server computer (or with the setup key) once setup is complete.

const requireSetupDone: RequestHandler = async (_req, _res, next) => {
  await setup.assertStep('done');
  next();
};

setupRoutes.get('/clients', requireAdminAccess, requireSetupDone, async (_req, res) => {
  res.json({ items: await listClients() });
});

setupRoutes.post('/clients', requireAdminAccess, requireSetupDone, async (req, res) => {
  const body = companyBody.extend({ username: usernameRule, email: optionalEmail, password: passwordRule }).parse(req.body);
  const result = await setup.createClient(
    {
      clientId: body.clientId,
      companyName: body.companyName,
      admin: { username: body.username, email: body.email, password: body.password },
      mustChangePassword: true,
    },
    req.ip,
  );
  res.status(201).json(result);
});

setupRoutes.patch('/clients/:clientId', requireAdminAccess, requireSetupDone, async (req, res) => {
  const body = z.object({ companyName: companyNameRule.optional(), isActive: z.boolean().optional() }).parse(req.body);
  const client = await updateClient(String(req.params.clientId), body);
  await logSecurityEvent('SETTINGS_UPDATED', {
    ip: req.ip,
    details: `Client ${client.clientId} updated by the service provider${body.isActive === undefined ? '' : body.isActive ? ' (activated)' : ' (deactivated)'}`,
  });
  res.json(client);
});
