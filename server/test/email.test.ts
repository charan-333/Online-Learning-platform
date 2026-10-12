import { execFile } from 'node:child_process';
import net from 'node:net';
import { promisify } from 'node:util';
import request from 'supertest';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import { query } from '../src/db/pool.js';
import { sha256 } from '../src/lib/auth.js';
import { flushBackground } from '../src/lib/background.js';
import { redactUrl } from '../src/lib/logger.js';
import { EmailNotConfiguredError, getEmailProvider, LogProvider, MemoryProvider, outbox, safeError, setEmailProvider, SmtpProvider } from '../src/lib/mailer.js';
import { app, signUp } from './helpers.js';

const GENERIC = { message: 'If an account exists for that email, a reset link has been sent.' };
const original = getEmailProvider();
const users: string[] = [];

/** A minimal SMTP server for tests. It records what it receives and can refuse recipients or answer slowly. */
function fakeSmtp() {
  const state = { messages: [] as { from: string; to: string[]; data: string }[], auth: [] as string[], refuseRecipients: false, greetingDelayMs: 0 };
  const server = net.createServer((socket) => {
    let buffer = '';
    let inData = false;
    let data: string[] = [];
    let from = '';
    let to: string[] = [];
    let awaitingAuth = false;
    const say = (s: string) => socket.write(`${s}\r\n`);
    setTimeout(() => say('220 fixture.test ESMTP test server'), state.greetingDelayMs);
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let i: number;
      while ((i = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        if (inData) {
          if (line === '.') {
            inData = false;
            state.messages.push({ from, to, data: data.join('\r\n') });
            say('250 2.0.0 queued as fixture');
          } else data.push(line.startsWith('..') ? line.slice(1) : line);
          continue;
        }
        if (awaitingAuth) {
          awaitingAuth = false;
          state.auth.push(Buffer.from(line, 'base64').toString('utf8'));
          say('235 2.7.0 Authentication successful');
          continue;
        }
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === 'EHLO') socket.write('250-fixture.test\r\n250-AUTH PLAIN\r\n250 8BITMIME\r\n');
        else if (cmd === 'HELO') say('250 fixture.test');
        else if (cmd === 'AUTH') {
          const payload = line.split(' ')[2];
          if (payload) {
            state.auth.push(Buffer.from(payload, 'base64').toString('utf8'));
            say('235 2.7.0 Authentication successful');
          } else {
            awaitingAuth = true;
            say('334 ');
          }
        } else if (cmd === 'MAIL') {
          from = line;
          to = [];
          say('250 OK');
        } else if (cmd === 'RCPT') {
          if (state.refuseRecipients) say('550 5.1.1 Mailbox unavailable');
          else (to.push(line), say('250 OK'));
        } else if (cmd === 'DATA') {
          inData = true;
          data = [];
          say('354 End data with <CR><LF>.<CR><LF>');
        } else if (cmd === 'QUIT') (say('221 Bye'), socket.end());
        else say('250 OK');
      }
    });
    socket.on('error', () => {});
  });
  return {
    state,
    listen: () => new Promise<number>((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as net.AddressInfo).port))),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** The plain-text body of a received message, with quoted-printable or base64 decoded. */
function bodyOf(raw: string) {
  const [head, ...rest] = raw.split('\r\n\r\n');
  const body = rest.join('\r\n\r\n');
  if (/content-transfer-encoding:\s*base64/i.test(head)) return Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8');
  if (/content-transfer-encoding:\s*quoted-printable/i.test(head)) {
    return body.replace(/=\r\n/g, '').replace(/=([0-9A-F]{2})/g, (_m, h) => String.fromCharCode(parseInt(h, 16)));
  }
  return body;
}
const tokenIn = (text: string) => text.match(/reset-password\?token=([A-Za-z0-9_%-]+)/)?.[1];

const smtp = fakeSmtp();
let smtpPort = 0;
const smtpProvider = () =>
  new SmtpProvider({ host: '127.0.0.1', port: smtpPort, secure: false, requireTLS: false, user: 'fixture-user', password: 'fixture-password', from: 'CAT 100 <no-reply@fixture.test>' });

afterEach(async () => {
  await flushBackground();
  setEmailProvider(original);
  config.RATE_LIMIT_DISABLED = true;
});
afterAll(async () => {
  await smtp.close();
  await query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
});

const forgot = (email: string) => request(app).post('/api/auth/forgot-password').send({ email });
const reset = (token: string, password: string) => request(app).post('/api/auth/reset-password').send({ token, password });
async function newUser() {
  const c = await signUp();
  users.push(c.id);
  return c;
}

