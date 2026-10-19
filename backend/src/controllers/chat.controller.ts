import type { Request, Response } from 'express';
import { z } from 'zod';
import { currentUser } from '../middleware/auth.js';
import * as chat from '../services/chat.service.js';
import { subscribe } from '../services/chatHub.js';
import { badRequest } from '../utils/httpError.js';
import { idParam } from '../validators/common.js';

const optionalId = z.coerce.number().int().positive().optional();
const messagesQuery = z.object({
  before: optionalId,
  after: optionalId,
  around: optionalId,
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const messageText = z.string().trim().max(2000, 'Messages can be at most 2000 characters');
const sendBody = z.object({ body: messageText.min(1, 'Type a message') });
const editBody = z.object({ body: messageText });
const readBody = z.object({ messageId: z.coerce.number().int().min(0) });
const directBody = z.object({ userId: z.coerce.number().int().positive() });
const groupTitle = z.string().trim().min(1, 'Group name is required').max(100, 'Group name can be at most 100 characters');
const userIds = z.array(z.coerce.number().int().positive()).max(500);
const groupBody = z.object({ title: groupTitle, memberIds: userIds.min(1, 'Add at least one person') });
const memberParams = z.object({ id: z.coerce.number().int().positive(), userId: z.coerce.number().int().positive() });
const searchQuery = z.object({ q: z.string().trim().min(2, 'Type at least 2 characters').max(100) });

export async function users(req: Request, res: Response) {
  res.json({ items: await chat.listChatUsers(currentUser(req)) });
}

export async function conversations(req: Request, res: Response) {
  res.json({ items: await chat.listConversations(currentUser(req)) });
}

export async function conversation(req: Request, res: Response) {
  res.json(await chat.getConversation(currentUser(req), idParam.parse(req.params).id));
}

export async function openDirect(req: Request, res: Response) {
  res.json(await chat.openDirect(currentUser(req), directBody.parse(req.body).userId));
}

export async function createGroup(req: Request, res: Response) {
  const { title, memberIds } = groupBody.parse(req.body);
  res.status(201).json(await chat.createGroup(currentUser(req), title, memberIds));
}

export async function renameGroup(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  res.json(await chat.renameGroup(currentUser(req), id, z.object({ title: groupTitle }).parse(req.body).title));
}

export async function members(req: Request, res: Response) {
  res.json({ items: await chat.listMembers(currentUser(req), idParam.parse(req.params).id) });
}

export async function addMembers(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  const body = z.object({ userIds: userIds.min(1, 'Choose at least one person') }).parse(req.body);
  res.json({ items: await chat.addMembers(currentUser(req), id, body.userIds) });
}

export async function removeMember(req: Request, res: Response) {
  const { id, userId } = memberParams.parse(req.params);
  await chat.removeMember(currentUser(req), id, userId);
  res.status(204).end();
}

export async function messages(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  res.json(await chat.getMessages(currentUser(req), id, messagesQuery.parse(req.query)));
}

export async function send(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  res.status(201).json(await chat.sendMessage(currentUser(req), id, sendBody.parse(req.body).body));
}

function headerText(req: Request, name: string): string {
  try {
    return decodeURIComponent(req.get(name) ?? '');
  } catch {
    throw badRequest(`Invalid ${name} header.`);
  }
}

/**
 * File upload: the raw file is the request body (sent as application/octet-stream so the JSON parser
 * leaves it alone); name, type and an optional caption come in X-File-Name / X-File-Type / X-Caption.
 */
export async function upload(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  if (!Buffer.isBuffer(req.body)) throw badRequest('No file was received.');
  const caption = messageText.parse(headerText(req, 'x-caption'));
  const file = chat.checkAttachment(headerText(req, 'x-file-name'), headerText(req, 'x-file-type'), req.body);
  res.status(201).json(await chat.sendMessage(currentUser(req), id, caption, file));
}

export async function download(req: Request, res: Response) {
  const file = await chat.getAttachment(currentUser(req), idParam.parse(req.params).id);
  const asDownload = !file.inline || req.query.download === '1';
  const ascii = file.fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(file.fileName);
  res.set({
    // Anything that is not a plain image is served as a download, never rendered by the browser
    'Content-Type': file.inline ? file.contentType : 'application/octet-stream',
    'Content-Length': String(file.content.length),
    'Content-Disposition': `${asDownload ? 'attachment' : 'inline'}; filename="${ascii}"; filename*=UTF-8''${encoded}`,
    'Cache-Control': 'private, max-age=86400',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  });
  res.end(file.content);
}

export async function edit(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  res.json(await chat.editMessage(currentUser(req), id, editBody.parse(req.body).body));
}

export async function remove(req: Request, res: Response) {
  res.json(await chat.deleteMessage(currentUser(req), idParam.parse(req.params).id));
}

export async function read(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  res.json(await chat.markRead(currentUser(req), id, readBody.parse(req.body).messageId));
}

export async function unread(req: Request, res: Response) {
  res.json({ unread: await chat.unreadTotal(currentUser(req)) });
}

export async function search(req: Request, res: Response) {
  res.json({ items: await chat.search(currentUser(req), searchQuery.parse(req.query).q) });
}

/** Live event stream (Server-Sent Events) for messages, edits, read updates and group changes. */
export function events(req: Request, res: Response) {
  const user = currentUser(req);
  subscribe(user.clientId, user.userId, res);
}
