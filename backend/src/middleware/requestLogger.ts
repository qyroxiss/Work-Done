import type { RequestHandler } from 'express';

/** Minimal access log for API calls. Never logs bodies, cookies or query values that may hold secrets. */
export const requestLogger: RequestHandler = (req, res, next) => {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    const user = req.user ? ` user=${req.user.clientId}/${req.user.username}` : '';
    console.log(`${req.method} ${req.path} ${res.statusCode} ${ms.toFixed(0)}ms${user}`);
  });
  next();
};
