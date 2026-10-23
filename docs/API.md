# API Reference

Base URL: `/api`. All responses are JSON. Errors: `{ "error": "message", "code": "CODE", "fields"?: { "field": "message" } }`.

**Authentication:** session cookie `wd_session` (httpOnly, SameSite=Strict) set by `POST /api/auth/login`. Its value is `<ClientId>.<token>`: the Client ID routes every request to that client's database.
**CSRF:** every non-GET request must send the header `X-Requested-With: WorkDone`.
**Sessions** expire after `SESSION_IDLE_MINUTES` of inactivity or `SESSION_MAX_HOURS` total.

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | /health | public | DB connectivity check |
| POST | /auth/login | public | `{clientId, username, password}` (`username` may be an email); returns `{user, company, session}`; rate limited (10 failures / 15 min / IP) |
| POST | /auth/logout | any | revokes the session |
| GET | /auth/me | any | current user and company |
| GET | /settings/company | any | `{companyName, clientId}` of the signed-in client |
| PUT | /settings/company | Admin | `{companyName}` (the Client ID cannot be changed) |
| POST | /auth/change-password | any | `{currentPassword, newPassword}`; signs out other sessions |
| GET | /dashboard | any | employees: own work only |
| GET | /employees | Admin, Manager | `?search&isActive&page&pageSize` |
| GET | /employees/:id | Admin, Manager | |
| POST / PUT | /employees, /employees/:id | Admin | |
| GET | /product-groups, /product-groups/:id | any | |
| POST / PUT | /product-groups, /product-groups/:id | Admin | |
| GET | /products, /products/:id | any | `?productGroupId` |
| POST / PUT | /products, /products/:id | Admin | |
| GET | /work-items | any | filters below; employees see only assigned work |
| POST | /work-items | Admin, Manager | `{title, description, productGroupId, productId, priority, startDate, dueDate, employeeIds[]}` |
| GET | /work-items/:id | any (assigned) | includes assignees, history, `allowedTransitions`, `rowVersion` |
| PUT | /work-items/:id | Admin, Manager | same as POST + `rowVersion` (409 if stale) |
| POST | /work-items/:id/assignments | Admin, Manager | `{employeeIds[]}` — replaces the active assignee set |
| PATCH | /work-items/:id/status | any (assigned) | `{status, notes, rowVersion}` |
| POST | /work-items/:id/notes | any (assigned) | `{notes}`; `@username` notifies that person if they can see the work |
| GET | /work-items/:id/mentionable | any (assigned) | people who can be @mentioned on this work item |
| POST | /work-items/:id/attachments | any (assigned) | raw file body as `application/octet-stream`, headers `X-File-Name`, `X-File-Type` (URL-encoded); max 20 MB; program files refused; not on Closed work |
| GET | /work-attachments/:id | any (assigned) | the file; images inline, everything else as a download (`?download=1` forces download) |
| DELETE | /work-attachments/:id | uploader, Admin, Manager | erases the file content; the history entry stays |
| GET | /recurring-work | Admin, Manager | `?search&isActive&page&pageSize`; each template has `nextDueDate`, `nextCreateDate`, `upcoming[]`, `createdCount` |
| GET | /recurring-work/:id | Admin, Manager | |
| POST / PUT | /recurring-work, /recurring-work/:id | Admin, Manager | `{title, description, productGroupId, productId, priority, frequency (Weekly/Monthly/Quarterly/Yearly), nextDueDate, leadDays (0–90), endDate, employeeIds[], isActive}`; returns `{template, created}` (items created right away if already due) |
| GET | /notifications | any | `?limit&before=<id>` — own notifications, newest first, plus `unread` |
| GET | /notifications/unread | any | `{unread}` |
| POST | /notifications/read | any | `{ids[]}` or `{all: true}` |
| GET | /reports/employee-work | Admin, Manager | `?fromDate&toDate&employeeId&productGroupId` |
| GET | /reports/pending-work | Admin, Manager | `?employeeId&productGroupId` |
| GET | /reports/overdue-work | Admin, Manager | `?employeeId&productGroupId` |
| GET | /reports/completed-work | Admin, Manager | `fromDate`, `toDate` required |
| GET | /reports/work-summary | Admin, Manager | `fromDate`, `toDate` required (max 366 days) |
| GET | /users, /users/:id | Admin | never returns password hashes |
| POST | /users | Admin | `{username, password, role, employeeId, isActive}` |
| PUT | /users/:id | Admin | `{role, employeeId, isActive}` |
| POST | /users/:id/reset-password | Admin | `{password}`; forces change at next login |

