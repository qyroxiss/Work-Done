// Multi-client (one schema per Client ID) test. Run on the server computer after smoke.mjs:
//   node tests/multi-client.mjs http://127.0.0.1:3100 SMOKE
// Creates the client NEWCO (its tables in schema wd_newco).
const BASE = process.argv[2] ?? 'http://127.0.0.1:3100';
const FIRST = process.argv[3] ?? 'SMOKE';
const NEW = 'NEWCO';
let passed = 0;
let failed = 0;

function client() {
  const c = async function call(method, path, body) {
    const headers = { Accept: 'application/json', 'X-Requested-With': 'WorkDone' };
    // Hosted (e.g. Vercel): client management needs the setup key
    if (process.env.SETUP_KEY) headers['X-Setup-Key'] = process.env.SETUP_KEY;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (c.cookie) headers.Cookie = c.cookie;
    const res = await fetch(BASE + '/api' + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie');
    const m = set?.match(/wd_session=([^;]*)/);
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

const local = client();
console.log('# create client');
let r = await local('POST', '/setup/clients', { companyName: 'New Company Ltd', clientId: 'bad id!', username: 'admin', password: 'Newco12345' });
check('invalid Client ID rejected', r.status === 400, r.data);
r = await local('POST', '/setup/clients', { companyName: 'Dup', clientId: FIRST.toLowerCase(), username: 'admin', password: 'Newco12345' });
check('existing Client ID -> 409', r.status === 409, r.data);
r = await local('POST', '/setup/clients', { companyName: 'New Company Ltd', clientId: NEW.toLowerCase(), username: 'admin', password: 'Newco12345' });
check('create client (own schema)', r.status === 201 && r.data.client.schemaName === `wd_${NEW.toLowerCase()}`, r.data);
console.log('      ', (r.data?.log ?? []).join(' | '));
r = await local('GET', '/setup/clients');
check('both clients listed', r.status === 200 && [FIRST, NEW].every((id) => r.data.items.some((c) => c.clientId === id)), r.data);

console.log('# isolation');
const newAdmin = client();
r = await newAdmin('POST', '/auth/login', { clientId: NEW, username: 'admin', password: 'Newco12345' });
check('new client admin logs in, must change password', r.status === 200 && r.data.user.mustChangePassword === true && r.data.company.name === 'New Company Ltd', r.data);
r = await newAdmin('POST', '/auth/change-password', { currentPassword: 'Newco12345', newPassword: 'Newco12345X' });
check('change password', r.status === 200, r.data);
r = await newAdmin('GET', '/employees');
check('new client sees no employees of the first client', r.status === 200 && r.data.total === 0, r.data);
r = await newAdmin('POST', '/employees', { employeeCode: 'N001', employeeName: 'Newco Person' });
check('new client creates an employee', r.status === 201, r.data);
r = await newAdmin('GET', '/settings/company');
check('company settings are per client', r.data.clientId === NEW, r.data);
r = await client()('POST', '/auth/login', { clientId: FIRST, username: 'admin', password: 'Newco12345X' });
check('new client password does not work for the first client', r.status === 401, r.data);

{
  // Same token presented under the first client's ID must not sign in there
  const token = newAdmin.cookie.split('.').pop();
  const swapped = client();
  swapped.cookie = `wd_session=${FIRST}.${token}`;
  r = await swapped('GET', '/auth/me');
  check('session token is bound to its client', r.status === 401, r.data);
}

console.log('# deactivate client');
r = await local('PATCH', `/setup/clients/${NEW}`, { isActive: false });
check('deactivate', r.status === 200 && r.data.isActive === false, r.data);
r = await newAdmin('GET', '/employees');
check('sessions of an inactive client end', r.status === 401, r.data);
r = await client()('POST', '/auth/login', { clientId: NEW, username: 'admin', password: 'Newco12345X' });
check('inactive client cannot sign in', r.status === 403 && r.data.code === 'CLIENT_INACTIVE', r.data);
r = await local('PATCH', `/setup/clients/${NEW}`, { isActive: true });
check('reactivate', r.status === 200 && r.data.isActive === true, r.data);
r = await client()('POST', '/auth/login', { clientId: NEW, username: 'admin', password: 'Newco12345X' });
check('signs in again after reactivation', r.status === 200, r.data);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
