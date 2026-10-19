// Chat test. Run after smoke.mjs (and optionally multi-client.mjs) against the same database:
//   node tests/chat.mjs http://127.0.0.1:3100 SMOKE [NEWCO]
const BASE = process.argv[2] ?? 'http://127.0.0.1:3100';
const CLIENT = process.argv[3] ?? 'SMOKE';
const OTHER_CLIENT = process.argv[4];
let passed = 0;
let failed = 0;

function client() {
  const c = async function call(method, path, body) {
    const headers = { Accept: 'application/json', 'X-Requested-With': 'WorkDone' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (c.cookie) headers.Cookie = c.cookie;
    const res = await fetch(BASE + '/api' + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    const m = res.headers.get('set-cookie')?.match(/wd_session=([^;]*)/);
    if (m) c.cookie = m[1] ? `wd_session=${m[1]}` : '';
    let data = null;
    try { data = await res.json(); } catch {}
    return { status: res.status, data };
  };
  c.cookie = '';
  return c;
}

function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ok   ', name); }
  else { failed++; console.log('  FAIL ', name, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); }
}

/** Opens the live event stream and collects events until closed. */
async function stream(c) {
  const controller = new AbortController();
  const res = await fetch(BASE + '/api/chat/events', { headers: { Cookie: c.cookie }, signal: controller.signal });
  const events = [];
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let i;
        while ((i = buffer.indexOf('\n\n')) >= 0) {
          const chunk = buffer.slice(0, i);
          buffer = buffer.slice(i + 2);
          const event = chunk.match(/^event: (.*)$/m)?.[1];
          const data = chunk.match(/^data: (.*)$/m)?.[1];
          if (event && data) events.push({ event, data: JSON.parse(data) });
        }
      }
    } catch {}
  })();
  return { status: res.status, type: res.headers.get('content-type'), events, close: () => controller.abort() };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function login(u, p, clientId = CLIENT) {
  const c = client();
  const r = await c('POST', '/auth/login', { clientId, username: u, password: p });
  check(`${u} signs in`, r.status === 200, r.data);
  return c;
}

console.log('# setup');
const admin = await login('admin', 'NewAdmin2026');
const manager = await login('manager1', 'Manager123X');
const priya = await login('priya', 'Employee123X');
const anon = client();
let r = await anon('GET', '/chat/conversations');
check('chat needs sign-in', r.status === 401, r.data);

console.log('# everyone conversation');
r = await manager('GET', '/chat/conversations');
const everyone = r.data.items?.find((c) => c.kind === 'Company');
check('Everyone conversation listed first', r.status === 200 && r.data.items[0]?.kind === 'Company' && everyone.title === 'Everyone', r.data);
const managerLive = await stream(manager);
check('event stream opens', managerLive.status === 200 && /text\/event-stream/.test(managerLive.type), managerLive);
r = await priya('POST', `/chat/conversations/${everyone.conversationId}/messages`, { body: '  Hello team  ' });
check('employee posts to Everyone', r.status === 201 && r.data.body === 'Hello team', r.data);
const firstId = r.data.messageId;
await wait(400);
check('manager receives it live', managerLive.events.some((e) => e.event === 'message' && e.data.messageId === firstId), managerLive.events);
r = await manager('GET', '/chat/unread');
check('manager has 1 unread', r.data.unread === 1, r.data);
r = await priya('GET', '/chat/unread');
check('sender has no unread', r.data.unread === 0, r.data);
r = await manager('POST', `/chat/conversations/${everyone.conversationId}/read`, { messageId: firstId });
check('mark read -> 0 unread', r.status === 200 && r.data.unread === 0, r.data);
r = await admin('GET', `/chat/conversations/${everyone.conversationId}/messages`);
check('admin reads Everyone history', r.status === 200 && r.data.items.some((m) => m.messageId === firstId && m.senderName), r.data);

console.log('# validation');
r = await priya('POST', `/chat/conversations/${everyone.conversationId}/messages`, { body: '   ' });
check('empty message rejected', r.status === 400, r.data);
r = await priya('POST', `/chat/conversations/${everyone.conversationId}/messages`, { body: 'x'.repeat(2001) });
check('too long message rejected', r.status === 400, r.data);
r = await fetch(BASE + `/api/chat/conversations/${everyone.conversationId}/messages`, {
  method: 'POST',
  headers: { Cookie: priya.cookie, 'Content-Type': 'application/json' },
  body: JSON.stringify({ body: 'x' }),
});
check('send without CSRF header blocked', r.status === 403, r.status);

