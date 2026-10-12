import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { config, isTest } from './config.js';
import { pool } from './db/pool.js';
import { csrfProtection, loadUser, requireAdmin, requireAuth } from './lib/auth.js';
import { errorHandler } from './lib/errors.js';
import { logger } from './lib/logger.js';
import { adminRouter, UPLOAD_DIR } from './modules/admin/routes.js';
import { analyticsRouter } from './modules/analytics/routes.js';
import { authRouter } from './modules/auth/routes.js';
import { diagnosticRouter } from './modules/diagnostic/routes.js';
import { learnerRouter } from './modules/learner/routes.js';
import { lessonsRouter, revisionRouter } from './modules/lessons/routes.js';
import { mocksRouter } from './modules/mocks/routes.js';
import { plansRouter } from './modules/plans/routes.js';
import { questionsRouter } from './modules/questions/routes.js';
import { searchRouter } from './modules/search/routes.js';
import { strategyRouter } from './modules/strategy/routes.js';
import { groupsRouter, syllabusRouter } from './modules/syllabus/routes.js';
import { tutorRouter } from './modules/tutor/routes.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: config.CORS_ORIGIN.split(',').map((s) => s.trim()), credentials: true }));
  app.use(express.json({ limit: '5mb' }));
  app.use(cookieParser());
  if (!isTest) app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/api/health' } }));
  app.use(
    '/api',
    rateLimit({
      windowMs: 60_000,
      limit: 600,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      skip: () => config.RATE_LIMIT_DISABLED || isTest,
      message: { error: { code: 'rate_limited', message: 'Too many requests. Slow down a little.' } },
    }),
  );
  app.use('/uploads', express.static(UPLOAD_DIR, { fallthrough: false, maxAge: '7d' }));

  app.get('/api/health', async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  });

  app.use(loadUser);
  app.use(csrfProtection);
  app.use('/api/auth', authRouter);
  app.use('/api', requireAuth);
  app.use('/api', syllabusRouter);
  app.use('/api', groupsRouter);
  app.use('/api', learnerRouter);
  app.use('/api/questions', questionsRouter);
  app.use('/api/lessons', lessonsRouter);
  app.use('/api/revision', revisionRouter);
  app.use('/api/plans', plansRouter);
  app.use('/api/diagnostic', diagnosticRouter);
  app.use('/api/mocks', mocksRouter);
  app.use('/api/analytics', analyticsRouter);
  app.use('/api/tutor', tutorRouter);
  app.use('/api/strategy', strategyRouter);
  app.use('/api/search', searchRouter);
  app.use('/api/admin', requireAdmin, adminRouter);
  app.use('/api', (_req, res) => res.status(404).json({ error: { code: 'not_found', message: 'No such endpoint' } }));
  app.use(errorHandler);
  return app;
}
