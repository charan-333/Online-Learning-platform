import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../../config.js';
import { one, query } from '../../db/pool.js';
import { clearSessionCookies, createSession, hashPassword, randomToken, requireAuth, sha256, verifyPassword } from '../../lib/auth.js';
import { badRequest, conflict, HttpError } from '../../lib/errors.js';
import { sendMail } from '../../lib/mailer.js';
import { parseBody } from '../../lib/validate.js';
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

authRouter.post('/forgot-password', authLimiter, async (req, res) => {
  const body = parseBody(z.object({ email }), req);
  const user = await one('SELECT id, email FROM users WHERE email = $1', [body.email]);
  if (user) {
    const token = randomToken();
    await query('INSERT INTO password_reset_tokens(user_id, token_hash, expires_at) VALUES ($1,$2, now() + interval \'1 hour\')', [user.id, sha256(token)]);
    await sendMail({
      to: user.email,
      subject: 'Reset your CAT 100 password',
      text: `Use this link within one hour to choose a new password: ${config.APP_URL}/reset-password?token=${token}`,
    });
  }
  // Same response either way so the endpoint cannot be used to discover accounts.
  res.json({ message: 'If an account exists for that email, a reset link has been sent.' });
});

authRouter.post('/reset-password', authLimiter, async (req, res) => {
  const body = parseBody(z.object({ token: z.string().min(10).max(200), password }), req);
  const row = await one('SELECT id, user_id FROM password_reset_tokens WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()', [sha256(body.token)]);
  if (!row) throw badRequest('This reset link is invalid or has expired');
  await query('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [row.user_id, await hashPassword(body.password)]);
  await query('UPDATE password_reset_tokens SET used_at = now() WHERE id = $1', [row.id]);
  await query('DELETE FROM sessions WHERE user_id = $1', [row.user_id]); // sign out everywhere
  res.json({ message: 'Password updated. Please sign in.' });
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const profile = await one('SELECT * FROM user_profiles WHERE user_id = $1', [req.user!.id]);
  res.json({ user: { id: req.user!.id, email: req.user!.email, role: req.user!.role }, profile, csrfToken: req.user!.csrfToken });
});