console.log('# direct conversation');
r = await manager('GET', '/chat/users');
const priyaUser = r.data.items?.find((u) => u.username === 'priya');
check('people list excludes self and inactive users', r.status === 200 && priyaUser && !r.data.items.some((u) => u.username === 'manager1' || u.username === 'amit'), r.data);
r = await manager('POST', '/chat/direct', { userId: priyaUser.userId });
const direct = r.data;
check('open direct chat', r.status === 200 && direct.kind === 'Direct' && direct.title, r.data);
r = await manager('POST', '/chat/direct', { userId: priyaUser.userId });
check('same pair -> same conversation', r.data.conversationId === direct.conversationId, r.data);
r = await priya('GET', '/chat/conversations');
check('empty direct chat not shown to the other person yet', !r.data.items.some((c) => c.conversationId === direct.conversationId), r.data);
const priyaLive = await stream(priya);
const adminLive = await stream(admin);
r = await manager('POST', `/chat/conversations/${direct.conversationId}/messages`, { body: 'Please check WD-000001' });
check('manager sends direct message', r.status === 201, r.data);
const directId = r.data.messageId;
await wait(400);
check('priya receives it live', priyaLive.events.some((e) => e.data.messageId === directId), priyaLive.events);
check('admin does not receive the direct message', !adminLive.events.some((e) => e.data.messageId === directId), adminLive.events);
r = await priya('GET', '/chat/conversations');
const priyaDirect = r.data.items.find((c) => c.conversationId === direct.conversationId);
check('priya sees the chat with 1 unread', priyaDirect?.unread === 1 && priyaDirect.lastMessage?.body === 'Please check WD-000001', r.data);
r = await admin('GET', `/chat/conversations/${direct.conversationId}/messages`);
check('outsider cannot read a direct chat (404)', r.status === 404, r.data);
r = await admin('POST', `/chat/conversations/${direct.conversationId}/messages`, { body: 'intrude' });
check('outsider cannot post to a direct chat (404)', r.status === 404, r.data);
r = await manager('POST', '/chat/direct', { userId: 999999 });
check('chat with unknown user rejected', r.status === 400, r.data);

console.log('# paging');
for (let i = 0; i < 5; i++) await priya('POST', `/chat/conversations/${direct.conversationId}/messages`, { body: `reply ${i}` });
r = await manager('GET', `/chat/conversations/${direct.conversationId}/messages?limit=3`);
check('latest page, oldest first', r.data.items.length === 3 && r.data.hasMore && r.data.items[2].body === 'reply 4', r.data);
r = await manager('GET', `/chat/conversations/${direct.conversationId}/messages?limit=3&before=${r.data.items[0].messageId}`);
check('earlier page', r.data.items.length === 3 && r.data.items[2].body === 'reply 1', r.data);

console.log('# groups');
r = await manager('GET', '/chat/users');
const adminUser = r.data.items.find((u) => u.username === 'admin');
r = await manager('POST', '/chat/groups', { title: 'x', memberIds: [] });
check('group needs members', r.status === 400, r.data);
r = await manager('POST', '/chat/groups', { title: 'Accounts team', memberIds: [priyaUser.userId] });
const group = r.data;
check('create group', r.status === 201 && group.kind === 'Group' && group.title === 'Accounts team' && group.memberCount === 2, r.data);
await wait(400);
check('member is told about the new group live', priyaLive.events.some((e) => e.event === 'conversation' && e.data.conversationId === group.conversationId), priyaLive.events);
r = await priya('GET', '/chat/conversations');
check('group listed for member', r.data.items.some((c) => c.conversationId === group.conversationId), r.data);
r = await admin('GET', `/chat/conversations/${group.conversationId}/messages`);
check('non-member cannot read group (404)', r.status === 404, r.data);
r = await priya('PATCH', `/chat/groups/${group.conversationId}`, { title: 'Hijack' });
check('member who is not the creator cannot rename', r.status === 403, r.data);
r = await manager('PATCH', `/chat/groups/${group.conversationId}`, { title: 'Accounts' });
check('creator renames group', r.status === 200 && r.data.title === 'Accounts', r.data);
r = await manager('POST', `/chat/groups/${group.conversationId}/members`, { userIds: [adminUser.userId] });
check('creator adds a member', r.status === 200 && r.data.items.length === 3, r.data);
r = await admin('GET', `/chat/conversations/${group.conversationId}/messages`);
check('added member can read the group', r.status === 200, r.data);
r = await priya('DELETE', `/chat/groups/${group.conversationId}/members/${adminUser.userId}`);
check('member cannot remove others', r.status === 403, r.data);
r = await priya('DELETE', `/chat/groups/${group.conversationId}/members/${priyaUser.userId}`);
check('member leaves the group', r.status === 204, r.data);
r = await priya('GET', `/chat/conversations/${group.conversationId}/messages`);
check('after leaving the group is hidden', r.status === 404, r.data);
r = await manager('DELETE', `/chat/groups/${everyone.conversationId}/members/${priyaUser.userId}`);
check('Everyone is not a group that can be changed', r.status === 400, r.data);

