// Tests the fully automatic setup path. Usage: node auto-test.mjs
const BASE = 'http://127.0.0.1:3100/api';
const CLIENT = 'TESTCO';
let passed = 0, failed = 0;
const check = (n, c, x) => { if (c) { passed++; console.log('  ok   ', n); } else { failed++; console.log('  FAIL ', n, x !== undefined ? JSON.stringify(x).slice(0, 700) : ''); } };
let cookie = '';
async function call(method, path, body) {
  const headers = { 'X-Requested-With': 'WorkDone' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const sc = res.headers.get('set-cookie'); if (sc) { const m = sc.match(/wd_session=([^;]+)/); if (m) cookie = `wd_session=${m[1]}`; }
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

let r = await call('GET', '/setup/status');
const plan = r.data.environment?.autoPlan;
check('auto plan picks forced SQL2012 with no fixes', plan?.instanceName === 'SQL2012' && plan.fixes.length === 0 && plan.supported === false, plan);
const t0 = Date.now();
r = await call('POST', '/setup/auto');
check('automatic setup succeeds', r.status === 200 && r.data.server === 'localhost\\SQL2012', r.data);
console.log('      ', (r.data?.log ?? []).join(' | '), `(${((Date.now() - t0) / 1000).toFixed(1)}s)`);
r = await call('GET', '/setup/status');
check('next step is admin', r.data.step === 'admin', r.data);
r = await call('POST', '/setup/auto');
check('auto cannot run again', r.status === 403, r.data);
r = await call('POST', '/setup/admin', { companyName: 'Test Company', clientId: CLIENT, username: 'admin', password: 'Admin12345' });
check('admin created', r.status === 201, r.data);
r = await call('POST', '/auth/login', { clientId: CLIENT, username: 'admin', password: 'Admin12345' });
check('login works', r.status === 200, r.data);
r = await call('GET', '/product-groups');
check('empty database (no sample data)', r.status === 200 && r.data.total === 0, r.data);
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
