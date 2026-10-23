import { query, sql, withTransaction, type Params, type Row } from '../database/pool.js';
import type { AuthUser, Role } from '../types/domain.js';
import { toIso } from '../utils/dates.js';
import { badRequest, forbidden, notFound } from '../utils/httpError.js';
import { likeParam } from '../utils/sqlHelpers.js';
import { publish } from './chatHub.js';

/**
 * Chat inside one client company (each client has its own database, so users of other
 * companies are never visible). Every company has one "Everyone" conversation; any two users
 * can have one direct conversation; users can create named groups. Unread counts come from
 * ChatMembers.LastReadMessageId.
 */

export type ConversationKind = 'Company' | 'Direct' | 'Group';

/** DirectKey of the company-wide conversation (unique index guarantees there is only one) */
const COMPANY_KEY = '*';

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
/** Work files are often scanned documents, so they may be larger than chat files */
export const MAX_WORK_FILE_BYTES = 20 * 1024 * 1024;
/** Program files that could harm a computer when opened */
const BLOCKED_EXTENSIONS = /\.(exe|msi|bat|cmd|com|scr|pif|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|hta|cpl|jar|reg|lnk|dll|sys)$/i;
/** Only these are shown inline; everything else is always downloaded */
export const INLINE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

function displayName(name: unknown, username: unknown): string {
  return (name as string | null) ?? (username as string);
}

function mapMessage(r: Row) {
  const deleted = r.DeletedAt !== null && r.DeletedAt !== undefined;
  return {
    messageId: Number(r.MessageId),
    conversationId: r.ConversationId as number,
    senderUserId: r.SenderUserId as number,
    senderName: displayName(r.SenderName, r.SenderUsername),
    body: deleted ? '' : (r.Body as string),
    createdAt: toIso(r.CreatedAt),
    editedAt: toIso(r.EditedAt),
    deleted,
    attachment:
      deleted || r.AttachmentId === null || r.AttachmentId === undefined
        ? null
        : {
            attachmentId: r.AttachmentId as number,
            fileName: r.FileName as string,
            contentType: r.ContentType as string,
            size: r.SizeBytes as number,
          },
  };
}
export type ChatMessage = ReturnType<typeof mapMessage>;

function previewText(r: Row): string {
  if (r.LastDeletedAt) return 'Message deleted';
  if (r.LastBody) return r.LastBody as string;
  return r.LastFileName ? `📎 ${r.LastFileName}` : '';
}

function mapConversation(r: Row) {
  const kind = r.Kind as ConversationKind;
  return {
    conversationId: r.ConversationId as number,
    kind,
    title: kind === 'Company' ? 'Everyone' : kind === 'Group' ? (r.Title as string) : displayName(r.OtherName, r.OtherUsername),
    createdByUserId: (r.CreatedByUserId as number | null) ?? null,
    memberCount: Number(r.MemberCount ?? 0),
    otherUserId: (r.OtherUserId as number | null) ?? null,
    otherRole: (r.OtherRole as Role | null) ?? null,
    otherActive: r.OtherActive === null || r.OtherActive === undefined ? null : Boolean(r.OtherActive),
    unread: Number(r.Unread ?? 0),
    lastReadMessageId: Number(r.LastReadMessageId ?? 0),
    lastMessage:
      r.LastMessageId === null || r.LastMessageId === undefined
        ? null
        : {
            messageId: Number(r.LastMessageId),
            body: previewText(r),
            senderUserId: r.LastSenderId as number,
            createdAt: toIso(r.LastCreatedAt),
          },
  };
}
export type ChatConversation = ReturnType<typeof mapConversation>;

