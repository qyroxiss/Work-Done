import type { Request, Response } from 'express';
import { currentUser } from '../middleware/auth.js';
import { checkAttachment, INLINE_TYPES, MAX_WORK_FILE_BYTES } from '../services/chat.service.js';
import { getDashboard } from '../services/dashboard.service.js';
import { mentionableUsers } from '../services/notifications.service.js';
import * as work from '../services/workItems.service.js';
import { badRequest } from '../utils/httpError.js';
import { idParam } from '../validators/common.js';
import {
  assignmentsBody,
  createWorkBody,
  noteBody,
  statusBody,
  updateWorkBody,
  workListQuery,
} from '../validators/work.validators.js';

export async function list(req: Request, res: Response) {
  res.json(await work.listWorkItems(workListQuery.parse(req.query), currentUser(req)));
}

export async function get(req: Request, res: Response) {
  res.json(await work.getWorkItem(idParam.parse(req.params).id, currentUser(req)));
}

export async function create(req: Request, res: Response) {
  res.status(201).json(await work.createWorkItem(createWorkBody.parse(req.body), currentUser(req)));
}

export async function update(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  res.json(await work.updateWorkItem(id, updateWorkBody.parse(req.body), currentUser(req)));
}

export async function setAssignments(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  const { employeeIds } = assignmentsBody.parse(req.body);
  res.json(await work.setAssignments(id, employeeIds, currentUser(req)));
}

export async function changeStatus(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  res.json(await work.changeStatus(id, statusBody.parse(req.body), currentUser(req)));
}

export async function addNote(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  const { notes } = noteBody.parse(req.body);
  res.status(201).json(await work.addNote(id, notes, currentUser(req)));
}

export async function dashboard(req: Request, res: Response) {
  res.json(await getDashboard(currentUser(req)));
}

/** People who can be @mentioned in this work item's notes. */
export async function mentionable(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  const user = currentUser(req);
  await work.assertCanAccess(id, user);
  res.json({ items: await mentionableUsers(id) });
}

function headerText(req: Request, name: string): string {
  try {
    return decodeURIComponent(req.get(name) ?? '');
  } catch {
    throw badRequest(`Invalid ${name} header.`);
  }
}

/** Raw file body (application/octet-stream); name and type in X-File-Name / X-File-Type, as for chat. */
export async function upload(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  if (!Buffer.isBuffer(req.body)) throw badRequest('No file was received.');
  const file = checkAttachment(headerText(req, 'x-file-name'), headerText(req, 'x-file-type'), req.body, MAX_WORK_FILE_BYTES);
  const result = await work.addAttachment(id, file, currentUser(req));
  res.status(201).json(result.work);
}

export async function download(req: Request, res: Response) {
  const file = await work.getAttachment(idParam.parse(req.params).id, currentUser(req));
  const inline = INLINE_TYPES.has(file.contentType) && req.query.download !== '1';
  const ascii = file.fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(file.fileName);
  res.set({
    // Anything that is not a plain image is served as a download, never rendered by the browser
    'Content-Type': inline ? file.contentType : 'application/octet-stream',
    'Content-Length': String(file.content.length),
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encoded}`,
    'Cache-Control': 'private, max-age=86400',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  });
  res.end(file.content);
}

export async function removeAttachment(req: Request, res: Response) {
  res.json(await work.removeAttachment(idParam.parse(req.params).id, currentUser(req)));
}
