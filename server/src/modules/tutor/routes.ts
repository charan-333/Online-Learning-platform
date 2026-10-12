import { Router } from 'express';
import { z } from 'zod';
import { config } from '../../config.js';
import { many, one, query } from '../../db/pool.js';
import { userId } from '../../lib/auth.js';
import { HttpError, notFound } from '../../lib/errors.js';
import { parseBody, uuidParam } from '../../lib/validate.js';
import { aiEnabled, tutorRespond } from '../../services/tutor.js';

export const tutorRouter = Router();

tutorRouter.get('/status', async (req, res) => {
  const used = await one(
    `SELECT count(*) AS n FROM ai_tutor_messages m JOIN ai_tutor_sessions s ON s.id = m.session_id
      WHERE s.user_id = $1 AND m.role = 'user' AND m.created_at > date_trunc('day', now())`,
    [userId(req)],
  );
  res.json({ aiEnabled: aiEnabled(), provider: aiEnabled() ? config.AI_MODEL : 'offline', dailyLimit: config.AI_DAILY_MESSAGE_LIMIT, usedToday: used!.n });
});

tutorRouter.get('/sessions', async (req, res) => {
  res.json({ items: await many('SELECT * FROM ai_tutor_sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50', [userId(req)]) });
});

tutorRouter.post('/sessions', async (req, res) => {
  const b = parseBody(
    z.object({ contextType: z.enum(['general', 'topic', 'question', 'mock', 'error']).default('general'), contextId: z.string().max(100).optional(), title: z.string().max(120).optional() }),
    req,
  );
  const row = await one('INSERT INTO ai_tutor_sessions(user_id, context_type, context_id, title) VALUES ($1,$2,$3,$4) RETURNING *', [
    userId(req),
    b.contextType,
    b.contextId ?? null,
    b.title ?? 'Tutor session',
  ]);
  res.status(201).json(row);
});

tutorRouter.get('/sessions/:id', async (req, res) => {
  const s = await one('SELECT * FROM ai_tutor_sessions WHERE id = $1 AND user_id = $2', [uuidParam(req), userId(req)]);
  if (!s) throw notFound('Tutor session');
  res.json({ ...s, messages: await many('SELECT * FROM ai_tutor_messages WHERE session_id = $1 ORDER BY created_at', [s.id]) });
});

tutorRouter.post('/sessions/:id/messages', async (req, res) => {
  const uid = userId(req);
  const b = parseBody(z.object({ content: z.string().trim().min(1).max(4000) }), req);
  const s = await one('SELECT * FROM ai_tutor_sessions WHERE id = $1 AND user_id = $2', [uuidParam(req), uid]);
  if (!s) throw notFound('Tutor session');
  if (aiEnabled()) {
    const used = await one(
      `SELECT count(*) AS n FROM ai_tutor_messages m JOIN ai_tutor_sessions s ON s.id = m.session_id
        WHERE s.user_id = $1 AND m.role = 'user' AND m.provider IS DISTINCT FROM 'offline' AND m.created_at > date_trunc('day', now())`,
      [uid],
    );
    if (used!.n >= config.AI_DAILY_MESSAGE_LIMIT) throw new HttpError(429, 'ai_limit', `Daily AI tutor limit (${config.AI_DAILY_MESSAGE_LIMIT} messages) reached. Platform content is still available.`);
  }
  await query('INSERT INTO ai_tutor_messages(session_id, role, content, provider) VALUES ($1,$2,$3,$4)', [s.id, 'user', b.content, aiEnabled() ? config.AI_MODEL : 'offline']);
  const history = (await many('SELECT role, content FROM ai_tutor_messages WHERE session_id = $1 ORDER BY created_at DESC LIMIT 20', [s.id])).reverse();
  const reply = await tutorRespond(uid, s, history);
  const msg = await one('INSERT INTO ai_tutor_messages(session_id, role, content, provider, grounding) VALUES ($1,$2,$3,$4,$5) RETURNING *', [
    s.id,
    'assistant',
    reply.content,
    reply.provider,
    JSON.stringify(reply.grounding),
  ]);
  res.status(201).json({ message: msg, degraded: reply.degraded ?? null });
});