const CONVERSATION_SELECT = `
  SELECT c.ConversationId, c.Kind, c.Title, c.CreatedByUserId, m.LastReadMessageId,
         (SELECT COUNT(*) FROM dbo.ChatMembers mc WHERE mc.ConversationId = c.ConversationId) AS MemberCount,
         o.UserId AS OtherUserId, ou.Username AS OtherUsername, oe.EmployeeName AS OtherName,
         ou.Role AS OtherRole, ou.IsActive AS OtherActive,
         lm.MessageId AS LastMessageId, lm.Body AS LastBody, lm.SenderUserId AS LastSenderId,
         lm.CreatedAt AS LastCreatedAt, lm.DeletedAt AS LastDeletedAt, la.FileName AS LastFileName,
         (SELECT COUNT(*) FROM dbo.ChatMessages x
          WHERE x.ConversationId = c.ConversationId AND x.MessageId > m.LastReadMessageId
            AND x.SenderUserId <> @me AND x.DeletedAt IS NULL) AS Unread
  FROM dbo.ChatMembers m
  JOIN dbo.ChatConversations c ON c.ConversationId = m.ConversationId
  LEFT JOIN dbo.ChatMembers o ON c.Kind = 'Direct' AND o.ConversationId = c.ConversationId AND o.UserId <> @me
  LEFT JOIN dbo.Users ou ON ou.UserId = o.UserId
  LEFT JOIN dbo.Employees oe ON oe.EmployeeId = ou.EmployeeId
  LEFT JOIN LATERAL (SELECT MessageId, Body, SenderUserId, CreatedAt, DeletedAt FROM dbo.ChatMessages
                     WHERE ConversationId = c.ConversationId ORDER BY MessageId DESC LIMIT 1) lm ON true
  LEFT JOIN dbo.ChatAttachments la ON la.MessageId = lm.MessageId`;

const MESSAGE_SELECT = `
  SELECT x.MessageId, x.ConversationId, x.SenderUserId, x.Body, x.CreatedAt, x.EditedAt, x.DeletedAt,
         su.Username AS SenderUsername, se.EmployeeName AS SenderName,
         a.AttachmentId, a.FileName, a.ContentType, a.SizeBytes
  FROM dbo.ChatMessages x
  JOIN dbo.Users su ON su.UserId = x.SenderUserId
  LEFT JOIN dbo.Employees se ON se.EmployeeId = su.EmployeeId
  LEFT JOIN dbo.ChatAttachments a ON a.MessageId = x.MessageId`;

/** Creates the company conversation if needed and makes the user a member of it. Returns its id. */
async function ensureCompanyConversation(actor: AuthUser): Promise<number> {
  // ON CONFLICT: two requests may try to create the conversation (or membership) at the same moment
  const r = await query(
    `INSERT INTO dbo.ChatConversations (Kind, DirectKey) VALUES ('Company', @key)
       ON CONFLICT (DirectKey) WHERE DirectKey IS NOT NULL DO NOTHING;
     INSERT INTO dbo.ChatMembers (ConversationId, UserId)
       SELECT ConversationId, @me FROM dbo.ChatConversations WHERE DirectKey = @key
       ON CONFLICT DO NOTHING;
     SELECT ConversationId FROM dbo.ChatConversations WHERE DirectKey = @key;`,
    { key: [sql.NVarChar(30), COMPANY_KEY], me: [sql.Int, actor.userId] },
  );
  return r.recordset[0].ConversationId as number;
}

interface Access {
  kind: ConversationKind;
  createdByUserId: number | null;
  memberIds: number[];
}

/** Checks that the user may use the conversation and returns its kind and members. */
async function access(actor: AuthUser, conversationId: number): Promise<Access> {
  const r = await query(
    `SELECT c.Kind, c.CreatedByUserId FROM dbo.ChatConversations c WHERE c.ConversationId = @id;
     SELECT UserId FROM dbo.ChatMembers WHERE ConversationId = @id;`,
    { id: [sql.Int, conversationId] },
  );
  const sets = r.recordsets as unknown as Row[][];
  const conv = sets[0][0];
  if (!conv) throw notFound('Conversation');
  const kind = conv.Kind as ConversationKind;
  const memberIds = sets[1].map((m) => m.UserId as number);
  if (!memberIds.includes(actor.userId)) {
    // Everyone belongs to the company conversation; never reveal other people's chats
    if (kind !== 'Company') throw notFound('Conversation');
    await ensureCompanyConversation(actor);
    memberIds.push(actor.userId);
  }
  return { kind, createdByUserId: (conv.CreatedByUserId as number | null) ?? null, memberIds };
}

