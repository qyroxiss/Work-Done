# Office LAN Deployment

## 1. Server machine

Choose one office server / dedicated PC for the backend and SQL Server.

- Give it a **static IP or DHCP reservation** (e.g. `192.168.1.10`) and, ideally, a hostname (e.g. `workdone-srv`).
- Install: Node.js LTS (20 or 22), SQL Server 2019/2022/2025, SSMS.

## 2. SQL Server configuration

1. **Enable TCP/IP** — SQL Server Configuration Manager → SQL Server Network Configuration → Protocols for *your instance* → TCP/IP → Enabled. Restart the SQL Server service.
   The Node.js driver connects over TCP only (shared memory / named pipes are not supported).
2. For a **named instance** (e.g. `SQL2022`) either keep the *SQL Server Browser* service running and use `DB_SERVER=localhost\SQL2022`, or set a fixed port under *IPAll → TCP Port* (e.g. 1433) and use `DB_SERVER=localhost`, `DB_PORT=1433`.
3. Enable **SQL Server and Windows Authentication mode** (Server properties → Security) if using a SQL login.
4. Run `database/create-database.sql` (after changing the password) to create `WorkDoneDB` and the least-privilege `workdone_app` login (db_datareader + db_datawriter only).
5. Create tables with an owner account: `npm run db:setup` (with `SETUP_DB_USER` / `SETUP_DB_PASSWORD`) or run `schema.sql` + `indexes.sql` in SSMS. **Do not** run `seed.sql` in production.
6. If the backend runs on the same machine as SQL Server, **do not open port 1433 in the firewall**. If they are on different machines, allow 1433 only from the backend host's IP.

### TLS to SQL Server
`DB_ENCRYPT=true` is the default. With a self-signed SQL certificate you will see a certificate error; for production install a trusted certificate on SQL Server. `DB_TRUST_SERVER_CERTIFICATE=true` is acceptable only for development or when backend and SQL Server are on the same host.

## 3. Build and run

```powershell
cd frontend
npm ci
npm run build            # -> frontend/dist (served by the backend)

cd ..\backend
npm ci
npm run build            # -> backend/dist
copy .env.example .env   # set NODE_ENV=production and DB settings
npm run create-admin -- --username admin
npm start                # serves UI + API on http://<server>:3000
```

Users open `http://workdone-srv:3000` (or `http://192.168.1.10:3000`) in their browser.

### Run as a Windows service
Use a service wrapper so the app starts at boot and restarts on failure, e.g. [NSSM](https://nssm.cc/):

```powershell
nssm install WorkDone "C:\Program Files\nodejs\node.exe" "D:\WorkDone\backend\dist\server.js"
nssm set WorkDone AppDirectory "D:\WorkDone\backend"
nssm set WorkDone AppStdout "D:\WorkDone\logs\workdone.log"
nssm set WorkDone AppStderr "D:\WorkDone\logs\workdone-error.log"
nssm start WorkDone
```
(`AppDirectory` must be the backend folder so `.env` is found.) Restrict NTFS permissions on `backend\.env` to administrators and the service account.

### Firewall
Allow inbound TCP on the app port (3000, or 443 with HTTPS) **from the office subnet only**:
```powershell
New-NetFirewallRule -DisplayName "WorkDone" -Direction Inbound -Protocol TCP -LocalPort 3000 -RemoteAddress 192.168.1.0/24 -Action Allow
```

## 4. HTTPS (recommended even internally)

Option A — let Node serve TLS directly: obtain a certificate for the server hostname (internal CA or self-signed distributed to office PCs), then in `.env`:
```
HTTPS_KEY_PATH=D:\WorkDone\certs\server.key
HTTPS_CERT_PATH=D:\WorkDone\certs\server.crt
PORT=443
COOKIE_SECURE=true
```
Option B — put IIS/nginx in front as a reverse proxy terminating TLS, keep Node on localhost:3000, and set `TRUST_PROXY=1`, `COOKIE_SECURE=true`.

When HTTPS is enabled, `COOKIE_SECURE=true` must be set so the session cookie is never sent over plain HTTP.

HTTPS also lets office PCs **install Q-WorkDone as an app** (Chrome/Edge: the install icon in the address bar), with its own window and taskbar icon. Browsers allow this only over HTTPS, or on the server computer itself at `http://localhost:3000`.

## 5. Backups

- Schedule SQL Server backups (SQL Agent job or Maintenance Plan), for example: **full daily, transaction log hourly** (requires FULL recovery model) — choose based on how much work you can afford to lose.
  ```sql
  BACKUP DATABASE WorkDoneDB TO DISK = N'E:\Backups\WorkDoneDB_full.bak' WITH COMPRESSION, CHECKSUM, INIT;
  ```
- With several client companies, include **every** client database (`WorkDoneDB` plus each `WorkDone_<CLIENTID>`) in the backup job — new clients are not added to an existing job automatically.
- Copy backups to a **second location** (NAS / external disk / cloud) — not only the DB server.
- **Test restores** regularly into a separate database:
  ```sql
  RESTORE DATABASE WorkDoneDB_RestoreTest FROM DISK = N'E:\Backups\WorkDoneDB_full.bak'
    WITH MOVE 'WorkDoneDB' TO N'E:\Restore\WorkDoneDB_RestoreTest.mdf',
         MOVE 'WorkDoneDB_log' TO N'E:\Restore\WorkDoneDB_RestoreTest_log.ldf';
  ```
- Back up `backend\.env` securely (it holds the DB password).

## 6. Maintenance

- Monitor: application logs, `/api/health`, SQL Server disk space and DB size, failed logins (`SecurityEvents` table, `EventType = 'LOGIN_FAILED'`).
- Sessions older than 7 days after expiry are purged automatically. Define a retention period for `SecurityEvents` (e.g. delete rows older than 1 year).
- Keep Node.js, npm dependencies (`npm audit`), Windows and SQL Server patched.
- Schema changes: add new numbered scripts in `database/migrations/` (e.g. `002_add_column.sql`), test on a copy first, back up before applying.

### Useful security queries
```sql
-- Recent failed logins
SELECT TOP 50 * FROM dbo.SecurityEvents WHERE EventType = 'LOGIN_FAILED' ORDER BY CreatedAt DESC;
-- Sign everyone out (e.g. after a security incident)
UPDATE dbo.Sessions SET RevokedAt = SYSUTCDATETIME() WHERE RevokedAt IS NULL;
```

## 7. Future online migration

The frontend and backend are already decoupled and configured through environment variables (no hardcoded IPs). Before going online: host on a secured server, use a domain + HTTPS (`COOKIE_SECURE=true`), keep SQL Server off the public internet (private network / firewall to the app host only), store secrets in the host's secret manager, set up automated backups and monitoring, and consider VPN-only access if the app should remain private. Test data migration and rollback first.
