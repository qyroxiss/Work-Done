// End-to-end API smoke test for WorkDone. Usage: node smoke.mjs http://127.0.0.1:3100 [CLIENT_ID]
const BASE = process.argv[2] ?? 'http://127.0.0.1:3100';
const CLIENT = process.argv[3] ?? 'SMOKE';
let passed = 0;
let failed = 0;

function client() {
  let cookie = '';
  return async function call(method, path, body, { csrf = true } = {}) {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (csrf) headers['X-Requested-With'] = 'WorkDone';
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(BASE + '/api' + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie');
    if (set) {
      const m = set.match(/wd_session=([^;]*)/);
      if (m) cookie = m[1] ? `wd_session=${m[1]}` : '';
      if (set.includes('Expires=Thu, 01 Jan 1970')) cookie = '';
    }
    let data = null;
    try { data = await res.json(); } catch {}
    return { status: res.status, data, setCookie: set };
  };
}

function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ok   ', name); }
  else { failed++; console.log('  FAIL ', name, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); }
}

const admin = client();
const anon = client();

console.log('# health & auth');
let r = await anon('GET', '/setup/status');
if (r.data.step === 'company') {
  // Database prepared with db:setup + create-admin: register it as the first client
  r = await anon('POST', '/setup/company', { companyName: 'Smoke Test Company', clientId: CLIENT });
  check('register first client', r.status === 200, r.data);
}
r = await anon('GET', '/health');
check('health ok + db connected', r.status === 200 && r.data.database === 'connected', r.data);
r = await anon('GET', '/work-items');
check('unauthenticated -> 401', r.status === 401, r);
r = await anon('POST', '/auth/login', { clientId: CLIENT, username: 'admin', password: 'wrong' });
check('wrong password -> 401 generic', r.status === 401 && r.data.error === 'Invalid Client ID, User ID or password.', r.data);
r = await anon('POST', '/auth/login', { clientId: CLIENT, username: 'nobody', password: 'x' });
check('unknown user -> same 401', r.status === 401 && r.data.error === 'Invalid Client ID, User ID or password.', r.data);
r = await anon('POST', '/auth/login', { clientId: 'NO-SUCH-CLIENT', username: 'admin', password: 'Admin12345' });
check('unknown Client ID -> same 401', r.status === 401 && r.data.error === 'Invalid Client ID, User ID or password.', r.data);
r = await anon('POST', '/auth/login', { username: 'admin', password: 'Admin12345' });
check('missing Client ID -> 400', r.status === 400, r.data);
r = await admin('POST', '/auth/login', { clientId: CLIENT, username: 'admin', password: 'Admin12345' }, { csrf: false });
check('POST without CSRF header blocked', r.status === 403 && r.data.code === 'CSRF', r.data);
r = await admin('POST', '/auth/login', { clientId: CLIENT, username: 'admin', password: 'Admin12345' });
check('admin login', r.status === 200 && r.data.user.mustChangePassword === true, r.data);
check('login returns company', r.data.company?.clientId === CLIENT && r.data.user.clientId === CLIENT, r.data);
check('session cookie carries Client ID', !!r.setCookie?.startsWith(`wd_session=${CLIENT}.`), r.setCookie);
check('cookie httpOnly + SameSite=Strict', /HttpOnly/i.test(r.setCookie) && /SameSite=Strict/i.test(r.setCookie), r.setCookie);
check('login response has no hash', !JSON.stringify(r.data).includes('PasswordHash') && !JSON.stringify(r.data).includes('$2'), r.data);
r = await admin('GET', '/employees');
check('must-change-password blocks API', r.status === 403 && r.data.code === 'PASSWORD_CHANGE_REQUIRED', r.data);
r = await admin('POST', '/auth/change-password', { currentPassword: 'Admin12345', newPassword: 'short' });
check('weak new password rejected', r.status === 400 && r.data.fields?.newPassword, r.data);
r = await admin('POST', '/auth/change-password', { currentPassword: 'Admin12345', newPassword: 'NewAdmin2026' });
check('change password', r.status === 200 && r.data.user.mustChangePassword === false, r.data);