/** Who receives live events of a conversation. */
function recipients(a: Access): number[] | 'all' {
  return a.kind === 'Company' ? 'all' : a.memberIds;
}

/** Active users of this company, optionally restricted to the given ids. */
async function activeUserIds(ids: number[]): Promise<number[]> {
  if (!ids.length) return [];
  const r = await query(
    `SELECT u.UserId FROM dbo.Users u LEFT JOIN dbo.Employees e ON e.EmployeeId = u.EmployeeId
     WHERE u.IsActive AND (u.EmployeeId IS NULL OR e.IsActive)
       AND u.UserId = ANY(@ids::int[])`,
    { ids: [sql.Int, ids] },
  );
  return r.recordset.map((u) => u.UserId as number);
}

/** Other active users of this company that can be messaged. */
export async function listChatUsers(actor: AuthUser) {
  const r = await query(
    `SELECT u.UserId, u.Username, u.Role, e.EmployeeName
     FROM dbo.Users u LEFT JOIN dbo.Employees e ON e.EmployeeId = u.EmployeeId
     WHERE u.IsActive AND (u.EmployeeId IS NULL OR e.IsActive) AND u.UserId <> @me
     ORDER BY COALESCE(e.EmployeeName, u.Username)`,
    { me: [sql.Int, actor.userId] },
  );
  return r.recordset.map((u) => ({
    userId: u.UserId as number,
    name: displayName(u.EmployeeName, u.Username),
    username: u.Username as string,
    role: u.Role as Role,
  }));
}

export async function listConversations(actor: AuthUser) {
  await ensureCompanyConversation(actor);
  const r = await query(
    `${CONVERSATION_SELECT}
     WHERE m.UserId = @me
       -- a new direct chat shows up for the other person once it has a message
       AND (c.Kind <> 'Direct' OR c.LastMessageAt IS NOT NULL OR c.CreatedByUserId = @me)
     ORDER BY CASE WHEN c.Kind = 'Company' THEN 0 ELSE 1 END, COALESCE(c.LastMessageAt, c.CreatedAt) DESC`,
    { me: [sql.Int, actor.userId] },
  );
  return r.recordset.map(mapConversation);
}

export async function getConversation(actor: AuthUser, conversationId: number) {
  await access(actor, conversationId);
  const r = await query(`${CONVERSATION_SELECT} WHERE m.UserId = @me AND c.ConversationId = @id`, {
    me: [sql.Int, actor.userId],
    id: [sql.Int, conversationId],
  });
  return mapConversation(r.recordset[0]);
}

/** Returns the direct conversation with another user, creating it on first use. */
export async function openDirect(actor: AuthUser, otherUserId: number) {
  if (otherUserId === actor.userId) throw badRequest('You cannot start a chat with yourself.');
  if (!(await activeUserIds([otherUserId])).length) throw badRequest('This user does not exist or is inactive.');

  const key = `${Math.min(actor.userId, otherUserId)}:${Math.max(actor.userId, otherUserId)}`;
  // One statement, so the conversation and both memberships are created together (or not at all)
  const r = await query(
    `WITH created AS (
       INSERT INTO dbo.ChatConversations (Kind, DirectKey, CreatedByUserId) VALUES ('Direct', @key, @me)
       ON CONFLICT (DirectKey) WHERE DirectKey IS NOT NULL DO NOTHING
       RETURNING ConversationId
     )
     INSERT INTO dbo.ChatMembers (ConversationId, UserId)
       SELECT created.ConversationId, m.UserId FROM created, unnest(ARRAY[@me::int, @other::int]) AS m(UserId);
     SELECT ConversationId FROM dbo.ChatConversations WHERE DirectKey = @key;`,
    { key: [sql.NVarChar(30), key], me: [sql.Int, actor.userId], other: [sql.Int, otherUserId] },
  );
  return getConversation(actor, r.recordset[0].ConversationId as number);
}

