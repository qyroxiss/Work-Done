# Q-WorkDone Management System

Internal office web application for assigning, tracking and reviewing employee work over the office LAN.
One server can host **several client companies**: users sign in with a **Client ID**, User ID (or email) and password, and each client's data lives in its own SQL Server database.

- **Frontend:** React + TypeScript (Vite) with Mantine UI — `frontend/`
- **Backend:** Node.js + Express 5 + TypeScript — `backend/`
- **Database:** Microsoft SQL Server 2019 / 2022 / 2025 — scripts in `database/`
- **Auth:** server-side sessions (httpOnly cookie, SHA-256 hashed tokens in DB), bcrypt password hashing, role-based authorization enforced by the API

```
WorkDone-Management/
  backend/     Express API (routes → controllers → services → SQL)
  frontend/    React single-page app
  database/    create-database.sql, schema.sql, indexes.sql, clients.sql (main DB only), seed.sql
  scripts/     start.ps1 (launcher), sql-tools.ps1 (admin actions used by the setup wizard)
  docs/        DEPLOYMENT.md (LAN install, backups), API.md, TESTING.md
  WorkDone.bat double-click to install, set up and start
```

## Quick start — one click

Prerequisites on the server computer: **Node.js 20+ (LTS)** and **SQL Server** (any edition, incl. Express).

1. Double-click **`WorkDone.bat`**.
   First run installs packages and builds the app (needs internet once), then starts the server and opens the browser.
2. The **Setup Wizard** opens automatically (only on the server computer itself) and **sets up the database by itself**:
   - picks this computer's best SQL Server instance (2019+ preferred; force one with `SETUP_SQL_INSTANCE=SQL2022` in the environment),
   - if needed starts its service, turns on TCP/IP and enables SQL logins — **one Windows administrator prompt, click “Yes”**,
   - signs in with your Windows account and creates the `WorkDoneDB` database, tables, indexes and a least-privilege `workdone_app` login with a random password, then writes `backend/.env`.
   You are then asked for your **company name and Client ID** and the **administrator username and password** (plus optional firewall / auto-start with Windows).
   If anything cannot be done automatically (e.g. no SQL Server, or your Windows account is not a SQL Server admin), the error is shown with a **Manual setup** option to pick the server and sign in with an SQL login such as `sa`.
3. Sign in with the Client ID, username and password. Other office computers open the address shown at the end of setup (e.g. `http://192.168.1.10:3000`).

Afterwards just double-click `WorkDone.bat` to start (or it starts by itself at boot if auto-start was chosen). To re-run setup, delete `backend/.env` and start again.

`WorkDone.bat -Rebuild` forces a fresh build after code changes.

## Multiple client companies

- The database created by setup (`WorkDoneDB`) is the **main database**. It holds the client registry (`dbo.Clients`) and the data of the first client.
- Each further client gets its **own database** `WorkDone_<CLIENTID>` with the same tables, so data is fully separated.
- **Add a client** on the server computer at `http://localhost:3000/clients` (company name, Client ID, first administrator), or from the command line:
  ```powershell
  cd backend
  npm run add-client -- --client ACME --name "Acme Pvt Ltd" --username admin
  ```
  This creates the database with your Windows account (needs SQL Server admin rights; or set `SETUP_DB_USER` / `SETUP_DB_PASSWORD`). The client's administrator must change the password at first sign-in.
- Deactivating a client on the same page signs its users out and blocks sign-in; its data is kept.
- **Upgrading from a single-company version:** the server computer shows *Update database* and then *Set your Client ID* once; existing data stays with that Client ID.
- **Upgrading to this version** (repeating work, notifications, work files): open the app on the server computer once and click *Update database*. It adds the new tables to every client database; existing data is kept.
- Back up **every** `WorkDone*` database (see DEPLOYMENT.md).

## Manual setup (alternative)

Prerequisites: Node.js 20+ (LTS), SQL Server with **TCP/IP enabled**, SSMS.

1. **Create the database and app login** — open `database/create-database.sql` in SSMS, change the password, run it.
2. **Configure the backend**
   ```powershell
   cd backend
   copy .env.example .env      # then edit DB_SERVER, DB_USER, DB_PASSWORD ...
   npm install
   ```
3. **Create tables** (run with an account that has db_owner rights; the app login only needs read/write):
   ```powershell
   $env:SETUP_DB_USER="sa_or_owner_login"; $env:SETUP_DB_PASSWORD="..."
   npm run db:setup              # schema + indexes
   npm run db:seed               # optional: sample employees/products for development
   ```
   Alternatively run `database/schema.sql`, `indexes.sql`, `seed.sql` in SSMS.
4. **Create the first administrator** (prompts for the password; must be changed at first login):
   ```powershell
   npm run create-admin -- --username admin
   ```
   Then open the app on the server computer once to set the company name and Client ID. With several clients add `--client <ID>` to `create-admin`.
5. **Run**
   ```powershell
   npm run dev                   # API on http://localhost:3000
   cd ..\frontend; npm install; npm run dev   # UI on http://localhost:5173
   ```
   Check `http://localhost:3000/api/health` → `{"status":"ok","database":"connected"}`.

For production / office LAN deployment (single port, the API serves the built UI) see **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**.

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
- Concurrent edits are detected with a SQL `ROWVERSION`; the second save gets "changed by someone else — reload".
