// Drives the setup wizard API end to end on an EMPTY PostgreSQL database.
// Start the server without DATABASE_URL (it saves the connection string to backend/.env, so back that up first):
//   node tests/setup-wizard.mjs http://127.0.0.1:3100 postgres://user:pass@localhost:5432/empty_db [lanIp]
const BASE = `${process.argv[2] ?? 'http://127.0.0.1:3100'}/api`;
const URL_ = process.argv[3];
const LAN = process.argv[4] ? `http://${process.argv[4]}:${new URL(BASE).port}/api` : null;
const CLIENT = 'TESTCO';
if (!URL_) throw new Error('Pass the connection string of an empty test database.');

let passed = 0;
let failed = 0;
const check = (name, cond, extra) => {
  if (cond) { passed++; console.log('  ok   ', name); }
  else { failed++; console.log('  FAIL ', name, extra !== undefined ? JSON.stringify(extra).slice(0, 600) : ''); }
};
let cookie = '';
async function call(method, path, body, base = BASE) {
  const headers = { 'X-Requested-With': 'WorkDone', Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(base + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const sc = res.headers.get('set-cookie');
  if (sc) { const m = sc.match(/wd_session=([^;]+)/); if (m) cookie = `wd_session=${m[1]}`; }
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

console.log('# database step');
let r = await call('GET', '/health');
check('health reports setup-required', r.data.status === 'setup-required', r.data);
r = await call('GET', '/setup/status');
check('status: needs setup, database step, local', r.data.needsSetup && r.data.step === 'database' && r.data.isLocal && r.data.onServerComputer, r.data);
r = await call('POST', '/auth/login', { clientId: CLIENT, username: 'x', password: 'y' });
check('login in setup mode -> 503 SETUP_REQUIRED', r.status === 503 && r.data.code === 'SETUP_REQUIRED', r);

if (LAN) {
  r = await call('GET', '/setup/status', undefined, LAN);
  check('other computer: not allowed, no machine details', r.data.isLocal === false && !r.data.environment, r.data);
  r = await call('POST', '/setup/test-connection', { url: URL_ }, LAN);
  check('other computer: test-connection blocked', r.status === 403, r);
}

r = await call('POST', '/setup/test-connection', { url: 'mysql://nope' });
check('non-PostgreSQL string rejected', r.status === 400, r.data);
r = await call('POST', '/setup/test-connection', { url: URL_.replace(/:([^:@/]+)@/, ':wrong-password@') });
check('wrong password explained', r.status === 200 && r.data.ok === false && /password/i.test(r.data.error), r.data);
r = await call('POST', '/setup/test-connection', { url: URL_.replace(/\/[^/?]+(\?|$)/, '/no_such_db$1') });
check('missing database explained', r.data.ok === false && /does not exist/i.test(r.data.error), r.data);
r = await call('POST', '/setup/test-connection', { url: URL_ });
check('test connection ok, may create tables', r.data.ok === true && r.data.canCreate === true && /PostgreSQL/.test(r.data.version), r.data);
r = await call('POST', '/setup/database', { url: URL_ });
check('connect saves settings and creates shared tables', r.status === 200 && r.data.log.length === 3, r.data);
r = await call('GET', '/setup/status');
check('now at the company step', r.data.step === 'admin', r.data);
r = await call('POST', '/setup/database', { url: URL_ });
check('database step closed afterwards', r.status === 403, r.data);

console.log('# company step');
r = await call('POST', '/setup/admin', { companyName: 'Test Co', clientId: 'bad id', username: 'admin', password: 'Admin12345' });
check('invalid Client ID rejected', r.status === 400, r.data);
r = await call('POST', '/setup/admin', { companyName: 'Test Co', clientId: CLIENT.toLowerCase(), username: 'admin', password: 'short' });
check('weak password rejected', r.status === 400, r.data);
r = await call('POST', '/setup/admin', { companyName: 'Test Co', clientId: CLIENT.toLowerCase(), username: 'admin', password: 'Admin12345', loadSampleData: true });
check('company and administrator created', r.status === 201 && r.data.log.some((l) => /Sample/.test(l)), r.data);
r = await call('GET', '/setup/status');
check('setup done', r.data.needsSetup === false && r.data.step === 'done' && !r.data.environment, r.data);
r = await call('POST', '/setup/admin', { companyName: 'Again', clientId: 'X2', username: 'admin2', password: 'Admin12345' });
check('setup cannot run twice', r.status === 403, r.data);

console.log('# sign in');
r = await call('POST', '/auth/login', { clientId: CLIENT, username: 'admin', password: 'Admin12345' });
check('administrator signs in, no forced change (chose own password)', r.status === 200 && r.data.user.mustChangePassword === false && r.data.company.name === 'Test Co', r.data);
r = await call('GET', '/employees?pageSize=50');
check('sample employees present', r.status === 200 && r.data.total === 5, r.data);
r = await call('GET', '/setup/clients');
check('client list on the server computer', r.status === 200 && r.data.items.length === 1 && r.data.items[0].schemaName === 'wd_testco', r.data);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
