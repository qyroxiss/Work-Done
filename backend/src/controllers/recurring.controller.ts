import type { Request, Response } from 'express';
import { currentUser } from '../middleware/auth.js';
import * as recurring from '../services/recurring.service.js';
import { idParam } from '../validators/common.js';
import { recurringBody, recurringListQuery } from '../validators/recurring.validators.js';

export async function list(req: Request, res: Response) {
  res.json(await recurring.listRecurring(recurringListQuery.parse(req.query)));
}

export async function get(req: Request, res: Response) {
  res.json(await recurring.getRecurring(idParam.parse(req.params).id));
}

export async function create(req: Request, res: Response) {
  res.status(201).json(await recurring.createRecurring(recurringBody.parse(req.body), currentUser(req)));
}

export async function update(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  res.json(await recurring.updateRecurring(id, recurringBody.parse(req.body), currentUser(req)));
}
