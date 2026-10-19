import { query, runInDatabase, runInMainDatabase, sql } from '../database/pool.js';
import { conflict, notFound } from '../utils/httpError.js';

/** A client company and the database that holds its data. Stored in dbo.Clients of the main database. */
export interface Client {
  clientId: string;
  companyName: string;
  databaseName: string;
  isActive: boolean;
  createdAt: string;
}

// Looked up on every request, so keep a short-lived in-memory copy. It expires because
// clients can also be added by the add-client script, which runs in another process.
const CACHE_MS = 60_000;
let cache: { at: number; byId: Map<string, Client> } | null = null;

function mapRow(row: Record<string, unknown>): Client {
  return {
    clientId: row.ClientId as string,
    companyName: row.CompanyName as string,
    databaseName: row.DatabaseName as string,
    isActive: Boolean(row.IsActive),
    createdAt: (row.CreatedAt as Date).toISOString(),
  };
}

async function load(): Promise<Map<string, Client>> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.byId;
  const r = await runInMainDatabase(() =>
    query(`SELECT ClientId, CompanyName, DatabaseName, IsActive, CreatedAt FROM dbo.Clients ORDER BY ClientId`),
  );
  const byId = new Map(r.recordset.map((row) => [row.ClientId as string, mapRow(row)]));
  cache = { at: Date.now(), byId };
  return byId;
}

function invalidate() {
  cache = null;
}

/** Client IDs are compared case-insensitively and stored upper-case. */
export function normalizeClientId(value: string): string {
  return value.trim().toUpperCase();
}

export async function findClient(clientId: string): Promise<Client | null> {
  return (await load()).get(normalizeClientId(clientId)) ?? null;
}

export async function getClient(clientId: string): Promise<Client> {
  const client = await findClient(clientId);
  if (!client) throw notFound('Client');
  return client;
}

export async function listClients(): Promise<Client[]> {
  return [...(await load()).values()];
}

/** Adds a client to the registry. Its database must already exist with the WorkDone tables. */
export async function registerClient(client: { clientId: string; companyName: string; databaseName: string }) {
  const clientId = normalizeClientId(client.clientId);
  invalidate();
  const existing = await runInMainDatabase(() =>
    query(`SELECT ClientId, DatabaseName FROM dbo.Clients WHERE ClientId = @id OR DatabaseName = @db`, {
      id: [sql.NVarChar(30), clientId],
      db: [sql.NVarChar(128), client.databaseName],
    }),
  );
  if (existing.recordset.some((r) => r.ClientId === clientId)) throw conflict(`Client ID "${clientId}" is already in use.`);
  if (existing.recordset.length) throw conflict(`Database ${client.databaseName} already belongs to another client.`);
  // Users created before the client existed (setup, create-admin, upgraded databases) get its Client ID
  await runInDatabase(client.databaseName, () =>
    query(`UPDATE dbo.Users SET ClientId = @id WHERE ClientId IS NULL`, { id: [sql.NVarChar(30), clientId] }),
  );
  await runInMainDatabase(() =>
    query(`INSERT INTO dbo.Clients (ClientId, CompanyName, DatabaseName) VALUES (@id, @name, @db)`, {
      id: [sql.NVarChar(30), clientId],
      name: [sql.NVarChar(150), client.companyName],
      db: [sql.NVarChar(128), client.databaseName],
    }),
  );
  invalidate();
  return getClient(clientId);
}

export async function updateClient(clientId: string, changes: { companyName?: string; isActive?: boolean }) {
  const client = await getClient(clientId);
  await runInMainDatabase(() =>
    query(
      `UPDATE dbo.Clients
       SET CompanyName = ISNULL(@name, CompanyName), IsActive = ISNULL(@active, IsActive), UpdatedAt = SYSUTCDATETIME()
       WHERE ClientId = @id`,
      {
        id: [sql.NVarChar(30), client.clientId],
        name: [sql.NVarChar(150), changes.companyName ?? null],
        active: [sql.Bit, changes.isActive ?? null],
      },
    ),
  );
  invalidate();
  return getClient(client.clientId);
}

/** Suggested database name for a new client, e.g. Client ID "ACME-2" -> WorkDone_ACME_2. */
export function databaseNameFor(clientId: string): string {
  return `WorkDone_${normalizeClientId(clientId).replace(/[^A-Z0-9]/g, '_')}`;
}