### Work item list filters
`search`, `status` (comma list, e.g. `Pending,In Progress`), `priority`, `employeeId`, `productGroupId`, `productId`, `assignment` (`assigned`|`unassigned`), `dateField` (`due`|`start`|`created`) with `fromDate`/`toDate` (`YYYY-MM-DD`), `overdue=true`, `sortBy` (`workNo|title|priority|status|startDate|dueDate|createdAt|updatedAt|product`), `sortDir` (`asc|desc`), `page`, `pageSize` (max 500).

Response: `{ items: [...], total, page, pageSize }`.

## Chat

Users chat only with people of their own company (same Client ID / database). Every company has one
"Everyone" conversation; any two users have at most one direct conversation; anyone can create named groups.

| Method | Path | Notes |
|---|---|---|
| GET | /chat/users | active users that can be messaged (not yourself) |
| GET | /chat/conversations | Everyone first, then by latest message; each with `unread`, `lastMessage`, `memberCount` |
| GET | /chat/conversations/:id | one conversation |
| POST | /chat/direct | `{userId}` — opens (or creates) the direct chat with that user |
| POST | /chat/groups | `{title, memberIds[]}` — creator becomes a member |
| PATCH | /chat/groups/:id | `{title}` — creator or Admin |
| GET | /chat/conversations/:id/members | members of a chat |
| POST | /chat/groups/:id/members | `{userIds[]}` — creator or Admin; new members do not get old messages as unread |
| DELETE | /chat/groups/:id/members/:userId | creator or Admin removes; any member removes themself (leave) |
| GET | /chat/conversations/:id/messages | `?before=` / `?after=` / `?around=<messageId>` and `limit`; oldest first, `hasMore`, `hasNewer` |
| POST | /chat/conversations/:id/messages | `{body}` (1–2000 characters) |
| POST | /chat/conversations/:id/attachments | raw file body as `application/octet-stream`, headers `X-File-Name`, `X-File-Type`, optional `X-Caption` (URL-encoded); max 10 MB; program files (.exe, .bat, .js, …) refused |
| GET | /chat/attachments/:id | the file; PNG/JPEG/GIF/WebP inline, everything else as a download (`?download=1` forces download) |
| PATCH | /chat/messages/:id | `{body}` — own messages only; marks the message edited |
| DELETE | /chat/messages/:id | own messages, or any message for Admins; text and file are removed for everyone |
| POST | /chat/conversations/:id/read | `{messageId}` — marks messages up to that id as read; returns total `unread` |
| GET | /chat/unread | `{unread}` across all conversations |
| GET | /chat/search | `?q=` (2+ characters) — message text and file names in your own chats, newest 50 |
| GET | /chat/events | Server-Sent Events: `message`, `message-updated` (edit/delete), `read`, `conversation` (group created/renamed/members changed), and for work: `notification`, `notifications-read` |

Chats you are not a member of answer 404. Files are stored in the client's own database (`dbo.ChatAttachments`).

## Repeating work and reminders

A background job runs at server start and every 15 minutes for every active client. It creates the work items of
repeating templates `leadDays` before they are due (catching up at most 12 missed items per template), and sends
"due today" reminders to assignees and "overdue" reminders (once per due date) to assignees and the creator.
Titles may contain `{month}` (due month, e.g. "Oct 2026"), `{prevMonth}` ("Sep 2026") and `{date}` ("20 Oct 2026").

## Setup and client companies

Answered only for requests from the server computer itself (localhost), or with the header `X-Setup-Key` equal to
the server's `SETUP_KEY` (when set). Each client has its own schema `wd_<clientid>`, registered in `public.Clients`.

| Method | Path | Notes |
|---|---|---|
| GET | /setup/status | `{needsSetup, step: database \| admin \| done, isLocal, onServerComputer, setupKeyEnabled}`; open to everyone |
| POST | /setup/test-connection | `{url}` (PostgreSQL connection string) → `{ok, version, database, user, canCreate}` or `{ok: false, error}` |
| POST | /setup/database | `{url}`: saves `DATABASE_URL` to `backend/.env` and creates the shared tables |
| POST | /setup/admin | `{companyName, clientId, username, email?, password, loadSampleData?}`: first company and its administrator |
| POST | /setup/system-action | `{action: firewall \| autostart}` (Windows, server computer only, during setup) |
| GET | /setup/clients | `{items[]}` (after setup) |
| POST | /setup/clients | `{companyName, clientId, username, email?, password}`. Creates the schema, tables and first admin (must change password) |
| PATCH | /setup/clients/:clientId | `{companyName?, isActive?}`. Deactivating ends that client's sessions and blocks sign-in |
