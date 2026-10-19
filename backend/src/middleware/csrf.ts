import type { RequestHandler } from 'express';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
export const CSRF_HEADER = 'x-requested-with';
export const CSRF_HEADER_VALUE = 'WorkDone';

/**
 * CSRF defence in depth (the session cookie is also SameSite=Strict):
 * state-changing API calls must carry a custom header. Browsers do not let
 * other sites add custom headers to cross-origin requests without a CORS
 * preflight, and this API does not enable CORS.
 */
export const csrfGuard: RequestHandler = (req, res, next) => {
  if (SAFE_METHODS.has(req.method) || req.get(CSRF_HEADER) === CSRF_HEADER_VALUE) {
    next();
    return;
  }
  res.status(403).json({ error: 'Request blocked (missing security header).', code: 'CSRF' });
};