console.log('# attachments');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
async function upload(c, conversationId, name, type, data, { caption = '', csrf = true } = {}) {
  const headers = {
    Cookie: c.cookie,
    'Content-Type': 'application/octet-stream',
    'X-File-Name': encodeURIComponent(name),
    'X-File-Type': encodeURIComponent(type),
    'X-Caption': encodeURIComponent(caption),
  };
  if (csrf) headers['X-Requested-With'] = 'WorkDone';
  const res = await fetch(BASE + `/api/chat/conversations/${conversationId}/attachments`, { method: 'POST', headers, body: data });
  let body = null;
  try { body = await res.json(); } catch {}
  return { status: res.status, data: body };
}
async function download(c, id, query = '') {
  const res = await fetch(BASE + `/api/chat/attachments/${id}${query}`, { headers: { Cookie: c.cookie } });
  return { status: res.status, type: res.headers.get('content-type'), disposition: res.headers.get('content-disposition'), bytes: Buffer.from(await res.arrayBuffer()) };
}
r = await upload(manager, direct.conversationId, 'pixel.png', 'image/png', PNG, { caption: 'see image' });
const image = r.data;
check('send an image with caption', r.status === 201 && image.attachment?.contentType === 'image/png' && image.body === 'see image', r.data);
let d = await download(priya, image.attachment.attachmentId);
check('member downloads the image (shown inline)', d.status === 200 && d.type === 'image/png' && /^inline/.test(d.disposition) && d.bytes.equals(PNG), d);
d = await download(admin, image.attachment.attachmentId);
check('outsider cannot download (404)', d.status === 404, d.status);
r = await upload(manager, direct.conversationId, 'Report März.pdf', 'application/pdf', Buffer.from('%PDF-1.4 test'));
const pdf = r.data;
check('send a PDF', r.status === 201 && pdf.attachment.fileName === 'Report März.pdf' && pdf.body === '', r.data);
d = await download(priya, pdf.attachment.attachmentId);
check('other files are always downloaded, never rendered', d.status === 200 && d.type === 'application/octet-stream' && /^attachment/.test(d.disposition) && /UTF-8''Report%20M%C3%A4rz\.pdf/.test(d.disposition), d);
r = await upload(manager, direct.conversationId, 'data.json', 'application/json', Buffer.from('{"a":1}'));
check('JSON file is stored as a file', r.status === 201 && r.data.attachment.contentType === 'application/json', r.data);
r = await upload(manager, direct.conversationId, 'setup.exe', 'application/octet-stream', Buffer.from('MZ'));
check('program files are blocked', r.status === 400, r.data);
r = await upload(manager, direct.conversationId, 'empty.txt', 'text/plain', Buffer.alloc(0));
check('empty file rejected', r.status === 400, r.data);
r = await upload(manager, direct.conversationId, 'big.bin', 'application/octet-stream', Buffer.alloc(10 * 1024 * 1024 + 10));
check('file over 10 MB rejected', r.status === 413, r.status);
r = await upload(manager, direct.conversationId, 'pixel.png', 'image/png', PNG, { csrf: false });
check('upload without CSRF header blocked', r.status === 403, r.status);
r = await upload(admin, direct.conversationId, 'pixel.png', 'image/png', PNG);
check('outsider cannot upload to a direct chat', r.status === 404, r.data);

