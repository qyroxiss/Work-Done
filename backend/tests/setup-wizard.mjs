// Drives the setup wizard API end to end. Usage: node wizard-test.mjs <lanIp>
const BASE = 'http://127.0.0.1:3100/api';
const CLIENT = 'TESTCO';
const LAN = process.argv[2] ? `http://${process.argv[2]}:3100/api` : null;
let passed = 0, failed = 0;
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

const conn = { server: 'localhost\\SQL2012', authType: 'windows', encrypt: true, trustServerCertificate: true, database: 'WorkDoneDB_WizTest' };

let r = await call('GET', '/health');
check('health reports setup-required', r.data.status === 'setup-required', r.data);
r = await call('GET', '/setup/status');
check('status: needs setup, database step, local', r.data.needsSetup && r.data.step === 'database' && r.data.isLocal, r.data);
const inst = r.data.environment.instances;
check('detects SQL2012 instance with TCP on', inst.some((i) => i.name === 'SQL2012' && i.tcpEnabled && i.running), inst);
check('detects SQL2022 with TCP off', inst.some((i) => i.name === 'SQL2022' && !i.tcpEnabled), inst.map((i) => i.name));
check('sqlcmd available', r.data.environment.sqlcmdAvailable === true, r.data.environment);
r = await call('POST', '/auth/login', { clientId: CLIENT, username: 'x', password: 'y' });
check('login in setup mode -> 503 SETUP_REQUIRED', r.status === 503 && r.data.code === 'SETUP_REQUIRED', r);

if (LAN) {
  r = await call('GET', '/setup/status', undefined, LAN);
  check('remote status: not local, no machine details', r.data.isLocal === false && !r.data.environment, r.data);
  r = await call('POST', '/setup/test-connection', conn, LAN);
  check('remote test-connection blocked', r.status === 403, r);
  r = await call('POST', '/setup/install', conn, LAN);
  check('remote install blocked', r.status === 403, r);
}

r = await call('POST', '/setup/test-connection', { ...conn, server: 'localhost\\SQL2022' });
check('TCP-disabled instance gives clear error', r.data.ok === false && /TCP\/IP/i.test(r.data.error), r.data);
r = await call('POST', '/setup/test-connection', { ...conn, server: "localhost'; DROP" });
check('invalid server name rejected', r.status === 400, r.data);
r = await call('POST', '/setup/test-connection', { ...conn, database: 'bad-name;' });
check('invalid db name rejected', r.status === 400, r.data);
r = await call('POST', '/setup/test-connection', conn);
check('test connection (Windows auth)', r.data.ok && r.data.isSysadmin && r.data.mixedMode && r.data.databaseExists === false, r.data);
r = await call('POST', '/setup/admin', { companyName: 'Test Company', clientId: CLIENT, username: 'admin', password: 'Admin12345' });
check('admin step blocked before install', r.status === 403, r.data);

r = await call('POST', '/setup/install', { ...conn, loadSampleData: true });
check('install', r.status === 200 && r.data.log.length >= 6, r.data);
console.log('     ', (r.data?.log ?? []).join(' | '));
r = await call('GET', '/setup/status');
check('status now admin step', r.data.needsSetup && r.data.step === 'admin', r.data);
r = await call('POST', '/setup/install', conn);
check('install not repeatable after success', r.status === 403, r.data);
r = await call('POST', '/setup/admin', { companyName: 'Test Company', clientId: CLIENT, username: 'admin', password: 'short' });
check('weak admin password rejected', r.status === 400, r.data);
r = await call('POST', '/setup/admin', { companyName: 'Test Company', clientId: CLIENT, username: 'admin', password: 'Admin12345' });
check('create admin', r.status === 201, r.data);
r = await call('GET', '/setup/status');
check('setup done', r.data.needsSetup === false && r.data.step === 'done' && !r.data.environment, r.data);
r = await call('POST', '/setup/admin', { companyName: 'Test Company', clientId: CLIENT, username: 'admin2', password: 'Admin12345' });
check('admin step closed after setup', r.status === 403, r.data);
r = await call('POST', '/setup/system-action', { action: 'enable-tcp', instanceName: 'SQL2022' });
check('system actions closed after setup', r.status === 403, r.data);

r = await call('GET', '/health');
check('health connected (app login)', r.data.database === 'connected', r.data);
r = await call('POST', '/auth/login', { clientId: CLIENT, username: 'admin', password: 'Admin12345' });
check('admin can log in, no forced change', r.status === 200 && r.data.user.mustChangePassword === false, r.data);
r = await call('GET', '/employees');
check('seed data visible', r.status === 200 && r.data.total === 5, r.data);
r = await call('POST', '/work-items', { title: 'Wizard test work', priority: 'High', employeeIds: [r.data.items[0].employeeId] });
check('create work with app login', r.status === 201, r.data);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
