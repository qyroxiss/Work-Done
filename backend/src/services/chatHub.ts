import type { Response } from 'express';
import { config } from '../config/env.js';
import { query, sql, type QueryResult } from '../database/pool.js';

/**
 * Live delivery of chat and notification events to open browser tabs (Server-Sent Events).
 * Data is always stored first; this only tells open tabs about it. Events never cross companies.
 *
 * - Long-running server (office PC): connections are kept in memory, events are pushed instantly.
 * - Serverless hosting (config.serverless): every request may run in a different instance, so events
 *   are written to dbo.LiveEvents, and each connection reads new rows every 2 seconds for about
 *   50 seconds, then closes. The browser reconnects by itself and sends the id of the last event it
 *   received (Last-Event-ID), so nothing is missed in between.
 */
type Streams = Map<number, Set<Response>>;
const clients = new Map<string, Streams>();

const HEARTBEAT_MS = 25_000;
const POLL_MS = 2_000;
/** Below Vercel's function time limit; the browser reconnects afterwards */
const STREAM_MS = 50_000;

function openStream(res: Response, retryMs: number) {
  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write(`retry: ${retryMs}\n\n`);
}

export function subscribe(clientId: string, userId: number, res: Response, lastEventId?: string) {
  if (config.serverless) {
    void pollEvents(userId, res, lastEventId);
    return;
  }
  openStream(res, 5000);

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

function send(res: Response, event: string, data: unknown, id?: number) {
  res.write(`${id !== undefined ? `id: ${id}\n` : ''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** Serverless: stream this user's new events from the database (runs in the request's company schema). */
async function pollEvents(userId: number, res: Response, lastEventId?: string) {
  openStream(res, 1000);
  let closed = false;
  res.on('close', () => {
    closed = true;
  });
  try {
    let cursor = /^\d+$/.test(lastEventId ?? '') ? Number(lastEventId) : null;
    if (cursor === null) {
      // First connection: start from now (the page has just loaded everything up to here)
      const r = await query(`SELECT COALESCE(MAX(EventId), 0) AS Last FROM dbo.LiveEvents`);
      cursor = Number(r.recordset[0].Last);
    }
    const until = Date.now() + STREAM_MS;
    while (!closed && Date.now() < until) {
      const r: QueryResult = await query(
        `SELECT EventId, EventType, Payload FROM dbo.LiveEvents
         WHERE EventId > @cursor AND (UserIds IS NULL OR @me = ANY(UserIds))
         ORDER BY EventId LIMIT 200`,
        { cursor: [sql.BigInt, cursor], me: [sql.Int, userId] },
      );
      for (const row of r.recordset) {
        cursor = Number(row.EventId);
        send(res, row.EventType as string, row.Payload, cursor);
      }
      if (r.recordset.length === 0) res.write(': ping\n\n');
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  } catch (err) {
    console.error('[live] event stream failed:', (err as Error).message);
  } finally {
    if (!closed) res.end();
  }
}

/** Sends an event to the given users of a client, or to everyone connected in it ("all"). */
export function publish(clientId: string, userIds: number[] | 'all', event: string, data: unknown) {
  if (config.serverless) {
    // Written in the current request's company schema; failures never break the request itself
    query(`INSERT INTO dbo.LiveEvents (UserIds, EventType, Payload) VALUES (@users::int[], @type, @payload::jsonb)`, {
      users: [sql.Int, userIds === 'all' ? null : userIds],
      type: [sql.NVarChar(30), event],
      payload: [sql.NVarChar(sql.MAX), JSON.stringify(data)],
    }).catch((err: Error) => console.error('[live] could not record event:', err.message));
    return;
  }
  const users = clients.get(clientId);
  if (!users) return;
  const targets = userIds === 'all' ? [...users.keys()] : userIds;
  for (const id of targets) {
    for (const res of users.get(id) ?? []) send(res, event, data);
  }
}

/** Ends the live connections of a user (e.g. after the account was deactivated). */
export function disconnectUser(clientId: string, userId: number) {
  // Serverless: the stream ends within a minute and the reconnect is refused (sessions are revoked)
  for (const res of clients.get(clientId)?.get(userId) ?? []) res.end();
}

/** Daily clean-up of old serverless events (in the current company schema). */
export async function purgeLiveEvents() {
  await query(`DELETE FROM dbo.LiveEvents WHERE CreatedAt < now() - interval '1 day'`);
}
