# Q-WorkDone Management System

Internal office web application for assigning, tracking and reviewing employee work, on the office LAN or in the cloud.
One installation can host **several client companies**: users sign in with a **Client ID**, User ID (or email) and password, and each client's data lives in its own PostgreSQL schema.

- **Frontend:** React + TypeScript (Vite) with Mantine UI — `frontend/`
- **Backend:** Node.js + Express 5 + TypeScript — `backend/`
- **Database:** PostgreSQL 14 or newer (on the same computer, on the network, or hosted such as Neon) — scripts in `backend/database/`
- **Auth:** server-side sessions (httpOnly cookie, SHA-256 hashed tokens in DB), bcrypt password hashing, role-based authorization enforced by the API

```
WorkDone-Management/
  backend/     Express API (routes → controllers → services → SQL)
  frontend/    React single-page app
               backend/database: main.sql (client registry), client.sql (tables of one company), seed.sql (sample data)
  scripts/     start.ps1 (launcher), server-tools.ps1 (firewall / auto-start), dev-postgres.ps1
  docs/        DEPLOYMENT.md (install, backups), API.md, TESTING.md
  WorkDone.bat double-click to install, set up and start
```

## Quick start — one click

Prerequisites on the server computer: **Node.js 20+ (LTS)** and a **PostgreSQL database** the app may create tables in:
PostgreSQL installed on this computer (free from postgresql.org; create an empty database such as `workdone`), or a hosted one such as Neon.

1. Double-click **`WorkDone.bat`**.
   First run installs packages and builds the app (needs internet once), then starts the server and opens the browser.
2. The **Setup Wizard** opens (only on the server computer itself, or anywhere with the setup key, see below):
   - **Database:** paste the connection string, e.g. `postgres://workdone:PASSWORD@localhost:5432/workdone` (Neon: `...?sslmode=require`).
     *Test connection* checks it; *Connect* saves it to `backend/.env` and creates the shared tables.
   - **Company:** company name, **Client ID** and the **administrator** username and password; optionally sample data and
     (on Windows) firewall / auto-start with Windows. The app creates the company's tables itself.
3. Sign in with the Client ID, username and password. Other office computers open the address shown at the end of setup (e.g. `http://192.168.1.10:3000`).

Afterwards just double-click `WorkDone.bat` to start (or it starts by itself at boot if auto-start was chosen). To re-run setup, remove `DATABASE_URL` from `backend/.env` and start again.

`WorkDone.bat -Rebuild` forces a fresh build after code changes.

**On Vercel:** import the GitHub repository into Vercel, add a Neon database and three environment variables — step by step in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#vercel--neon).

**Setup from another computer (cloud hosting):** set `SETUP_KEY` to a long random value in the server's environment. The setup wizard and the client page then ask for this key on any other computer.

## Multiple client companies

- The shared `public` schema holds the client registry (`public.Clients`). Each client company gets its **own schema** `wd_<clientid>` with the same tables, so data is fully separated.
- **Add a client** at `/clients` on the server computer (or with the setup key): company name, Client ID, first administrator. Or from the command line:
  ```powershell
  cd backend
  npm run add-client -- --client ACME --name "Acme Pvt Ltd" --username admin
  ```
  The client's administrator must change the password at first sign-in.
- Deactivating a client on the same page signs its users out and blocks sign-in; its data is kept.
- **Upgrades:** the app creates new tables and columns by itself when it starts; there is no separate database update step.
- Back up the whole database (all schemas) — see DEPLOYMENT.md.

### Moving from the SQL Server version

Earlier versions stored data in SQL Server. To move an installation (all companies, work, history, files, chat and notifications, with the same ids):

1. Set up PostgreSQL and add `DATABASE_URL` to `backend/.env` (keep the old `DB_SERVER`, `DB_USER`, `DB_PASSWORD`, `DB_DATABASE` lines).
2. In `backend`: `npm install`, then `npm run import:sqlserver` (add `--client ACME` for one company, `--replace` to import again).
3. Start the app. Everyone signs in with the same Client ID, username and password. SQL Server is only read, never changed.

## Manual setup (alternative)

Prerequisites: Node.js 20+ (LTS) and an empty PostgreSQL database.