console.log('# masters');
r = await admin('GET', '/employees?pageSize=100&isActive=true');
check('list seeded employees', r.status === 200 && r.data.total === 5, r.data);
const emps = r.data.items;
r = await admin('GET', '/employees?search=priya');
check('employee search', r.data.total === 1 && r.data.items[0].employeeName === 'Priya Verma', r.data);
r = await admin('POST', '/employees', { employeeCode: 'emp010', employeeName: 'Test Person', email: 'bad-email', isActive: true });
check('employee validation (email)', r.status === 400 && r.data.fields?.email, r.data);
r = await admin('POST', '/employees', { employeeCode: 'emp010', employeeName: 'Test Person', department: 'QA', joiningDate: '2025-02-28', isActive: true });
check('create employee (code uppercased)', r.status === 201 && r.data.employeeCode === 'EMP010' && r.data.joiningDate === '2025-02-28', r.data);
const testEmp = r.data;
r = await admin('POST', '/employees', { employeeCode: 'EMP010', employeeName: 'Dup', isActive: true });
check('duplicate employee code -> 409', r.status === 409, r.data);
r = await admin('POST', '/employees', { employeeCode: 'EMP011', employeeName: 'Bad Date', joiningDate: '2025-02-30', isActive: true });
check('invalid calendar date rejected', r.status === 400 && r.data.fields?.joiningDate, r.data);
r = await admin('GET', '/product-groups?pageSize=100');
check('list groups', r.status === 200 && r.data.total === 4, r.data);
const groups = r.data.items;
r = await admin('GET', '/products?pageSize=100');
check('list products', r.status === 200 && r.data.total === 8, r.data);
const products = r.data.items;
r = await admin('POST', '/product-groups', { groupCode: 'tmp', groupName: 'Temp group', isActive: true });
check('create group', r.status === 201 && r.data.groupCode === 'TMP', r.data);
const tmpGroup = r.data;
r = await admin('POST', '/products', { productCode: 'TMP-1', productName: 'Temp product', productGroupId: tmpGroup.productGroupId, isActive: true });
check('create product', r.status === 201 && r.data.groupName === 'Temp group', r.data);
r = await admin('PUT', `/product-groups/${tmpGroup.productGroupId}`, { groupCode: 'TMP', groupName: 'Temp group', isActive: false });
check('deactivate group', r.status === 200 && r.data.isActive === false, r.data);
r = await admin('POST', '/products', { productCode: 'TMP-2', productName: 'Temp 2', productGroupId: tmpGroup.productGroupId, isActive: true });
check('cannot add product to inactive group', r.status === 400, r.data);