// ---------------------------------------------------------------- groups

/** The group's creator and company administrators manage a group. */
function assertCanManage(actor: AuthUser, a: Access) {
  if (a.kind !== 'Group') throw badRequest('Only groups can be changed.');
  if (a.createdByUserId !== actor.userId && actor.role !== 'Admin') {
    throw forbidden('Only the person who created this group or an administrator can change it.');
  }
}

export async function createGroup(actor: AuthUser, title: string, memberIds: number[]) {
  const members = await activeUserIds([...new Set(memberIds.filter((id) => id !== actor.userId))]);
  if (!members.length) throw badRequest('Add at least one other person to the group.');
  const r = await query(
    `WITH created AS (
       INSERT INTO dbo.ChatConversations (Kind, Title, CreatedByUserId) VALUES ('Group', @title, @me)
       RETURNING ConversationId
     ), joined AS (
       INSERT INTO dbo.ChatMembers (ConversationId, UserId)
       SELECT created.ConversationId, m.UserId FROM created, unnest(@ids::int[]) AS m(UserId)
     )
     SELECT ConversationId FROM created`,
    {
      title: [sql.NVarChar(100), title],
      me: [sql.Int, actor.userId],
      ids: [sql.Int, [actor.userId, ...members]],
    },
  );
  const id = r.recordset[0].ConversationId as number;
  publish(actor.clientId, [actor.userId, ...members], 'conversation', { conversationId: id });
  return getConversation(actor, id);
}

export async function renameGroup(actor: AuthUser, conversationId: number, title: string) {
  const a = await access(actor, conversationId);
  assertCanManage(actor, a);
  await query(`UPDATE dbo.ChatConversations SET Title = @title WHERE ConversationId = @id`, {
    id: [sql.Int, conversationId],
    title: [sql.NVarChar(100), title],
  });
  publish(actor.clientId, a.memberIds, 'conversation', { conversationId });
  return getConversation(actor, conversationId);
}

export async function listMembers(actor: AuthUser, conversationId: number) {
  const a = await access(actor, conversationId);
  const r = await query(
    `SELECT u.UserId, u.Username, u.Role, u.IsActive, e.EmployeeName
     FROM dbo.ChatMembers m JOIN dbo.Users u ON u.UserId = m.UserId
     LEFT JOIN dbo.Employees e ON e.EmployeeId = u.EmployeeId
     WHERE m.ConversationId = @id
     ORDER BY COALESCE(e.EmployeeName, u.Username)`,
    { id: [sql.Int, conversationId] },
  );
  return r.recordset.map((u) => ({
    userId: u.UserId as number,
    name: displayName(u.EmployeeName, u.Username),
    role: u.Role as Role,
    isActive: Boolean(u.IsActive),
    isCreator: u.UserId === a.createdByUserId,
  }));
}

export async function addMembers(actor: AuthUser, conversationId: number, userIds: number[]) {
  const a = await access(actor, conversationId);
  assertCanManage(actor, a);
  const added = (await activeUserIds(userIds)).filter((id) => !a.memberIds.includes(id));
  if (added.length) {
    // New members start at the latest message: earlier history is readable but not "unread"
    await query(
      `INSERT INTO dbo.ChatMembers (ConversationId, UserId, LastReadMessageId)
       SELECT @id, m.UserId, COALESCE((SELECT MAX(MessageId) FROM dbo.ChatMessages WHERE ConversationId = @id), 0)
       FROM unnest(@ids::int[]) AS m(UserId)
       ON CONFLICT DO NOTHING`,
      { id: [sql.Int, conversationId], ids: [sql.Int, added] },
    );
  }
  publish(actor.clientId, [...a.memberIds, ...added], 'conversation', { conversationId });
  return listMembers(actor, conversationId);
}

