# Deployment

Q-WorkDone is one Node.js server (it serves the built UI and the API on one port) and a PostgreSQL database.
It can run on an office server on the LAN, on Vercel with a Neon database (see **Vercel** below), or on any other
cloud host with a hosted database.

## Vercel + Neon

The repository is ready for Vercel as one project with two **services** (`vercel.json`):

- `frontend` (`frontend/`, Vite): public at `/`; app pages such as `/work` fall back to `index.html`.
- `backend` (`backend/`, Express): public at `/api/*`; Vercel serves the default export of `backend/src/app.ts`
  as one function, which sees the full path (`/api/...`).

The browser calls `/api` on the same domain, so the services do not call each other (no bindings).
On Vercel the app switches to its serverless mode by itself:

| | Office server | Vercel |
|---|---|---|
| Live chat and notifications | pushed instantly | through the database, within about 2 seconds |
| Repeating work, due/overdue reminders | every 15 minutes | once a day at 08:00 IST (Vercel Cron, `30 2 * * *` UTC) |
| Largest file (work / chat) | 20 MB / 10 MB | 4 MB / 4 MB (Vercel's request limit is 4.5 MB) |
| Setup and `/clients` | on the server computer | anywhere, with the `SETUP_KEY` |

Steps:

1. **Push** the code to GitHub.
2. In Vercel: **Add New → Project**, import the repository. Keep the root directory as the repository root; Vercel
   reads the services from `vercel.json` and builds each one. Try it locally first with `vercel dev`.
3. **Database:** in the project, *Storage → Create Database → Neon* (or connect an existing Neon project). This adds
   `DATABASE_URL` to the project's environment variables. Choose a region close to your users (e.g. Singapore/Mumbai for India)
   and set the Vercel function region to match (*Settings → Functions → Function Region*).
4. **Environment variables** (*Settings → Environment Variables*, Production):
   - `NODE_ENV` = `production`
   - `SETUP_KEY` = a long random value (lets you run setup and manage client companies in the browser)
   - `CRON_SECRET` = another long random value (protects the daily job; Vercel Cron sends it automatically)
5. **Deploy**, open the site, enter the setup key, and create your company and administrator.
   To bring existing data instead, run on your computer (in `backend`):
   `$env:DATABASE_URL = '<Neon connection string>'; npm run import:sqlserver` (from the SQL Server version), or restore a
   PostgreSQL dump into the Neon database with `pg_restore`.
6. Optional: add your own domain under *Settings → Domains*.

Every push to the main branch deploys again; other branches get preview deployments. Neon's free plan sleeps
when idle, so the first request after a quiet period can take a second or two.

## 1. Database (PostgreSQL 14 or newer)

The app needs one empty database and a user that owns it (it creates and upgrades its own tables).

**On the office server:**
1. Install PostgreSQL from postgresql.org (keep the default port 5432).
2. Create a user and a database for the app, e.g. in *SQL Shell (psql)* as `postgres`:
   ```sql
   CREATE ROLE workdone LOGIN PASSWORD 'a-long-random-password';
   CREATE DATABASE workdone OWNER workdone;
   ```
3. The connection string is then `postgres://workdone:a-long-random-password@localhost:5432/workdone`
   (URL-encode special characters in the password, e.g. `@` as `%40`).
4. If PostgreSQL runs on the same machine as the app, **do not open port 5432 in the firewall**. If they are on
   different machines, allow 5432 only from the app server's IP (and add it to `pg_hba.conf`).

**Hosted (e.g. Neon):** create a project and database, and copy the connection string from its dashboard (it ends with
`?sslmode=require`, which turns on TLS). Use the database owner role.

Every client company gets its own schema `wd_<clientid>` in this one database; the client registry is `public.Clients`.

## 2. Build and run

```powershell
cd frontend
npm ci
npm run build            # -> frontend/dist (served by the backend)

cd ..\backend
npm ci
npm run build            # -> backend/dist
copy .env.example .env   # set NODE_ENV=production and DATABASE_URL (or leave it empty and use the setup wizard)
npm start                # serves UI + API on http://<server>:3000
```

Open `http://localhost:3000` on the server: the setup wizard asks for the database (if `DATABASE_URL` is not set) and
creates the first company and its administrator. Or create it from the command line:
`npm run add-client -- --client ACME --name "Acme Pvt Ltd" --username admin`.

Users then open `http://workdone-srv:3000` (or `http://192.168.1.10:3000`) in their browser.

### Setup and client management from another computer
Setup and `/clients` normally work only in a browser on the server itself. On a cloud host, set **`SETUP_KEY`** to a
long random value; the wizard and the client page then ask for this key. Remove it again when you do not need it.

### Run as a Windows service
The setup wizard can register a scheduled task ("WorkDone Server") that starts the app at boot. Alternatively use a
service wrapper such as [NSSM](https://nssm.cc/):

```powershell
nssm install WorkDone "C:\Program Files\nodejs\node.exe" "D:\WorkDone\backend\dist\server.js"
nssm set WorkDone AppDirectory "D:\WorkDone\backend"
nssm set WorkDone AppStdout "D:\WorkDone\logs\workdone.log"
nssm set WorkDone AppStderr "D:\WorkDone\logs\workdone-error.log"
nssm start WorkDone
```
(`AppDirectory` must be the backend folder so `.env` is found.) Restrict NTFS permissions on `backend\.env` to
administrators and the service account. To remove the scheduled task: `scripts\server-tools.ps1 -Action RemoveAutostart`
in an elevated PowerShell.

### Firewall
Allow inbound TCP on the app port (3000, or 443 with HTTPS) **from the office subnet only**:
```powershell
New-NetFirewallRule -DisplayName "WorkDone" -Direction Inbound -Protocol TCP -LocalPort 3000 -RemoteAddress 192.168.1.0/24 -Action Allow
```

## 3. HTTPS (recommended even internally)

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

## 4. Backups

- Back up the **whole database** (all client schemas at once) every day with `pg_dump`, for example as a Windows scheduled task:
  ```powershell
  $env:PGPASSWORD = '...'   # or use a pgpass.conf file
  & "C:\Program Files\PostgreSQL\18\bin\pg_dump.exe" -h localhost -U workdone -d workdone -F c -f "E:\Backups\workdone_$(Get-Date -Format yyyyMMdd).dump"
  ```
  Hosted databases such as Neon keep their own point-in-time history; still export a copy regularly.
- Work files and chat files are stored in the database, so the dump contains them too (and grows with them).
- Copy backups to a **second location** (NAS / external disk / cloud) — not only the database server.
- **Test restores** regularly into a separate database:
  ```powershell
  & "C:\Program Files\PostgreSQL\18\bin\createdb.exe" -h localhost -U workdone workdone_restore_test
  & "C:\Program Files\PostgreSQL\18\bin\pg_restore.exe" -h localhost -U workdone -d workdone_restore_test "E:\Backups\workdone_20261023.dump"
  ```
- Back up `backend\.env` securely (it holds the database password).

## 5. Maintenance

- Monitor: application logs, `/api/health`, database size, failed logins (`SecurityEvents` in each client schema, `EventType = 'LOGIN_FAILED'`).
- Sessions older than 7 days after expiry are purged automatically. Define a retention period for `SecurityEvents` (e.g. delete rows older than 1 year).
- Keep Node.js, npm dependencies (`npm audit`), the operating system and PostgreSQL patched.
- Schema changes: edit `backend/database/client.sql` idempotently (`CREATE ... IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`) and raise
  `SCHEMA_VERSION` in `backend/src/database/migrate.ts`; every company is upgraded at the next start. Test on a copy first, back up before deploying.

### Useful security queries
```sql
-- Recent failed logins of one company
SELECT * FROM wd_acme.SecurityEvents WHERE EventType = 'LOGIN_FAILED' ORDER BY CreatedAt DESC LIMIT 50;
-- Sign everyone of that company out (e.g. after a security incident)
UPDATE wd_acme.Sessions SET RevokedAt = now() WHERE RevokedAt IS NULL;
```

## 6. Moving from the SQL Server version

Earlier versions used SQL Server. `npm run import:sqlserver` (in `backend`) copies every company — work, history,
files, chat, notifications, with the same ids — into PostgreSQL. It reads the old `DB_SERVER`, `DB_USER`, `DB_PASSWORD`
and `DB_DATABASE` settings from `backend/.env` and writes to `DATABASE_URL`; SQL Server is only read. See the README.