console.log('# users');
const [amit, priya, rahul] = [emps.find((e) => e.employeeCode === 'EMP001'), emps.find((e) => e.employeeCode === 'EMP002'), emps.find((e) => e.employeeCode === 'EMP003')];
r = await admin('POST', '/users', { username: 'manager1', password: 'Manager123', role: 'Manager', employeeId: null, isActive: true });
check('create manager', r.status === 201 && r.data.role === 'Manager', r.data);
r = await admin('POST', '/users', { username: 'emp.nolink', password: 'Employee123', role: 'Employee', employeeId: null, isActive: true });
check('employee role requires employee link', r.status === 400 && r.data.fields?.employeeId, r.data);
r = await admin('POST', '/users', { username: 'amit', password: 'Employee123', role: 'Employee', employeeId: amit.employeeId, isActive: true });
check('create employee user amit', r.status === 201, r.data);
const amitUser = r.data;
r = await admin('POST', '/users', { username: 'priya', password: 'Employee123', role: 'Employee', employeeId: priya.employeeId, isActive: true });
check('create employee user priya', r.status === 201, r.data);
r = await admin('POST', '/users', { username: 'amit2', password: 'Employee123', role: 'Employee', employeeId: amit.employeeId, isActive: true });
check('one login per employee -> 409', r.status === 409, r.data);
r = await admin('GET', '/users');
check('users list has no password hashes', r.status === 200 && !JSON.stringify(r.data).match(/passwordHash|"\$2[aby]\$/i), r.data);
const meAdmin = r.data.items.find((u) => u.username === 'admin');
r = await admin('PUT', `/users/${meAdmin.userId}`, { role: 'Manager', employeeId: null, isActive: true });
check('admin cannot demote self', r.status === 400, r.data);

const manager = client();
const amitC = client();
const priyaC = client();
for (const [c, u, p] of [[manager, 'manager1', 'Manager123'], [amitC, 'amit', 'Employee123'], [priyaC, 'priya', 'Employee123']]) {
  await c('POST', '/auth/login', { clientId: CLIENT, username: u, password: p });
  r = await c('POST', '/auth/change-password', { currentPassword: p, newPassword: p + 'X' });
  check(`${u} changes initial password`, r.status === 200, r.data);
}

console.log('# permissions (direct API calls)');
r = await amitC('GET', '/employees');
check('employee cannot list employees', r.status === 403, r.data);
r = await amitC('POST', '/work-items', { title: 'x', priority: 'Low', employeeIds: [] });
check('employee cannot create work', r.status === 403, r.data);
r = await amitC('GET', '/reports/pending-work');
check('employee cannot view reports', r.status === 403, r.data);
r = await amitC('GET', '/users');
check('employee cannot list users', r.status === 403, r.data);
r = await manager('POST', '/employees', { employeeCode: 'X1', employeeName: 'X', isActive: true });
check('manager cannot create employees', r.status === 403, r.data);
r = await manager('GET', '/users');
check('manager cannot list users', r.status === 403, r.data);
r = await manager('GET', '/employees');
check('manager can list employees', r.status === 200, r.data);

console.log('# work items');
const billing = products.find((p) => p.productCode === 'ACC-BILL');
const hrGroup = groups.find((g) => g.groupCode === 'HR');
const today = new Date();
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const past = new Date(today); past.setDate(past.getDate() - 5);
const future = new Date(today); future.setDate(future.getDate() + 10);

r = await manager('POST', '/work-items', { title: 'Fix GST invoice rounding', description: '<script>alert(1)</script> desc', productId: billing.productId, productGroupId: null, priority: 'High', startDate: iso(past), dueDate: iso(today), employeeIds: [amit.employeeId, priya.employeeId, amit.employeeId] });
check('create work with 2 assignees (dup id collapsed)', r.status === 201 && r.data.assignees.length === 2 && r.data.status === 'Pending', r.data);
check('group derived from product', r.data.productGroupId === billing.productGroupId, r.data);
check('workNo format', /^WD-\d{6}$/.test(r.data.workNo), r.data.workNo);
const w1 = r.data;
r = await manager('POST', '/work-items', { title: 'Overdue payroll task', productGroupId: hrGroup.productGroupId, priority: 'Urgent', startDate: iso(past), dueDate: iso(past), employeeIds: [rahul.employeeId] });
check('create overdue work (group only)', r.status === 201 && r.data.isOverdue === true, r.data);
const w2 = r.data;
r = await manager('POST', '/work-items', { title: 'Unassigned website task', priority: 'Low', dueDate: iso(future), employeeIds: [] });
check('create unassigned work', r.status === 201 && r.data.assignees.length === 0, r.data);
const w3 = r.data;
r = await manager('POST', '/work-items', { title: 'Bad dates', priority: 'Low', startDate: iso(future), dueDate: iso(past) });
check('due before start rejected', r.status === 400 && r.data.fields?.dueDate, r.data);
r = await manager('POST', '/work-items', { title: 'Mismatch', priority: 'Low', productId: billing.productId, productGroupId: hrGroup.productGroupId });
check('product/group mismatch rejected', r.status === 400, r.data);
r = await manager('POST', '/work-items', { title: 'Inactive emp', priority: 'Low', employeeIds: [999999] });
check('nonexistent employee rejected', r.status === 400, r.data);

console.log('# grid & filters');
r = await manager('GET', '/work-items?pageSize=50');
check('manager sees all 3', r.data.total === 3, r.data);
r = await amitC('GET', '/work-items');
check('amit sees only assigned (1)', r.data.total === 1 && r.data.items[0].workId === w1.workId, r.data);
r = await amitC('GET', `/work-items/${w2.workId}`);
check('amit gets 404 for unassigned work', r.status === 404, r.data);
r = await manager('GET', '/work-items?assignment=unassigned');
check('filter unassigned', r.data.total === 1 && r.data.items[0].workId === w3.workId, r.data);
r = await manager('GET', '/work-items?overdue=true');
check('filter overdue', r.data.total === 1 && r.data.items[0].workId === w2.workId, r.data);
r = await manager('GET', `/work-items?employeeId=${priya.employeeId}`);
check('filter by employee', r.data.total === 1, r.data);
r = await manager('GET', `/work-items?productGroupId=${billing.productGroupId}`);
check('filter by group includes product work', r.data.total === 1 && r.data.items[0].workId === w1.workId, r.data);
r = await manager('GET', `/work-items?status=Pending,In%20Progress&priority=High`);
check('status list + priority', r.data.total === 1, r.data);
r = await manager('GET', `/work-items?dateField=due&fromDate=${iso(today)}&toDate=${iso(today)}`);
check('due date boundary (inclusive today)', r.data.total === 1 && r.data.items[0].workId === w1.workId, r.data);
r = await manager('GET', `/work-items?dateField=created&fromDate=${iso(today)}&toDate=${iso(today)}`);
check('created today = 3', r.data.total === 3, r.data);
r = await manager('GET', '/work-items?search=gst');
check('search', r.data.total === 1, r.data);
r = await manager('GET', '/work-items?search=%25');
check('search % treated literally', r.data.total === 0, r.data);
r = await manager('GET', '/work-items?sortBy=priority&sortDir=desc&pageSize=1&page=2');
check('sort + pagination', r.data.items.length === 1 && r.data.items[0].workId === w1.workId && r.data.total === 3, r.data);
r = await manager('GET', '/work-items?sortBy=DROP%20TABLE');
check('invalid sort rejected', r.status === 400, r.data);
r = await manager('GET', '/work-items?pageSize=100000');
check('pageSize capped', r.status === 400, r.data);
r = await manager('GET', '/work-items?status=Pending&search=zzzz');
check('empty result', r.status === 200 && r.data.total === 0 && r.data.items.length === 0, r.data);

console.log('# status workflow');
r = await amitC('GET', `/work-items/${w1.workId}`);
check('employee allowed transitions', JSON.stringify(r.data.allowedTransitions) === JSON.stringify(['In Progress', 'On Hold']), r.data.allowedTransitions);
let rv = r.data.rowVersion;
r = await amitC('PATCH', `/work-items/${w1.workId}/status`, { status: 'Completed', rowVersion: rv });
check('invalid transition Pending->Completed', r.status === 400, r.data);
r = await amitC('PATCH', `/work-items/${w1.workId}/status`, { status: 'In Progress', notes: 'Starting', rowVersion: rv });
check('employee starts work', r.status === 200 && r.data.status === 'In Progress', r.data);
r = await priyaC('PATCH', `/work-items/${w1.workId}/status`, { status: 'On Hold', notes: 'stale', rowVersion: rv });
check('stale rowVersion -> 409 (concurrent update)', r.status === 409, r.data);
r = await priyaC('GET', `/work-items/${w1.workId}`);
rv = r.data.rowVersion;
r = await priyaC('PATCH', `/work-items/${w1.workId}/status`, { status: 'On Hold', rowVersion: rv });
check('On Hold requires note', r.status === 400, r.data);
r = await priyaC('POST', `/work-items/${w1.workId}/notes`, { notes: 'Waiting for client data' });
check('employee adds note', r.status === 201 && r.data.history[0].entryType === 'Note', r.data);
rv = r.data.rowVersion;
r = await priyaC('PATCH', `/work-items/${w1.workId}/status`, { status: 'Completed', notes: 'Done', rowVersion: rv });
check('employee completes', r.status === 200 && r.data.status === 'Completed', r.data);
rv = r.data.rowVersion;
r = await amitC('PATCH', `/work-items/${w1.workId}/status`, { status: 'Closed', rowVersion: rv });
check('employee cannot close -> 403', r.status === 403, r.data);
r = await amitC('POST', `/work-items/${w2.workId}/notes`, { notes: 'sneaky' });
check('employee cannot note unassigned work -> 404', r.status === 404, r.data);
r = await manager('GET', `/work-items/${w1.workId}`);
check('manager sees Closed/Reopened options', JSON.stringify(r.data.allowedTransitions) === JSON.stringify(['Closed', 'Reopened']), r.data.allowedTransitions);
r = await manager('PATCH', `/work-items/${w1.workId}/status`, { status: 'Closed', notes: 'Reviewed OK', rowVersion: r.data.rowVersion });
check('manager closes', r.status === 200 && r.data.status === 'Closed' && r.data.closedAt, r.data);
rv = r.data.rowVersion;
r = await manager('PUT', `/work-items/${w1.workId}`, { title: 'edit closed', priority: 'Low', rowVersion: rv });
check('closed work cannot be edited', r.status === 400, r.data);
r = await manager('POST', `/work-items/${w1.workId}/assignments`, { employeeIds: [] });
check('closed work cannot be reassigned', r.status === 400, r.data);
r = await manager('PATCH', `/work-items/${w1.workId}/status`, { status: 'Reopened', rowVersion: rv });
check('reopen requires note', r.status === 400, r.data);
r = await manager('PATCH', `/work-items/${w1.workId}/status`, { status: 'Reopened', notes: 'Client found an issue', rowVersion: rv });
check('manager reopens', r.status === 200 && r.data.status === 'Reopened' && r.data.closedAt === null, r.data);
check('history recorded', r.data.history.length >= 7 && r.data.history.every((h) => h.changedByName), r.data.history.map((h) => h.entryType + ':' + h.newStatus));

console.log('# assignments & edit');
r = await manager('POST', `/work-items/${w3.workId}/assignments`, { employeeIds: [rahul.employeeId, testEmp.employeeId] });
check('assign unassigned work', r.status === 200 && r.data.assignees.length === 2, r.data);
r = await manager('POST', `/work-items/${w3.workId}/assignments`, { employeeIds: [rahul.employeeId, testEmp.employeeId] });
check('same assignment again is a no-op', r.status === 200 && r.data.assignees.length === 2 && r.data.history.filter((h) => h.entryType === 'Assignment').length === 1, r.data);
r = await admin('PUT', `/employees/${testEmp.employeeId}`, { employeeCode: 'EMP010', employeeName: 'Test Person', isActive: false });
check('deactivate employee', r.status === 200 && r.data.isActive === false, r.data);
r = await manager('POST', `/work-items/${w2.workId}/assignments`, { employeeIds: [rahul.employeeId, testEmp.employeeId] });
check('cannot newly assign inactive employee', r.status === 400, r.data);
r = await manager('GET', `/work-items/${w3.workId}`);
r = await manager('PUT', `/work-items/${w3.workId}`, { title: 'Website task (edited)', description: null, productGroupId: null, productId: null, priority: 'Medium', startDate: null, dueDate: iso(future), employeeIds: [rahul.employeeId], rowVersion: r.data.rowVersion });
check('edit + reassign in one save', r.status === 200 && r.data.title === 'Website task (edited)' && r.data.assignees.length === 1, r.data);
r = await manager('PUT', `/work-items/${w3.workId}`, { title: 'stale', priority: 'Medium', rowVersion: '0000000000000001' });
check('stale edit -> 409', r.status === 409, r.data);

console.log('# concurrent duplicate assignment race');
const raceWork = (await manager('POST', '/work-items', { title: 'Race', priority: 'Low', employeeIds: [] })).data;
const results = await Promise.all([1, 2, 3, 4].map(() => manager('POST', `/work-items/${raceWork.workId}/assignments`, { employeeIds: [priya.employeeId] })));
const final = await manager('GET', `/work-items/${raceWork.workId}`);
check('parallel assigns -> exactly one active assignment', final.data.assignees.length === 1 && results.every((x) => x.status === 200 || x.status === 409), results.map((x) => x.status));

console.log('# reports');
r = await manager('GET', `/reports/employee-work`);
check('employee-wise report', r.status === 200 && r.data.rows.some((x) => x.employeeName === 'Rahul Gupta' && x.overdue === 1), r.data);
r = await manager('GET', `/reports/pending-work`);
check('pending report', r.status === 200 && r.data.rows.length >= 3, r.data);
r = await manager('GET', `/reports/overdue-work`);
check('overdue report', r.status === 200 && r.data.rows.length === 1 && r.data.rows[0].daysOverdue === 5, r.data);
r = await manager('GET', `/reports/completed-work?fromDate=${iso(today)}&toDate=${iso(today)}`);
check('completed report (reopened work excluded)', r.status === 200 && r.data.rows.length === 0, r.data);
r = await manager('GET', `/reports/work-summary?fromDate=${iso(past)}&toDate=${iso(today)}`);
check('summary report', r.status === 200 && r.data.rows.length === 6 && r.data.totals.created === 4 && r.data.totals.completed === 1 && r.data.totals.closed === 1 && r.data.totals.reopened === 1, r.data.totals);
r = await manager('GET', `/reports/completed-work`);
check('completed report requires dates', r.status === 400, r.data);

console.log('# dashboard');
r = await manager('GET', '/dashboard');
check('manager dashboard', r.status === 200 && r.data.overdue === 1 && r.data.unassigned === 0 && r.data.recentActivity.length > 0, r.data);
r = await amitC('GET', '/dashboard');
check('employee dashboard scoped', r.status === 200 && Object.values(r.data.statusCounts).reduce((a, b) => a + b, 0) === 1, r.data.statusCounts);

console.log('# session security');
r = await admin('PUT', `/users/${amitUser.userId}`, { role: 'Employee', employeeId: amit.employeeId, isActive: false });
check('deactivate amit', r.status === 200, r.data);
r = await amitC('GET', '/work-items');
check('deactivated user session revoked immediately', r.status === 401, r.data);
r = await amitC('POST', '/auth/login', { clientId: CLIENT, username: 'amit', password: 'Employee123X' });
check('inactive user cannot log in', r.status === 403 && r.data.code === 'INACTIVE', r.data);
r = await priyaC('POST', '/auth/logout');
check('logout', r.status === 204, r);
r = await priyaC('GET', '/auth/me');
check('session invalid after logout', r.status === 401, r.data);
r = await anon('POST', '/auth/login', '{bad json');
check('malformed JSON -> 400', r.status === 400, r.data);
{
  // A valid token presented under another Client ID must not work
  const res = await fetch(BASE + '/api/auth/me', { headers: { Cookie: `wd_session=OTHER.${'x'.repeat(43)}` } });
  check('forged Client ID prefix -> 401', res.status === 401, res.status);
}
r = await client()('POST', '/auth/login', { clientId: CLIENT.toLowerCase(), username: 'manager1', password: 'Manager123X' });
check('Client ID is case-insensitive', r.status === 200, r.data);
r = await anon('GET', '/nonexistent');
check('unknown endpoint protected (401)', r.status === 401, r.data);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