/** Removes a member; removing yourself means leaving the group. */
export async function removeMember(actor: AuthUser, conversationId: number, userId: number) {
  const a = await access(actor, conversationId);
  if (userId !== actor.userId) assertCanManage(actor, a);
  else if (a.kind !== 'Group') throw badRequest('You can only leave groups.');
  await query(`DELETE FROM dbo.ChatMembers WHERE ConversationId = @id AND UserId = @user`, {
    id: [sql.Int, conversationId],
    user: [sql.Int, userId],
  });
  publish(actor.clientId, a.memberIds, 'conversation', { conversationId });
}

// ---------------------------------------------------------------- messages

interface MessageWindow {
  before?: number | null;
  after?: number | null;
  /** Load the messages around this one (used when jumping to a search result) */
  around?: number | null;
  limit: number;
}

/** Messages oldest-first. `hasMore`: older messages exist; `hasNewer`: newer messages exist. */
export async function getMessages(actor: AuthUser, conversationId: number, w: MessageWindow) {
  await access(actor, conversationId);
  const base: Params = { id: [sql.Int, conversationId] };
  const older = async (beforeId: number | null, limit: number) => {
    const r = await query(
      `SELECT * FROM (${MESSAGE_SELECT}
         WHERE x.ConversationId = @id AND (@before::bigint IS NULL OR x.MessageId < @before)) t
       ORDER BY t.MessageId DESC
       LIMIT @limit`,
      { ...base, before: [sql.BigInt, beforeId], limit: [sql.Int, limit + 1] },
    );
    return { rows: r.recordset.slice(0, limit).reverse(), more: r.recordset.length > limit };
  };
  const newer = async (afterId: number, limit: number) => {
    const r = await query(
      `SELECT * FROM (${MESSAGE_SELECT}
         WHERE x.ConversationId = @id AND x.MessageId > @after) t
       ORDER BY t.MessageId ASC
       LIMIT @limit`,
      { ...base, after: [sql.BigInt, afterId], limit: [sql.Int, limit + 1] },
    );
    return { rows: r.recordset.slice(0, limit), more: r.recordset.length > limit };
  };

  if (w.around) {
    const half = Math.max(5, Math.floor(w.limit / 2));
    const [o, n] = await Promise.all([older(w.around + 1, half), newer(w.around, half)]);
    return { items: [...o.rows, ...n.rows].map(mapMessage), hasMore: o.more, hasNewer: n.more };
  }
  if (w.after) {
    const n = await newer(w.after, w.limit);
    return { items: n.rows.map(mapMessage), hasMore: true, hasNewer: n.more };
  }
  const o = await older(w.before ?? null, w.limit);
  return { items: o.rows.map(mapMessage), hasMore: o.more, hasNewer: false };
}

async function loadMessage(messageId: number) {
  const r = await query(`${MESSAGE_SELECT} WHERE x.MessageId = @mid`, { mid: [sql.BigInt, messageId] });
  return r.recordset[0] as Row | undefined;
}

export interface NewAttachment {
  fileName: string;
  contentType: string;
  content: Buffer;
}

