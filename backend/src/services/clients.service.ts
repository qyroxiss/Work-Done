import { ensureMainSchema } from '../database/migrate.js';
import { query, runInDatabase, runInMainDatabase, sql } from '../database/pool.js';
import { conflict, notFound } from '../utils/httpError.js';

/** A client company and the schema that holds its data. Stored in public.Clients. */
export interface Client {
  clientId: string;
  companyName: string;
  schemaName: string;
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
    schemaName: row.SchemaName as string,
    isActive: Boolean(row.IsActive),
    createdAt: (row.CreatedAt as Date).toISOString(),
  };
}

async function load(): Promise<Map<string, Client>> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.byId;
  await ensureMainSchema(); // a brand-new database gets its shared tables on first use
  const r = await runInMainDatabase(() =>
    query(`SELECT ClientId, CompanyName, SchemaName, IsActive, CreatedAt FROM public.Clients ORDER BY ClientId`),
  );
  const byId = new Map(r.recordset.map((row) => [row.ClientId as string, mapRow(row)]));
  cache = { at: Date.now(), byId };
  return byId;
}

export function invalidateClients() {
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

/** Adds a client to the registry. Its schema must already exist with the WorkDone tables. */
export async function registerClient(client: { clientId: string; companyName: string; schemaName: string }) {
  const clientId = normalizeClientId(client.clientId);
  invalidateClients();
  const existing = await runInMainDatabase(() =>
    query(`SELECT ClientId, SchemaName FROM public.Clients WHERE ClientId = @id OR SchemaName = @schema`, {
      id: [sql.NVarChar(30), clientId],
      schema: [sql.NVarChar(63), client.schemaName],
    }),
  );
  if (existing.recordset.some((r) => r.ClientId === clientId)) throw conflict(`Client ID "${clientId}" is already in use.`);
  if (existing.recordset.length) throw conflict(`Schema ${client.schemaName} already belongs to another client.`);
  // Users created before the client was registered (setup, create-admin) get its Client ID
  await runInDatabase(client.schemaName, () =>
    query(`UPDATE dbo.Users SET ClientId = @id WHERE ClientId IS NULL`, { id: [sql.NVarChar(30), clientId] }),
  );
  await runInMainDatabase(() =>
    query(`INSERT INTO public.Clients (ClientId, CompanyName, SchemaName) VALUES (@id, @name, @schema)`, {
      id: [sql.NVarChar(30), clientId],
      name: [sql.NVarChar(150), client.companyName],
      schema: [sql.NVarChar(63), client.schemaName],
    }),
  );
  invalidateClients();
  return getClient(clientId);
}

export async function updateClient(clientId: string, changes: { companyName?: string; isActive?: boolean }) {
  const client = await getClient(clientId);
  await runInMainDatabase(() =>
    query(
      `UPDATE public.Clients
       SET CompanyName = COALESCE(@name, CompanyName), IsActive = COALESCE(@active, IsActive), UpdatedAt = now()
       WHERE ClientId = @id`,
      {
        id: [sql.NVarChar(30), client.clientId],
        name: [sql.NVarChar(150), changes.companyName ?? null],
        active: [sql.Bit, changes.isActive ?? null],
      },
    ),
  );
  invalidateClients();
  return getClient(client.clientId);
}

/** Schema for a new client, e.g. Client ID "ACME-2" -> wd_acme_2. */
export function schemaNameFor(clientId: string): string {
  return `wd_${normalizeClientId(clientId).toLowerCase().replace(/[^a-z0-9]/g, '_')}`.slice(0, 63);
}
