# Testing

## Unit tests (no database needed)

```powershell
cd backend
npm test
```

Covers the work status rules, repeating-work date calculations (month ends, leap years, catch-up, end dates, title placeholders), @mention parsing and upload checks. Run them before every release.

## Automated API smoke test

`backend/tests/smoke.mjs` exercises the API end to end over HTTP (109 checks): login/logout, inactive users, forced password change, CSRF guard, role permissions via direct API calls, master CRUD + validation + duplicates, work creation with multiple employees, duplicate/parallel assignment, filters (combined, date boundaries, sorting, pagination, empty results), status transitions and history, optimistic-concurrency conflicts (409), reports and dashboard scoping.

**Run it only against an empty test database** (it creates data and expects the sample data). In PowerShell, in `backend`:

```powershell
# 1. An empty PostgreSQL database for the tests (never the real one)
$env:DATABASE_URL = 'postgres://workdone:PASSWORD@localhost:5432/workdone_test'
npm run build
$env:ADMIN_PASSWORD = 'Admin12345'; npm run add-client -- --client SMOKE --name "Smoke Test Company" --username admin; Remove-Item Env:ADMIN_PASSWORD
npm run db:seed -- --client SMOKE
# 2. Start the API on a spare port (same terminal, so it uses the test database)
$env:PORT = '3100'; npm start
# 3. In another terminal
node tests/smoke.mjs http://127.0.0.1:3100 SMOKE
# 4. Multi-client: creates client NEWCO with its own schema
node tests/multi-client.mjs http://127.0.0.1:3100 SMOKE
# 5. Chat: live delivery, unread counts, private direct chats, company isolation
node tests/chat.mjs http://127.0.0.1:3100 SMOKE NEWCO
```

Setup wizard: start the server **without** `DATABASE_URL` (back up `backend/.env` first: the wizard writes to it) and run
`node tests/setup-wizard.mjs http://127.0.0.1:3100 <connection string of another empty database> [this PC's LAN IP]`.

Afterwards drop the test databases (e.g. `WorkDoneDB_Test`, `WorkDone_NEWCO`).

## Manual checklist (from the specification)

- [ ] Valid / invalid login; inactive user cannot log in; idle session expires after `SESSION_IDLE_MINUTES`
- [ ] Role permissions checked with direct API requests (the smoke test covers this)
- [ ] Create, edit, deactivate employees / product groups / products
- [ ] Assign work to one and to multiple employees; duplicate assignment prevented
- [ ] Status transitions and history; Manager closes/reopens
- [ ] Filters together, date boundaries, sorting, pagination, empty results
- [ ] Two office PCs editing the same work item → second save shows "changed by someone else"
- [ ] Stop PostgreSQL while the app runs → users see "database unavailable", no credentials leaked; app recovers when the database is back
- [ ] Unplug a client's network mid-action → clear error, works after reconnect
- [ ] Backup and restore into a separate database (see DEPLOYMENT.md)
- [ ] UI on a typical office monitor and on a small laptop screen