/** Validates an uploaded file and returns safe values to store. */
export function checkAttachment(fileName: string, contentType: string, content: Buffer, maxBytes = MAX_ATTACHMENT_BYTES): NewAttachment {
  const name = fileName.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().slice(-255);
  if (!name) throw badRequest('The file needs a name.');
  if (!content.length) throw badRequest('The file is empty.');
  if (content.length > maxBytes) throw badRequest(`Files can be at most ${Math.round(maxBytes / 1024 / 1024)} MB.`);
  if (BLOCKED_EXTENSIONS.test(name)) throw badRequest('Program files (such as .exe or .bat) cannot be sent.');
  const type = /^[\w.+-]+\/[\w.+-]+$/.test(contentType) && contentType.length <= 100 ? contentType.toLowerCase() : 'application/octet-stream';
  return { fileName: name, contentType: type, content };
}

export async function sendMessage(actor: AuthUser, conversationId: number, body: string, attachment?: NewAttachment) {
  const a = await access(actor, conversationId);
  if (!body && !attachment) throw badRequest('Type a message');
  if (a.kind === 'Direct') {
    const other = a.memberIds.find((id) => id !== actor.userId);
    if (other && !(await activeUserIds([other])).length) throw badRequest('This user is inactive and cannot receive messages.');
  }
  const messageId = await withTransaction(async (tx) => {
    const r = await query(
      `INSERT INTO dbo.ChatMessages (ConversationId, SenderUserId, Body) VALUES (@id, @me, @body) RETURNING MessageId`,
      { id: [sql.Int, conversationId], me: [sql.Int, actor.userId], body: [sql.NVarChar(2000), body] },
      tx,
    );
    const mid = Number(r.recordset[0].MessageId);
    if (attachment) {
      await query(
        `INSERT INTO dbo.ChatAttachments (MessageId, FileName, ContentType, SizeBytes, Content)
         VALUES (@mid, @fileName, @contentType, @size, @content)`,
        {
          mid: [sql.BigInt, mid],
          size: [sql.Int, attachment.content.length],
          fileName: [sql.NVarChar(255), attachment.fileName],
          contentType: [sql.NVarChar(100), attachment.contentType],
          content: [sql.VarBinary(sql.MAX), attachment.content],
        },
        tx,
      );
    }
    await query(
      `UPDATE dbo.ChatConversations SET LastMessageAt = now() WHERE ConversationId = @id;
       UPDATE dbo.ChatMembers SET LastReadMessageId = @mid WHERE ConversationId = @id AND UserId = @me;`,
      { id: [sql.Int, conversationId], me: [sql.Int, actor.userId], mid: [sql.BigInt, mid] },
      tx,
    );
    return mid;
  });
  const message = mapMessage((await loadMessage(messageId))!);
  publish(actor.clientId, recipients(a), 'message', { ...message, kind: a.kind });
  return message;
}

/** Loads a message the user can see, with the conversation's access info. */
async function ownMessage(actor: AuthUser, messageId: number) {
  const row = await loadMessage(messageId);
  if (!row) throw notFound('Message');
  const a = await access(actor, row.ConversationId as number);
  if (row.DeletedAt) throw badRequest('This message was deleted.');
  return { row, a };
}

export async function editMessage(actor: AuthUser, messageId: number, body: string) {
  const { row, a } = await ownMessage(actor, messageId);
  if (row.SenderUserId !== actor.userId) throw forbidden('You can only edit your own messages.');
  if (!body && row.AttachmentId === null) throw badRequest('Type a message');
  await query(`UPDATE dbo.ChatMessages SET Body = @body, EditedAt = now() WHERE MessageId = @mid`, {
    mid: [sql.BigInt, messageId],
    body: [sql.NVarChar(2000), body],
  });
  const message = mapMessage((await loadMessage(messageId))!);
  publish(actor.clientId, recipients(a), 'message-updated', message);
  return message;
}

