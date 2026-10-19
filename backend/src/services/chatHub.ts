import type { Response } from 'express';

/**
 * Live delivery of chat events to open browser tabs (Server-Sent Events).
 * Connections are grouped per client company and user, so events never cross companies.
 * Messages are always stored in the database first; this only pushes notifications.
 */
type Streams = Map<number, Set<Response>>;
const clients = new Map<string, Streams>();

const HEARTBEAT_MS = 25_000;

export function subscribe(clientId: string, userId: number, res: Response) {
  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write('retry: 5000\n\n');

  let users = clients.get(clientId);
  if (!users) clients.set(clientId, (users = new Map()));
  let streams = users.get(userId);
  if (!streams) users.set(userId, (streams = new Set()));
  streams.add(res);

  // Keeps proxies and the browser from closing an idle connection
  const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
  res.on('close', () => {
    clearInterval(heartbeat);
    streams.delete(res);
    if (streams.size === 0) users.delete(userId);
    if (users.size === 0) clients.delete(clientId);
  });
}

function send(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** Sends an event to the given users of a client, or to everyone connected in it ("all"). */
export function publish(clientId: string, userIds: number[] | 'all', event: string, data: unknown) {
  const users = clients.get(clientId);
  if (!users) return;
  const targets = userIds === 'all' ? [...users.keys()] : userIds;
  for (const id of targets) {
    for (const res of users.get(id) ?? []) send(res, event, data);
  }
}

/** Ends the live connections of a user (e.g. after the account was deactivated). */
export function disconnectUser(clientId: string, userId: number) {
  for (const res of clients.get(clientId)?.get(userId) ?? []) res.end();
}
