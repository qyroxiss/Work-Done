/** Thin fetch wrapper for the WorkDone API (same origin, cookie session). */

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type UnauthorizedHandler = (message: string) => void;
let onUnauthorized: UnauthorizedHandler | null = null;

/** Registered by the auth provider: called when any request returns 401. */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null) {
  onUnauthorized = handler;
}

/** Raw request body (e.g. a file) instead of JSON, with extra headers */
interface RawBody {
  data: Blob;
  headers: Record<string, string>;
}

async function request<T>(method: string, url: string, body?: unknown, raw?: RawBody): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${url}`, {
      method,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...raw?.headers,
        // Required by the server's CSRF guard on state-changing requests
        'X-Requested-With': 'WorkDone',
      },
      body: raw ? raw.data : body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Cannot reach the server. Check your network connection.', 0, 'NETWORK');
  }

  if (res.status === 204) return undefined as T;

  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON response */
  }

  if (!res.ok) {
    const payload = (data ?? {}) as { error?: string; code?: string; fields?: Record<string, string> };
    const err = new ApiError(
      payload.error ?? `Request failed (${res.status})`,
      res.status,
      payload.code,
      payload.fields,
    );
    if (res.status === 401 && !url.startsWith('/auth/login') && onUnauthorized) {
      onUnauthorized(err.message);
    }
    throw err;
  }
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T>(url: string, body: unknown) => request<T>('PUT', url, body),
  patch: <T>(url: string, body: unknown) => request<T>('PATCH', url, body),
  delete: <T>(url: string) => request<T>('DELETE', url),
  /** Sends a file as the raw request body; the name and type travel in headers */
  upload: <T>(url: string, file: File, headers: Record<string, string> = {}) =>
    request<T>('POST', url, undefined, {
      data: file,
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-File-Name': encodeURIComponent(file.name),
        'X-File-Type': encodeURIComponent(file.type || 'application/octet-stream'),
        ...headers,
      },
    }),
};

/** Builds a query string, skipping empty values. */
export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong.';
}
