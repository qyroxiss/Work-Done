# Testing

## Unit tests (no database needed)

```powershell
cd backend
npm test
```

Covers the work status rules, repeating-work date calculations (month ends, leap years, catch-up, end dates, title placeholders), @mention parsing and upload checks. Run them before every release.

## Automated API smoke test

`backend/tests/smoke.mjs` exercises the API end to end over HTTP (102 checks): login/logout, inactive users, forced password change, CSRF guard, role permissions via direct API calls, master CRUD + validation + duplicates, work creation with multiple employees, duplicate/parallel assignment, filters (combined, date boundaries, sorting, pagination, empty results), status transitions and history, optimistic-concurrency conflicts (409), reports and dashboard scoping.

**Run it only against an empty test database** (it creates data and expects the seed data):

```powershell
# 1. Create an empty test DB (e.g. WorkDoneDB_Test) and point backend/.env at it
npm run db:setup -- --seed
$env:ADMIN_PASSWORD="Admin12345"; npm run create-admin -- --username admin; Remove-Item Env:ADMIN_PASSWORD
# 2. Start the API
npm run build; npm start
# 3. In another terminal
node tests/smoke.mjs http://localhost:3000 SMOKE      # registers Client ID SMOKE if none is set
# 4. Multi-client: creates client NEWCO with its own database (run on the server computer)
node tests/multi-client.mjs http://localhost:3000 SMOKE
# 5. Chat: live delivery, unread counts, private direct chats, company isolation
node tests/chat.mjs http://localhost:3000 SMOKE NEWCO
```

Afterwards drop the test databases (e.g. `WorkDoneDB_Test`, `WorkDone_NEWCO`).

## Manual checklist (from the specification)

- [ ] Valid / invalid login; inactive user cannot log in; idle session expires after `SESSION_IDLE_MINUTES`
- [ ] Role permissions checked with direct API requests (the smoke test covers this)
- [ ] Create, edit, deactivate employees / product groups / products
- [ ] Assign work to one and to multiple employees; duplicate assignment prevented
- [ ] Status transitions and history; Manager closes/reopens
- [ ] Filters together, date boundaries, sorting, pagination, empty results
- [ ] Two office PCs editing the same work item → second save shows "changed by someone else"
- [ ] Stop SQL Server while the app runs → users see "database unavailable", no credentials leaked; app recovers when SQL is back
- [ ] Unplug a client's network mid-action → clear error, works after reconnect
- [ ] Backup and restore into a separate database (see DEPLOYMENT.md)
- [ ] UI on a typical office monitor and on a small laptop screen