console.log('# edit & delete');
r = await priya('POST', `/chat/conversations/${direct.conversationId}/messages`, { body: 'tpyo' });
const typo = r.data;
r = await manager('PATCH', `/chat/messages/${typo.messageId}`, { body: 'not mine' });
check("cannot edit someone else's message", r.status === 403, r.data);
r = await priya('PATCH', `/chat/messages/${typo.messageId}`, { body: 'typo fixed' });
check('edit own message', r.status === 200 && r.data.body === 'typo fixed' && r.data.editedAt, r.data);
await wait(400);
check('edit is pushed live', managerLive.events.some((e) => e.event === 'message-updated' && e.data.body === 'typo fixed'), managerLive.events);
r = await manager('DELETE', `/chat/messages/${typo.messageId}`);
check("non-admin cannot delete someone else's message", r.status === 403, r.data);
r = await priya('POST', `/chat/conversations/${everyone.conversationId}/messages`, { body: 'secret to delete' });
const toDelete = r.data;
r = await admin('DELETE', `/chat/messages/${toDelete.messageId}`);
check('admin deletes any message in a chat they belong to', r.status === 200 && r.data.deleted && r.data.body === '', r.data);
r = await priya('PATCH', `/chat/messages/${toDelete.messageId}`, { body: 'again' });
check('deleted message cannot be edited', r.status === 400, r.data);
r = await priya('DELETE', `/chat/messages/${typo.messageId}`);
check('delete own message', r.status === 200 && r.data.deleted, r.data);
r = await manager('DELETE', `/chat/messages/${pdf.messageId}`);
d = await download(priya, pdf.attachment.attachmentId);
check('file of a deleted message is gone', r.status === 200 && d.status === 404, d.status);

console.log('# search');
r = await priya('POST', `/chat/conversations/${direct.conversationId}/messages`, { body: 'quarterly budget numbers attached' });
const budget = r.data;
r = await manager('GET', '/chat/search?q=BUDGET');
check('search finds message text (any case)', r.status === 200 && r.data.items.some((x) => x.message.messageId === budget.messageId && x.conversationTitle), r.data);
r = await admin('GET', '/chat/search?q=budget');
check("search never shows other people's chats", r.status === 200 && !r.data.items.some((x) => x.message.messageId === budget.messageId), r.data);
r = await manager('GET', '/chat/search?q=pixel');
check('search finds file names', r.data.items.some((x) => x.message.attachment?.fileName === 'pixel.png'), r.data);
r = await priya('GET', '/chat/search?q=secret to delete');
check('deleted messages are not found', r.data.items.length === 0, r.data);
r = await manager('GET', '/chat/search?q=a');
check('search needs 2+ characters', r.status === 400, r.data);
r = await manager('GET', `/chat/conversations/${direct.conversationId}/messages?around=${image.messageId}&limit=10`);
check('jump to a message loads the messages around it', r.status === 200 && r.data.items.some((m) => m.messageId === image.messageId) && r.data.items.some((m) => m.messageId === budget.messageId) && r.data.hasMore === true, r.data);

if (OTHER_CLIENT) {
  console.log('# other company');
  const other = await login('admin', 'Newco12345X', OTHER_CLIENT);
  r = await other('GET', '/chat/conversations');
  const otherEveryone = r.data.items?.find((c) => c.kind === 'Company');
  r = await other('GET', `/chat/conversations/${otherEveryone.conversationId}/messages`);
  check('other company does not see these messages', r.status === 200 && !r.data.items.some((m) => m.body === 'Hello team'), r.data);
  r = await other('GET', '/chat/users');
  check('other company people list has none of these users', !r.data.items.some((u) => ['manager1', 'priya'].includes(u.username)), r.data);
  const otherLive = await stream(other);
  await priya('POST', `/chat/conversations/${everyone.conversationId}/messages`, { body: 'only for us' });
  await wait(400);
  check('Everyone message does not reach the other company live', !otherLive.events.some((e) => e.data.body === 'only for us'), otherLive.events);
  otherLive.close();
}

managerLive.close();
priyaLive.close();
adminLive.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
