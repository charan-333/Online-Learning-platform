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
  RATE_LIMIT_DISABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export const config = schema.parse(process.env);
export const isTest = config.NODE_ENV === 'test';
export const databaseUrl = isTest ? config.TEST_DATABASE_URL : config.DATABASE_URL;
