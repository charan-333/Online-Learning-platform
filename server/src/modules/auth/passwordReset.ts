import { config } from '../../config.js';
import { one, query, tx } from '../../db/pool.js';
import { hashPassword, randomToken, sha256 } from '../../lib/auth.js';
import { badRequest } from '../../lib/errors.js';
import { recordSuppressed, sendMail } from '../../lib/mailer.js';

const appUrl = () => config.APP_URL.replace(/\/+$/, '');

/**
 * Issues a single-use reset token and emails the link. Only the SHA-256 of the token is stored;
 * the raw token exists only in the email. Earlier unused tokens for the account are revoked.
 * Callers must not reveal the outcome to the requester (account enumeration).
 */
export async function requestPasswordReset(email: string): Promise<'no_account' | 'rate_limited' | 'sent' | 'failed'> {
  const user = await one('SELECT id, email FROM users WHERE email = $1', [email]);
  if (!user) return 'no_account';
  const recent = await one("SELECT count(*) AS n FROM password_reset_tokens WHERE user_id = $1 AND created_at > now() - interval '1 hour'", [user.id]);
  if (Number(recent?.n ?? 0) >= config.PASSWORD_RESET_MAX_PER_HOUR) {
    await recordSuppressed({ purpose: 'password_reset', userId: user.id }, 'Too many reset requests for this account in the last hour');
    return 'rate_limited';
  }
  const token = randomToken();
  await tx(async (c) => {
    await query('UPDATE password_reset_tokens SET revoked_at = now() WHERE user_id = $1 AND used_at IS NULL AND revoked_at IS NULL', [user.id], c);
    await query('INSERT INTO password_reset_tokens(user_id, token_hash, expires_at) VALUES ($1, $2, now() + make_interval(mins => $3::int))', [
      user.id,
      sha256(token),
      config.PASSWORD_RESET_TTL_MIN,
    ], c);
  });
  const link = `${appUrl()}/reset-password?token=${encodeURIComponent(token)}`;
  const minutes = config.PASSWORD_RESET_TTL_MIN;
  const result = await sendMail(
    {
      to: user.email,
      subject: 'Reset your CAT 100 password',
      text: [
        'Someone asked to reset the password for your CAT 100 account.',
        '',
        `Use this link within ${minutes} minutes to choose a new password. It works once.`,
        link,
        '',
        'If you did not ask for this, ignore this email. Your password stays the same.',
      ].join('\n'),
    },
    { purpose: 'password_reset', userId: user.id },
  );
  if (result.status === 'sent') return 'sent';
  // Nobody received this link, so it must never work.
  await query('UPDATE password_reset_tokens SET revoked_at = now() WHERE token_hash = $1', [sha256(token)]);
  return 'failed';
}

/** Consumes a token atomically: it can succeed once, before it expires, and only if not revoked. */
export async function resetPassword(token: string, newPassword: string) {
  const hash = await hashPassword(newPassword);
  const user = await tx(async (c) => {
    const row = await one(
      `UPDATE password_reset_tokens SET used_at = now()
        WHERE token_hash = $1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()
        RETURNING user_id`,
      [sha256(token)],
      c,
    );
    if (!row) return null;
    await query('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [row.user_id, hash], c);
    await query('UPDATE password_reset_tokens SET revoked_at = now() WHERE user_id = $1 AND used_at IS NULL AND revoked_at IS NULL', [row.user_id], c);
    await query('DELETE FROM sessions WHERE user_id = $1', [row.user_id], c); // sign out everywhere
    return one('SELECT id, email FROM users WHERE id = $1', [row.user_id], c);
  });
  if (!user) throw badRequest('This reset link is invalid or has expired');
  return user as { id: string; email: string };
}

export async function notifyPasswordChanged(user: { id: string; email: string }) {
  await sendMail(
    {
      to: user.email,
      subject: 'Your CAT 100 password was changed',
      text: [
        'The password for your CAT 100 account was just changed, and every device was signed out.',
        '',
        `If you did not do this, reset your password now: ${appUrl()}/forgot-password`,
      ].join('\n'),
    },
    { purpose: 'password_changed', userId: user.id },
  );
}
