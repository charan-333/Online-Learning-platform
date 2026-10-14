import nodemailer, { type Transporter } from 'nodemailer';
import type { Logger } from 'pino';
import { config } from '../config.js';
import { many, one, query } from '../db/pool.js';
import { logger } from './logger.js';

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export interface DeliveryContext {
  purpose: 'password_reset' | 'password_changed' | 'test';
  userId?: string | null;
}

export type DeliveryStatus = 'sent' | 'failed' | 'suppressed';

/**
 * Email delivery goes through one provider chosen by EMAIL_PROVIDER. Nothing else in the app
 * sends mail directly, and credentials never leave the server.
 */
export interface EmailProvider {
  readonly name: string;
  /** False when messages would not reach a real inbox. */
  readonly configured: boolean;
  send(mail: Mail): Promise<{ messageId?: string }>;
}

export class EmailNotConfiguredError extends Error {}

/**
 * Development only: writes the whole message, links included, to the server log. In production
 * it refuses to send, because messages carry one-time links that must not reach the logs.
 */
export class LogProvider implements EmailProvider {
  readonly name = 'log';
  constructor(
    private readonly production = config.NODE_ENV === 'production',
    private readonly log: Pick<Logger, 'info'> = logger,
  ) {}
  get configured() {
    return false;
  }
  async send(mail: Mail) {
    if (this.production) throw new EmailNotConfiguredError('No email provider is configured (EMAIL_PROVIDER=log). Set EMAIL_PROVIDER=smtp and the SMTP_* settings.');
    this.log.info({ to: mail.to, subject: mail.subject, text: mail.text }, 'mail (log provider, development only)');
    return {};
  }
}

/** Tests: keeps messages in memory. `failWith` simulates a provider outage. */
export const outbox: Mail[] = [];
export class MemoryProvider implements EmailProvider {
  readonly name = 'memory';
  readonly configured = true;
  failWith: string | null = null;
  async send(mail: Mail) {
    if (this.failWith) throw new Error(this.failWith);
    outbox.push(mail);
    if (outbox.length > 200) outbox.shift();
    return { messageId: `memory-${Date.now()}-${outbox.length}` };
  }
}

export interface SmtpOptions {
  host: string;
  port: number;
  secure: boolean;
  requireTLS: boolean;
  user?: string;
  password?: string;
  from: string;
}

/** Production: any SMTP service (Amazon SES, Postmark, SendGrid, Mailgun, Brevo, Google Workspace, ...). */
export class SmtpProvider implements EmailProvider {
  readonly name = 'smtp';
  readonly configured = true;
  private readonly transport: Transporter;
  constructor(private readonly opts: SmtpOptions) {
    this.transport = nodemailer.createTransport({
      host: opts.host,
      port: opts.port,
      secure: opts.secure,
      requireTLS: opts.requireTLS,
      auth: opts.user ? { user: opts.user, pass: opts.password ?? '' } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }
  async send(mail: Mail) {
    const info = await this.transport.sendMail({ from: this.opts.from, to: mail.to, subject: mail.subject, text: mail.text });
    return { messageId: info.messageId };
  }
}

export function providerFromConfig(): EmailProvider {
  switch (config.EMAIL_PROVIDER) {
    case 'smtp':
      return new SmtpProvider({
        host: config.SMTP_HOST!,
        port: config.SMTP_PORT,
        secure: config.SMTP_SECURE,
        requireTLS: config.SMTP_REQUIRE_TLS,
        user: config.SMTP_USER,
        password: config.SMTP_PASSWORD,
        from: config.EMAIL_FROM,
      });
    case 'memory':
      return new MemoryProvider();
    default:
      return new LogProvider();
  }
}

let provider: EmailProvider = providerFromConfig();
export const getEmailProvider = () => provider;
/** Swaps the provider. Used by tests; the app itself configures it only through environment variables. */
export function setEmailProvider(p: EmailProvider) {
  provider = p;
}

// Error text from providers is stored for admins. Strip anything that looks like a link.
export const safeError = (e: unknown) =>
  String((e as Error)?.message ?? e)
    .replace(/https?:\/\/\S+/g, '[link]')
    .replace(/token=\S+/gi, 'token=[redacted]')
    .slice(0, 300);

async function record(ctx: DeliveryContext, providerName: string, status: DeliveryStatus, error: string | null, messageId: string | null) {
  try {
    await query('INSERT INTO email_deliveries(user_id, purpose, provider, status, error, provider_message_id) VALUES ($1,$2,$3,$4,$5,$6)', [
      ctx.userId ?? null,
      ctx.purpose,
      providerName,
      status,
      error,
      messageId,
    ]);
  } catch (e) {
    logger.error({ purpose: ctx.purpose, error: safeError(e) }, 'could not record email delivery');
  }
}

/** Sends one message and records the outcome (never the body or link). Never throws. */
export async function sendMail(mail: Mail, ctx: DeliveryContext): Promise<{ status: DeliveryStatus; error?: string }> {
  const p = provider;
  try {
    const r = await p.send(mail);
    await record(ctx, p.name, 'sent', null, r.messageId ?? null);
    return { status: 'sent' };
  } catch (e) {
    const error = safeError(e);
    logger.error({ purpose: ctx.purpose, provider: p.name, error }, 'email delivery failed');
    await record(ctx, p.name, 'failed', error, null);
    return { status: 'failed', error };
  }
}

export async function recordSuppressed(ctx: DeliveryContext, reason: string) {
  await record(ctx, provider.name, 'suppressed', reason, null);
}

/** What admins see: which provider is active, whether it reaches real inboxes, and recent outcomes. */
export async function emailStatus() {
  const counts = await many(
    "SELECT status, count(*) AS n FROM email_deliveries WHERE created_at > now() - interval '24 hours' GROUP BY status",
  );
  const lastFailure = await one("SELECT purpose, error, created_at FROM email_deliveries WHERE status = 'failed' ORDER BY created_at DESC LIMIT 1");
  const lastSent = await one("SELECT purpose, created_at FROM email_deliveries WHERE status = 'sent' ORDER BY created_at DESC LIMIT 1");
  const p = provider;
  const fromDomain = config.EMAIL_FROM.match(/@([^>\s]+)/)?.[1] ?? null;
  return {
    provider: p.name,
    configured: p.configured,
    summary: p.configured
      ? `Emails are sent through ${p.name === 'smtp' ? `SMTP (${config.SMTP_HOST})` : p.name}.`
      : 'No email provider is configured. Password-reset emails are not delivered to learners.',
    fromDomain,
    last24h: Object.fromEntries(counts.map((c) => [c.status, c.n])),
    lastSent: lastSent ?? null,
    lastFailure: lastFailure ?? null,
  };
}
