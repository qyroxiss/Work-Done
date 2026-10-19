import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { HttpError } from '../utils/httpError.js';

export const apiNotFound: RequestHandler = (_req, res) => {
  res.status(404).json({ error: 'API endpoint not found.', code: 'NOT_FOUND' });
};

/**
 * Converts errors to safe JSON responses. Internal details (SQL messages,
 * connection strings, stack traces) are logged on the server only.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (res.headersSent) return;

  if (err instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of err.issues) {
      const key = issue.path.join('.') || '_';
      if (!fields[key]) fields[key] = issue.message;
    }
    res.status(400).json({ error: 'Please correct the highlighted fields.', code: 'VALIDATION', fields });
    return;
  }

  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, code: err.code });
    return;
  }

  // Malformed JSON body / payload too large from express.json()
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Malformed JSON request body.', code: 'BAD_REQUEST' });
    return;
  }
  if (err?.type === 'entity.too.large') {
    res.status(413).json({ error: 'Request body is too large.', code: 'TOO_LARGE' });
    return;
  }

  // SQL Server constraint violations
  const sqlNumber: number | undefined = err?.number ?? err?.originalError?.info?.number;
  if (sqlNumber === 2627 || sqlNumber === 2601) {
    res.status(409).json({ error: 'A record with the same code or name already exists.', code: 'DUPLICATE' });
    return;
  }
  if (sqlNumber === 547) {
    res.status(400).json({ error: 'The operation conflicts with related records.', code: 'CONSTRAINT' });
    return;
  }

  console.error(`[error] ${req.method} ${req.originalUrl}:`, err);
  const dbDown = err?.code === 'ESOCKET' || err?.code === 'ELOGIN' || err?.code === 'ETIMEOUT' || err?.name === 'ConnectionError';
  res.status(dbDown ? 503 : 500).json({
    error: dbDown
      ? 'The database is currently unavailable. Please try again shortly.'
      : 'An unexpected error occurred. Please try again.',
    code: dbDown ? 'DB_UNAVAILABLE' : 'INTERNAL',
  });
};
