import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../../config.js';
import { one, query } from '../../db/pool.js';
import { runInBackground } from '../../lib/background.js';
import { clearSessionCookies, createSession, hashPassword, requireAuth, verifyPassword } from '../../lib/auth.js';
import { conflict, HttpError } from '../../lib/errors.js';
import { parseBody } from '../../lib/validate.js';
import { notifyPasswordChanged, requestPasswordReset, resetPassword } from './passwordReset.js';
import { createUser } from './service.js';

export const authRouter = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => config.RATE_LIMIT_DISABLED,
  message: { error: { code: 'rate_limited', message: 'Too many attempts. Please wait a few minutes and try again.' } },
});

const password = z.string().min(10, 'Use at least 10 characters').max(200);
const email = z.string().trim().toLowerCase().email().max(254);

authRouter.post('/register', authLimiter, async (req, res) => {
  const body = parseBody(z.object({ email, password, displayName: z.string().trim().min(1).max(80) }), req);
  const exists = await one('SELECT 1 FROM users WHERE email = $1', [body.email]);
  if (exists) throw conflict('An account with this email already exists');
  const user = await createUser(body.email, body.password, body.displayName);
  if (req.user) await query('DELETE FROM sessions WHERE id = $1', [req.user.sessionId]); // replace any session this browser had
  const csrfToken = await createSession(res, user.id);
  res.status(201).json({ user: { id: user.id, email: user.email, role: user.role }, csrfToken });
});

authRouter.post('/login', authLimiter, async (req, res) => {
  const body = parseBody(z.object({ email, password: z.string().min(1).max(200) }), req);
  const user = await one('SELECT id, email, role, password_hash FROM users WHERE email = $1', [body.email]);
  // Same message and comparable work whether or not the account exists.
  const ok = user ? await verifyPassword(body.password, user.password_hash) : (await hashPassword(body.password), false);
  if (!user || !ok) throw new HttpError(401, 'invalid_credentials', 'Incorrect email or password');
  if (req.user) await query('DELETE FROM sessions WHERE id = $1', [req.user.sessionId]); // replace any session this browser had
  const csrfToken = await createSession(res, user.id);
  res.json({ user: { id: user.id, email: user.email, role: user.role }, csrfToken });
});

authRouter.post('/logout', requireAuth, async (req, res) => {
  await query('DELETE FROM sessions WHERE id = $1', [req.user!.sessionId]);
  clearSessionCookies(res);
  res.status(204).end();
});

// Reset requests are limited per IP here and per account in requestPasswordReset.
const forgotLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => config.RATE_LIMIT_DISABLED,
  message: { error: { code: 'rate_limited', message: 'Too many reset requests. Please wait a few minutes and try again.' } },
});

const RESET_REQUESTED = 'If an account exists for that email, a reset link has been sent.';

authRouter.post('/forgot-password', forgotLimiter, async (req, res) => {
  const body = parseBody(z.object({ email }), req);
  // The lookup and email happen after the response, so the reply and its timing are the same
  // whether or not the account exists.
  runInBackground('password_reset_request', () => requestPasswordReset(body.email));
  res.json({ message: RESET_REQUESTED });
});

authRouter.post('/reset-password', authLimiter, async (req, res) => {
  const body = parseBody(z.object({ token: z.string().min(10).max(200), password }), req);
  const user = await resetPassword(body.token, body.password);
  runInBackground('password_changed_notice', () => notifyPasswordChanged(user));
  res.json({ message: 'Password updated. Please sign in.' });
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const profile = await one('SELECT * FROM user_profiles WHERE user_id = $1', [req.user!.id]);
  res.json({ user: { id: req.user!.id, email: req.user!.email, role: req.user!.role }, profile, csrfToken: req.user!.csrfToken });
});
