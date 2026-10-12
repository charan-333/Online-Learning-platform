import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().default('postgres://cat100:cat100@localhost:5432/cat100'),
  TEST_DATABASE_URL: z.string().default('postgres://cat100:cat100@localhost:5432/cat100_test'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(14),
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // Public URL used in password-reset links. Render provides RENDER_EXTERNAL_URL automatically.
  APP_URL: z.string().default(process.env.RENDER_EXTERNAL_URL ?? 'http://localhost:5173'),
  // AI tutor provider. 'none' keeps the tutor in grounded offline mode.
  AI_PROVIDER: z.enum(['none', 'anthropic']).default('none'),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default('claude-opus-5-5'),
  AI_DAILY_MESSAGE_LIMIT: z.coerce.number().int().positive().default(50),
  LOG_LEVEL: z.string().default('info'),
  // Email delivery. 'log' prints messages in development (never in production), 'memory' keeps
  // them for tests, 'smtp' sends through any SMTP provider (SES, Postmark, SendGrid, Mailgun, ...).
  EMAIL_PROVIDER: z.enum(['log', 'memory', 'smtp']).default(process.env.NODE_ENV === 'test' ? 'memory' : 'log'),
  EMAIL_FROM: z.string().default('CAT 100 <no-reply@localhost>'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  // true = TLS from the first byte (usually port 465); false = STARTTLS upgrade (usually 587).
  SMTP_SECURE: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  // Refuse to send unless the connection is encrypted. Only turn off for a local test server.
  SMTP_REQUIRE_TLS: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  PASSWORD_RESET_TTL_MIN: z.coerce.number().int().min(5).max(24 * 60).default(60),
  PASSWORD_RESET_MAX_PER_HOUR: z.coerce.number().int().min(1).max(20).default(3),
  RATE_LIMIT_DISABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export const config = schema.parse(process.env);

if (config.NODE_ENV === 'production' && config.EMAIL_PROVIDER === 'memory') {
  throw new Error('EMAIL_PROVIDER=memory is for tests only. Use smtp in production.');
}
if (config.EMAIL_PROVIDER === 'smtp' && !config.SMTP_HOST) {
  throw new Error('EMAIL_PROVIDER=smtp needs SMTP_HOST (and usually SMTP_USER and SMTP_PASSWORD).');
}
export const isTest = config.NODE_ENV === 'test';
export const databaseUrl = isTest ? config.TEST_DATABASE_URL : config.DATABASE_URL;
