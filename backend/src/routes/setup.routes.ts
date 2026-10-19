import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { logSecurityEvent } from '../services/audit.service.js';
import { listClients, updateClient } from '../services/clients.service.js';
import { sqlcmdAvailable } from '../services/setup/executor.js';
import * as setup from '../services/setup/setup.service.js';
import { forbidden } from '../utils/httpError.js';
import { companyBody, companyNameRule, passwordRule } from '../validators/common.js';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function isLocalRequest(req: Parameters<RequestHandler>[0]): boolean {
  // Use the socket address (not req.ip / X-Forwarded-For, which a client could spoof)
  return LOOPBACK.has(req.socket.remoteAddress ?? '') && !req.headers['x-forwarded-for'];
}

/** Setup changes the server itself, so it may only be done from the server computer. */
const requireLocal: RequestHandler = (req, _res, next) => {
  if (!isLocalRequest(req)) {
    next(forbidden('Setup can only be done on the server computer itself (open http://localhost in its browser).'));
    return;
  }
  next();
};

const connectionBody = z.object({
  server: z.string().trim().min(1, 'Server is required').max(150),
  port: z
    .union([z.coerce.number().int().min(1).max(65535), z.literal(''), z.null()])
    .optional()
    .transform((v) => (typeof v === 'number' ? v : null)),
  authType: z.enum(['windows', 'sql']),
  user: z.string().trim().max(128).optional(),
  password: z.string().max(128).optional(),
  encrypt: z.boolean().default(true),
  trustServerCertificate: z.boolean().default(true),
  database: z.string().trim().min(1).max(100).default('WorkDoneDB'),
});

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

export const setupRoutes = Router();

setupRoutes.get('/status', async (req, res) => {
  const { step, dbError } = await setup.getSetupStep();
  const local = isLocalRequest(req);
  res.json({
    needsSetup: step !== 'done',
    step,
    isLocal: local,
    dbError: dbError && local ? dbError : undefined,
    // Machine details are only shown to the server computer, and only while setting up
    environment: step !== 'done' && local ? await setup.getEnvironmentInfo() : undefined,
  });
});

setupRoutes.post('/auto', requireLocal, async (_req, res) => {
  await setup.assertStep('database');
  res.json(await setup.autoSetup());
});

setupRoutes.post('/test-connection', requireLocal, async (req, res) => {
  await setup.assertStep('database');
  const { database, ...conn } = connectionBody.parse(req.body);
  res.json(await setup.testConnection(conn, database));
});

setupRoutes.post('/install', requireLocal, async (req, res) => {
  await setup.assertStep('database');
  const body = connectionBody.extend({ loadSampleData: z.boolean().default(false) }).parse(req.body);
  const { database, loadSampleData, ...conn } = body;
  res.json(await setup.install(conn, database, loadSampleData));
});

setupRoutes.post('/upgrade', requireLocal, async (req, res) => {
  await setup.assertStep('upgrade');
  const body = z
    .object({ user: z.string().trim().min(1).max(128).optional(), password: z.string().max(128).optional() })
    .parse(req.body ?? {});
  res.json(await setup.upgradeDatabase(body.user ? { user: body.user, password: body.password ?? '' } : undefined));
});

setupRoutes.post('/admin', requireLocal, async (req, res) => {
  await setup.assertStep('admin');
  const body = companyBody
    .extend({
      username: usernameRule,
      email: optionalEmail,
      password: passwordRule,
    })
    .parse(req.body);
  await setup.createFirstAdmin(
    { username: body.username, email: body.email, password: body.password },
    { companyName: body.companyName, clientId: body.clientId },
    req.ip,
  );
  res.status(201).json({ ok: true });
});

setupRoutes.post('/company', requireLocal, async (req, res) => {
  await setup.assertStep('company');
  await setup.setCompany(companyBody.parse(req.body), req.ip);
  res.json({ ok: true });
});

setupRoutes.post('/system-action', requireLocal, async (req, res) => {
  const { action, instanceName } = z
    .object({
      action: z.enum(['enable-tcp', 'start-service', 'enable-mixed-mode', 'firewall', 'autostart']),
      instanceName: z.string().regex(/^[A-Za-z0-9_$]+$/).max(64).optional(),
    })
    .parse(req.body);
  // SQL Server changes are only allowed while the database step is pending;
  // firewall / auto-start are part of the final step.
  const { step } = await setup.getSetupStep();
  const allowed = ['firewall', 'autostart'].includes(action) ? step !== 'done' : step === 'database';
  if (!allowed) throw forbidden('This action is not available now.');
  res.json(await setup.runSystemAction(action, instanceName));
});

// ---------------------------------------------------------------- Client companies
// Each client has its own database. Managed from the server computer only, once setup is complete.

const requireSetupDone: RequestHandler = async (_req, _res, next) => {
  await setup.assertStep('done');
  next();
};

setupRoutes.get('/clients', requireLocal, requireSetupDone, async (_req, res) => {
  const items = await listClients();
  res.json({ items, sqlcmdAvailable: await sqlcmdAvailable() });
});

setupRoutes.post('/clients', requireLocal, requireSetupDone, async (req, res) => {
  const body = companyBody
    .extend({
      username: usernameRule,
      email: optionalEmail,
      password: passwordRule,
      sqlUser: z.string().trim().max(128).optional(),
      sqlPassword: z.string().max(128).optional(),
    })
    .parse(req.body);
  const result = await setup.createClient(
    {
      clientId: body.clientId,
      companyName: body.companyName,
      admin: { username: body.username, email: body.email, password: body.password },
      adminLogin: body.sqlUser ? { user: body.sqlUser, password: body.sqlPassword ?? '' } : undefined,
    },
    req.ip,
  );
  res.status(201).json(result);
});

setupRoutes.patch('/clients/:clientId', requireLocal, requireSetupDone, async (req, res) => {
  const body = z.object({ companyName: companyNameRule.optional(), isActive: z.boolean().optional() }).parse(req.body);
  const client = await updateClient(String(req.params.clientId), body);
  await logSecurityEvent('SETTINGS_UPDATED', {
    ip: req.ip,
    details: `Client ${client.clientId} updated from the server computer${body.isActive === undefined ? '' : body.isActive ? ' (activated)' : ' (deactivated)'}`,
  });
  res.json(client);
});