/** Senders delete their own messages; administrators can delete any message (moderation). */
export async function deleteMessage(actor: AuthUser, messageId: number) {
  const { row, a } = await ownMessage(actor, messageId);
  if (row.SenderUserId !== actor.userId && actor.role !== 'Admin') throw forbidden('You can only delete your own messages.');
  await query(
    `UPDATE dbo.ChatMessages SET Body = '', DeletedAt = now() WHERE MessageId = @mid;
     UPDATE dbo.ChatAttachments SET Content = NULL WHERE MessageId = @mid;`,
    { mid: [sql.BigInt, messageId] },
  );
  const message = mapMessage((await loadMessage(messageId))!);
  publish(actor.clientId, recipients(a), 'message-updated', message);
  return message;
}

export async function getAttachment(actor: AuthUser, attachmentId: number) {
  const r = await query(
    `SELECT a.FileName, a.ContentType, a.Content, x.ConversationId, x.DeletedAt
     FROM dbo.ChatAttachments a JOIN dbo.ChatMessages x ON x.MessageId = a.MessageId
     WHERE a.AttachmentId = @aid`,
    { aid: [sql.Int, attachmentId] },
  );
  const row = r.recordset[0];
  if (!row) throw notFound('File');
  await access(actor, row.ConversationId as number);
  if (row.DeletedAt || !row.Content) throw notFound('File');
  const contentType = row.ContentType as string;
  return {
    fileName: row.FileName as string,
    contentType,
    inline: INLINE_TYPES.has(contentType),
    content: row.Content as Buffer,
  };
}

export async function markRead(actor: AuthUser, conversationId: number, messageId: number) {
  await access(actor, conversationId);
  await query(
    `UPDATE dbo.ChatMembers SET LastReadMessageId = @mid
     WHERE ConversationId = @id AND UserId = @me AND LastReadMessageId < @mid`,
    { id: [sql.Int, conversationId], me: [sql.Int, actor.userId], mid: [sql.BigInt, messageId] },
  );
  // Other open tabs of the same user update their unread badges
  publish(actor.clientId, [actor.userId], 'read', { conversationId, messageId });
  return { unread: await unreadTotal(actor) };
}

export async function unreadTotal(actor: AuthUser): Promise<number> {
  await ensureCompanyConversation(actor);
  const r = await query(
    `SELECT COUNT(*) AS Unread
     FROM dbo.ChatMembers m
     JOIN dbo.ChatMessages x ON x.ConversationId = m.ConversationId AND x.MessageId > m.LastReadMessageId
                             AND x.SenderUserId <> @me AND x.DeletedAt IS NULL
     WHERE m.UserId = @me`,
    { me: [sql.Int, actor.userId] },
  );
  return Number(r.recordset[0].Unread);
}

/** Searches message text and file names in the user's own conversations, newest first. */
export async function search(actor: AuthUser, term: string) {
  await ensureCompanyConversation(actor);
  const r = await query(
    `SELECT t.*, c.Kind, c.Title,
            (SELECT COALESCE(oe.EmployeeName, ou.Username)
             FROM dbo.ChatMembers o JOIN dbo.Users ou ON ou.UserId = o.UserId
             LEFT JOIN dbo.Employees oe ON oe.EmployeeId = ou.EmployeeId
             WHERE c.Kind = 'Direct' AND o.ConversationId = c.ConversationId AND o.UserId <> @me
             LIMIT 1) AS OtherName
     FROM (${MESSAGE_SELECT} WHERE x.DeletedAt IS NULL AND (x.Body ILIKE @q OR a.FileName ILIKE @q)) t
     JOIN dbo.ChatConversations c ON c.ConversationId = t.ConversationId
     JOIN dbo.ChatMembers m ON m.ConversationId = c.ConversationId AND m.UserId = @me
     ORDER BY t.MessageId DESC
     LIMIT 50`,
    { me: [sql.Int, actor.userId], q: likeParam(term) },
  );
  return r.recordset.map((row) => {
    const kind = row.Kind as ConversationKind;
    return {
      message: mapMessage(row),
      kind,
      conversationTitle: kind === 'Company' ? 'Everyone' : kind === 'Group' ? (row.Title as string) : (row.OtherName as string),
    };
  });
}
