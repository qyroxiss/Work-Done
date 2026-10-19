export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const notFound = (what = 'Record') => new HttpError(404, `${what} not found.`, 'NOT_FOUND');
export const badRequest = (message: string) => new HttpError(400, message, 'BAD_REQUEST');
export const conflict = (message: string) => new HttpError(409, message, 'CONFLICT');
export const forbidden = (message = 'You do not have permission to perform this action.') =>
  new HttpError(403, message, 'FORBIDDEN');
