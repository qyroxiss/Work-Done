import type { Request, Response } from 'express';
import { currentUser } from '../middleware/auth.js';
import * as users from '../services/users.service.js';
import { idParam } from '../validators/common.js';
import {
  createUserBody,
  resetPasswordBody,
  updateUserBody,
  userListQuery,
} from '../validators/user.validators.js';

export async function listUsers(req: Request, res: Response) {
  res.json(await users.listUsers(userListQuery.parse(req.query)));
}

export async function getUser(req: Request, res: Response) {
  res.json(await users.getUser(idParam.parse(req.params).id));
}

export async function createUser(req: Request, res: Response) {
  res.status(201).json(await users.createUser(createUserBody.parse(req.body), currentUser(req), req.ip));
}

export async function updateUser(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  res.json(await users.updateUser(id, updateUserBody.parse(req.body), currentUser(req), req.ip));
}

export async function resetPassword(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  const { password } = resetPasswordBody.parse(req.body);
  await users.resetPassword(id, password, currentUser(req), req.ip);
  res.status(204).end();
}