1. **Configure the backend**
   ```powershell
   cd backend
   copy .env.example .env      # then set DATABASE_URL
   npm install
   ```
2. **Create the first company** (prompts for the administrator password; must be changed at first sign-in):
   ```powershell
   npm run add-client -- --client ACME --name "Acme Pvt Ltd" --username admin
   npm run db:seed -- --client ACME     # optional: sample employees/products for trying it out
   ```
3. **Run**
   ```powershell
   npm run dev                   # API on http://localhost:3000
   cd ..\frontend; npm install; npm run dev   # UI on http://localhost:5173
   ```
   Check `http://localhost:3000/api/health` → `{"status":"ok","database":"connected"}`.

Other commands: `npm run db:setup` (create/upgrade all tables now), `npm run create-admin -- --client ACME --username boss` (add an administrator, or `--reset` a forgotten password).

For production deployment (single port, the API serves the built UI) see **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**.
## Roles

| Capability | Admin | Manager | Employee |
|---|:-:|:-:|:-:|
| Dashboard | all work | all work | own work |
| View work grid / details | all | all | assigned only |
| Create, edit, assign work | ✓ | ✓ | |
| Change status of assigned work, add notes | ✓ | ✓ | ✓ |
| Close / reopen work (review) | ✓ | ✓ | |
| View employees | ✓ | ✓ | |
| Manage employees, product groups, products | ✓ | | |
| Reports | ✓ | ✓ | |
| Manage users, reset passwords | ✓ | | |
| Chat (Everyone group + one-to-one, own company only) | ✓ | ✓ | ✓ |
| Repeating work (monthly returns, weekly checks…) | ✓ | ✓ | |
| Attach files to work, @mention people in notes | ✓ | ✓ | assigned work |
| Notifications (assigned, status, mentions, files, due today, overdue) | ✓ | ✓ | ✓ |

## Everyday features

- **Repeating work** (*Manage → Repeating work*): set up work that comes round every week, month, quarter or year once. Each item is created automatically a chosen number of days before it is due and assigned to the same people. Titles can include `{month}`, `{prevMonth}` and `{date}`, e.g. "GSTR-3B for {prevMonth}" becomes "GSTR-3B for Sep 2026".
- **Notifications**: the bell in the top bar shows when work is assigned to you, its status changes, someone adds a note, mentions you (`@username`) or attaches a file, and when your work is due today or overdue. They arrive live, like chat.
- **Files on work items**: drop files on a work item or use *Add file* (up to 20 MB each). Files are stored in the company's own database, so they are included in its backups.
- **Saved views**: on the Work page, set filters and use *Save view* to keep them as a one-click chip (stored in that browser).
- **Excel export**: Reports export to Excel (.xlsx) or CSV.
- **Keyboard shortcuts**: press `?` to see them (`/` search, `N` new work, `G` then `W` for Work, …).
- **Light and dark mode**, and on HTTPS (or on the server computer) Q-WorkDone can be installed as an app from the browser.

## Work status rules

```
Pending ──► In Progress ──► Completed ──► Closed
   │            ▲  │            │           │
   └──► On Hold ◄──┘            └─► Reopened ◄┘
                                     │
                            ► In Progress / On Hold
```

- Employees: Pending → In Progress / On Hold; In Progress → On Hold / Completed (submit for review); On Hold → In Progress; Reopened → In Progress / On Hold.
- Managers/Admins additionally: Completed → Closed or Reopened; Closed → Reopened.
- A note is required when putting work **On Hold** or **Reopening** it.
- Closed work cannot be edited or reassigned until reopened.
- Every create, edit, assignment change, status change and note is recorded in `WorkStatusHistory` with the user and time.

These rules live in `backend/src/services/workflow.ts` — change them there if the office process differs.

## Business decisions made (confirm with the office)

- Master records (employees, products, groups, users) are **never deleted**, only deactivated, so history stays intact.
- Deactivated employees cannot log in or be newly assigned; existing assignments remain visible.
- Any manager may edit/assign any work item (not only work they created).
- Employees cannot reassign work.
- Concurrent edits are detected with a row version number; the second save gets "changed by someone else — reload".