describe('password reset over SMTP', () => {
  it('emails a single-use link through the SMTP provider and stores only the token hash', async () => {
    smtpPort = await smtp.listen();
    setEmailProvider(smtpProvider());
    const c = await newUser();
    const r = await forgot(c.email);
    expect(r.status).toBe(200);
    expect(r.body).toEqual(GENERIC);
    await flushBackground();

    expect(smtp.state.auth).toEqual(['\u0000fixture-user\u0000fixture-password']);
    const msg = smtp.state.messages.find((m) => m.to.some((t) => t.includes(c.email)))!;
    expect(msg.from).toContain('no-reply@fixture.test');
    const text = bodyOf(msg.data);
    expect(text).toContain(`${config.APP_URL}/reset-password?token=`);
    expect(text).toContain('within 60 minutes');
    const token = decodeURIComponent(tokenIn(text)!);
    expect(token.length).toBeGreaterThanOrEqual(43); // 32 random bytes

    const stored = (await query('SELECT * FROM password_reset_tokens WHERE user_id = $1', [c.id])).rows;
    expect(stored).toHaveLength(1);
    expect(stored[0].token_hash).toBe(sha256(token));
    expect(JSON.stringify(stored)).not.toContain(token);
    const expiresIn = (new Date(stored[0].expires_at).getTime() - new Date(stored[0].created_at).getTime()) / 60000;
    expect(Math.round(expiresIn)).toBe(60);
    const deliveries = (await query('SELECT purpose, provider, status, error FROM email_deliveries WHERE user_id = $1', [c.id])).rows;
    expect(deliveries).toEqual([{ purpose: 'password_reset', provider: 'smtp', status: 'sent', error: null }]);
    expect(JSON.stringify((await query('SELECT * FROM email_deliveries WHERE user_id = $1', [c.id])).rows)).not.toContain(token);

    expect((await reset(token, 'a brand new password')).status).toBe(200);
    await flushBackground();
    const notice = smtp.state.messages.filter((m) => m.to.some((t) => t.includes(c.email)));
    expect(notice).toHaveLength(2);
    expect(bodyOf(notice[1].data)).toContain('was just changed');
    expect(bodyOf(notice[1].data)).not.toContain('token=');
    expect((await c.get('/api/auth/me')).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ email: c.email, password: 'a brand new password' })).status).toBe(200);

    const reuse = await reset(token, 'another new password');
    expect(reuse.status).toBe(400);
    expect(reuse.body.error.message).toBe('This reset link is invalid or has expired');
  });

  it('answers the same way when delivery fails or the account does not exist, and records the failure for admins', async () => {
    setEmailProvider(smtpProvider());
    smtp.state.refuseRecipients = true;
    try {
      const c = await newUser();
      const known = await forgot(c.email);
      const unknown = await forgot(`nobody-${Date.now()}@test.local`);
      expect(known.status).toBe(200);
      expect(unknown.status).toBe(200);
      expect(known.body).toEqual(unknown.body);
      await flushBackground();
      const d = (await query('SELECT status, error FROM email_deliveries WHERE user_id = $1', [c.id])).rows;
      expect(d).toHaveLength(1);
      expect(d[0].status).toBe('failed');
      expect(d[0].error).toMatch(/550/);
      expect(d[0].error).not.toMatch(/token=|https?:/);
      const tokens = (await query('SELECT revoked_at FROM password_reset_tokens WHERE user_id = $1', [c.id])).rows;
      expect(tokens).toHaveLength(1);
      expect(tokens[0].revoked_at).not.toBeNull(); // an undelivered link never works
    } finally {
      smtp.state.refuseRecipients = false;
    }
  });

  it('does not make the requester wait for a slow mail server', async () => {
    setEmailProvider(smtpProvider());
    smtp.state.greetingDelayMs = 1500;
    try {
      const c = await newUser();
      const t0 = Date.now();
      const r = await forgot(c.email);
      const elapsed = Date.now() - t0;
      expect(r.body).toEqual(GENERIC);
      expect(elapsed).toBeLessThan(1000);
      await flushBackground();
      expect(Date.now() - t0).toBeGreaterThanOrEqual(1500);
      expect((await query("SELECT status FROM email_deliveries WHERE user_id = $1", [c.id])).rows).toEqual([{ status: 'sent' }]);
    } finally {
      smtp.state.greetingDelayMs = 0;
    }
  });
});

