import type { Request, Response } from 'express';
import { z } from 'zod';
import { currentUser } from '../middleware/auth.js';
import * as notifications from '../services/notifications.service.js';

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  before: z.coerce.number().int().positive().optional(),
});

const readBody = z.union([
  z.object({ all: z.literal(true) }),
  z.object({ ids: z.array(z.coerce.number().int().positive()).min(1).max(200) }),
]);

export async function list(req: Request, res: Response) {
  const q = listQuery.parse(req.query);
  res.json(await notifications.listNotifications(currentUser(req), q.limit, q.before));
}

export async function unread(req: Request, res: Response) {
  res.json({ unread: await notifications.unreadCount(currentUser(req)) });
}

export async function read(req: Request, res: Response) {
  const body = readBody.parse(req.body);
  res.json(await notifications.markRead(currentUser(req), 'all' in body ? 'all' : body.ids));
}
