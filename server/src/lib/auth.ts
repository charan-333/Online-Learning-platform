import crypto from 'node:crypto';
import { promisify } from 'node:util';
import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import { one, query } from '../db/pool.js';
import { forbidden, HttpError, unauthorized } from './errors.js';

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, keylen: number, opts: crypto.ScryptOptions) => Promise<Buffer>;
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export const SESSION_COOKIE = 'cat100_session';
export const CSRF_COOKIE = 'cat100_csrf';

/** scrypt$N$r$p$salt$hash — parameters stored so they can be raised later. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, saltB64, hashB64] = stored.split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem });
  return crypto.timingSafeEqual(expected, actual);
}

export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
export const randomToken = () => crypto.randomBytes(32).toString('base64url');

export interface AuthUser {
  id: string;
  email: string;
  role: 'learner' | 'admin';
  sessionId: string;
  csrfToken: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export async function createSession(res: Response, userId: string) {
  const token = randomToken();
  const csrf = randomToken();
  const expires = new Date(Date.now() + config.SESSION_TTL_DAYS * 86400_000);
  await query('INSERT INTO sessions(user_id, token_hash, csrf_token, expires_at) VALUES ($1,$2,$3,$4)', [userId, sha256(token), csrf, expires]);
  const base = { secure: config.COOKIE_SECURE, sameSite: 'lax' as const, path: '/', expires };
  res.cookie(SESSION_COOKIE, token, { ...base, httpOnly: true });
  res.cookie(CSRF_COOKIE, csrf, { ...base, httpOnly: false });
  return csrf;
}

export function clearSessionCookies(res: Response) {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.clearCookie(CSRF_COOKIE, { path: '/' });
}

/** Loads the user from the session cookie when present. Never throws for anonymous requests. */
export async function loadUser(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return next();
  const row = await one(
    `SELECT s.id AS session_id, s.csrf_token, u.id, u.email, u.role
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [sha256(token)],
  );
  if (row) {
    req.user = { id: row.id, email: row.email, role: row.role, sessionId: row.session_id, csrfToken: row.csrf_token };
    query('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [row.session_id]).catch(() => {});
  }
  next();
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Double-submit CSRF check for cookie-authenticated, state-changing requests. */
// Credential endpoints act on the submitted credentials, not the current session, so
// a browser that is already signed in can still switch accounts. SameSite=Lax cookies
// stop cross-site form posts to them.
const CSRF_EXEMPT = new Set(['/api/auth/login', '/api/auth/register', '/api/auth/forgot-password', '/api/auth/reset-password']);

export function csrfProtection(req: Request, _res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method) || !req.user || CSRF_EXEMPT.has(req.path)) return next();
  const header = req.get('x-csrf-token');
  if (!header || header.length !== req.user.csrfToken.length || !crypto.timingSafeEqual(Buffer.from(header), Buffer.from(req.user.csrfToken))) {
    return next(new HttpError(403, 'csrf_failed', 'Security token missing or invalid. Refresh the page and try again.'));
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(unauthorized());
  next();
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(unauthorized());
  if (req.user.role !== 'admin') return next(forbidden('Administrator access required'));
  next();
}

export function userId(req: Request): string {
  if (!req.user) throw unauthorized();
  return req.user.id;
}