describe('reset tokens', () => {
  const lastTokenFor = (email: string) => decodeURIComponent(tokenIn([...outbox].reverse().find((m) => m.to === email)!.text)!);

  it('rejects expired, superseded, malformed and unknown tokens', async () => {
    setEmailProvider(new MemoryProvider());
    const c = await newUser();
    await forgot(c.email);
    await flushBackground();
    const expired = lastTokenFor(c.email);
    await query("UPDATE password_reset_tokens SET expires_at = now() - interval '1 second' WHERE token_hash = $1", [sha256(expired)]);
    expect((await reset(expired, 'a brand new password')).status).toBe(400);

    await forgot(c.email);
    await flushBackground();
    const first = lastTokenFor(c.email);
    await forgot(c.email);
    await flushBackground();
    const second = lastTokenFor(c.email);
    expect(first).not.toBe(second);
    expect((await reset(first, 'a brand new password')).status).toBe(400); // revoked by the newer request
    expect((await reset('x'.repeat(43), 'a brand new password')).status).toBe(400);
    expect((await reset('short', 'a brand new password')).status).toBe(400);
    expect((await reset(second, 'a brand new password')).status).toBe(200);
  });

  it('limits reset emails per account and per address without revealing it to the requester', async () => {
    setEmailProvider(new MemoryProvider());
    const c = await newUser();
    for (let i = 0; i < config.PASSWORD_RESET_MAX_PER_HOUR + 2; i++) {
      const r = await forgot(c.email);
      expect(r.body).toEqual(GENERIC);
      await flushBackground();
    }
    const d = (await query('SELECT status, count(*)::int AS n FROM email_deliveries WHERE user_id = $1 GROUP BY 1 ORDER BY 1', [c.id])).rows;
    expect(d).toEqual([{ status: 'sent', n: config.PASSWORD_RESET_MAX_PER_HOUR }, { status: 'suppressed', n: 2 }]);

    config.RATE_LIMIT_DISABLED = false;
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await forgot(`nobody${i}@test.local`)).status);
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
  });

  it('keeps the request successful for the learner when the provider is down', async () => {
    const failing = new MemoryProvider();
    failing.failWith = 'Provider outage (fixture) while sending https://example.org/reset-password?token=abc';
    setEmailProvider(failing);
    const c = await newUser();
    expect((await forgot(c.email)).body).toEqual(GENERIC);
    await flushBackground();
    const d = (await query('SELECT status, error FROM email_deliveries WHERE user_id = $1', [c.id])).rows[0];
    expect(d.status).toBe('failed');
    expect(d.error).toBe('Provider outage (fixture) while sending [link]');
  });
});

describe('email provider safety', () => {
  it('refuses to use the log provider in production and never logs a reset link there', async () => {
    const lines: unknown[] = [];
    const prod = new LogProvider(true, { info: (...a: unknown[]) => void lines.push(a) } as any);
    expect(prod.configured).toBe(false);
    await expect(prod.send({ to: 'a@test.local', subject: 's', text: 'https://x/reset-password?token=secret' })).rejects.toBeInstanceOf(EmailNotConfiguredError);
    expect(lines).toEqual([]);
    const dev = new LogProvider(false, { info: (...a: unknown[]) => void lines.push(a) } as any);
    await dev.send({ to: 'a@test.local', subject: 's', text: 'dev body' });
    expect(lines).toHaveLength(1);
  });

  it('redacts tokens from logged URLs and provider errors', () => {
    expect(redactUrl('/reset-password?token=abc.DEF_123&next=%2F')).toBe('/reset-password?token=[redacted]&next=%2F');
    expect(redactUrl('/api/x?a=1&reset_token=zzz')).toBe('/api/x?a=1&reset_token=[redacted]');
    expect(redactUrl('/api/questions?page=2')).toBe('/api/questions?page=2');
    expect(safeError(new Error('bad token=abc at https://host/path'))).toBe('bad token=[redacted] at [link]');
  });

  it('refuses unsafe email settings at startup', async () => {
    const run = promisify(execFile);
    const tryConfig = (env: Record<string, string>) =>
      run(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', "await import('./src/config.ts')"], { cwd: process.cwd(), env: { PATH: process.env.PATH!, ...env } });
    await expect(tryConfig({ NODE_ENV: 'production', EMAIL_PROVIDER: 'memory' })).rejects.toThrow(/EMAIL_PROVIDER=memory is for tests only/);
    await expect(tryConfig({ NODE_ENV: 'production', EMAIL_PROVIDER: 'smtp' })).rejects.toThrow(/needs SMTP_HOST/);
    await expect(tryConfig({ NODE_ENV: 'production', EMAIL_PROVIDER: 'smtp', SMTP_HOST: 'smtp.example.org' })).resolves.toBeDefined();
  });

  it('shows admins whether email reaches real inboxes, and sends a test message', async () => {
    const admin = await signUp({ admin: true });
    users.push(admin.id);
    setEmailProvider(new LogProvider(false));
    const off = await admin.get('/api/admin/email');
    expect(off.body).toMatchObject({ provider: 'log', configured: false, summary: 'No email provider is configured. Password-reset emails are not delivered to learners.' });

    setEmailProvider(new MemoryProvider());
    const sent = await admin.post('/api/admin/email/test');
    expect(sent.body).toMatchObject({ provider: 'memory', configured: true, status: 'sent' });
    expect(outbox.at(-1)).toMatchObject({ to: admin.email, subject: 'CAT 100 test email' });
    const failing = new MemoryProvider();
    failing.failWith = 'Fixture: authentication failed';
    setEmailProvider(failing);
    const failed = await admin.post('/api/admin/email/test');
    expect(failed.body).toMatchObject({ status: 'failed', error: 'Fixture: authentication failed' });
    const status = await admin.get('/api/admin/email');
    expect(status.body.lastFailure).toMatchObject({ purpose: 'test', error: 'Fixture: authentication failed' });
    expect(Number(status.body.last24h.sent)).toBeGreaterThanOrEqual(1);
    const learner = await newUser();
    expect((await learner.get('/api/admin/email')).status).toBe(403);
  });
});
