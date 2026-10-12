import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { logger } from './logger.js';

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, details?: unknown) => new HttpError(400, 'bad_request', msg, details);
export const unauthorized = (msg = 'Sign in required') => new HttpError(401, 'unauthorized', msg);
export const forbidden = (msg = 'You do not have access to this resource') => new HttpError(403, 'forbidden', msg);
export const notFound = (what = 'Resource') => new HttpError(404, 'not_found', `${what} not found`);
export const conflict = (msg: string) => new HttpError(409, 'conflict', msg);

/** Consistent error envelope: { error: { code, message, details? } }. Never leaks stack traces. */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: { code: 'validation_error', message: 'Invalid request', details: err.flatten() } });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  const pgErr = err as { code?: string };
  if (pgErr?.code === '22P02') {
    return res.status(400).json({ error: { code: 'bad_request', message: 'Malformed identifier' } });
  }
  if ((err as any)?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'bad_request', message: 'Malformed JSON body' } });
  }
  if ((err as any)?.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'payload_too_large', message: 'Request body too large' } });
  }
  logger.error({ err, path: req.path }, 'unhandled error');
  return res.status(500).json({ error: { code: 'internal_error', message: 'Something went wrong. Please try again.' } });
}
