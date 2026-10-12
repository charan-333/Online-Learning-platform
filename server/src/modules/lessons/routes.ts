import { Router } from 'express';
import { z } from 'zod';
import { many, one } from '../../db/pool.js';
import { userId } from '../../lib/auth.js';
import { notFound } from '../../lib/errors.js';
import { dateStr, parseBody, parseQuery, uuidParam } from '../../lib/validate.js';
import { completeBlock, getOrCreateDailyLesson, lessonDetail } from '../../services/lessons.js';
import { dueQueue, enqueueRevision, reviewItem } from '../../services/revision.js';

export const lessonsRouter = Router();

const today = () => new Date().toISOString().slice(0, 10);

lessonsRouter.get('/daily', async (req, res) => {
  const uid = userId(req);
  const f = parseQuery(z.object({ minutes: z.coerce.number().int().min(15).max(240).optional(), date: dateStr.optional(), topic: z.string().max(100).optional() }), req);
  const p = await one('SELECT workday_minutes, weekend_minutes, weekend_days, low_time_mode FROM user_profiles WHERE user_id = $1', [uid]);
  const date = f.date ?? today();
  const dow = new Date(date + 'T00:00:00Z').getUTCDay();
  const defaultMinutes = p?.low_time_mode ? 20 : p?.weekend_days?.includes(dow) ? Math.max(20, Math.min(240, p.weekend_minutes || 60)) : p?.workday_minutes ?? 60;
  const minutes = f.minutes ?? defaultMinutes;
  const lesson = await getOrCreateDailyLesson(uid, minutes, date, f.topic);
  res.json(await lessonDetail(uid, lesson!.id));
});

lessonsRouter.get('/', async (req, res) => {
  const rows = await many(
    `SELECT l.id, l.lesson_date, l.minutes, l.status, l.topic_id, t.name AS topic_name, l.report, l.created_at, l.completed_at
       FROM lessons l JOIN topics t ON t.id = l.topic_id WHERE l.user_id = $1 ORDER BY l.lesson_date DESC, l.created_at DESC LIMIT 60`,
    [userId(req)],
  );
  res.json({ items: rows });
});

lessonsRouter.get('/:id', async (req, res) => {
  const d = await lessonDetail(userId(req), uuidParam(req));
  if (!d) throw notFound('Lesson');
  res.json(d);
});

lessonsRouter.post('/:id/progress', async (req, res) => {
  const b = parseBody(z.object({ blockKey: z.string().max(40) }), req);
  res.json(await completeBlock(userId(req), uuidParam(req), b.blockKey));
});

export const revisionRouter = Router();

revisionRouter.get('/due', async (req, res) => {
  res.json(await dueQueue(userId(req), 100));
});

revisionRouter.get('/upcoming', async (req, res) => {
  const rows = await many(
    `SELECT date_trunc('day', due_at)::date AS day, count(*) AS n FROM revision_items WHERE user_id = $1 AND NOT retired AND due_at > now()
      GROUP BY 1 ORDER BY 1 LIMIT 30`,
    [userId(req)],
  );
  res.json({ items: rows });
});

revisionRouter.post('/:id/review', async (req, res) => {
  const b = parseBody(z.object({ grade: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]) }), req);
  const r = await reviewItem(userId(req), uuidParam(req), b.grade);
  if (!r) throw notFound('Revision item');
  res.json(r);
});

/** Adds a formula card or topic to the learner's revision queue. */
revisionRouter.post('/items', async (req, res) => {
  const b = parseBody(z.object({ itemType: z.enum(['formula', 'topic', 'question']), refId: z.string().max(100) }), req);
  let topicId: string | null = null;
  if (b.itemType === 'formula') topicId = (await one('SELECT topic_id FROM formula_cards WHERE id = $1', [z.string().uuid().parse(b.refId)]))?.topic_id;
  else if (b.itemType === 'topic') topicId = (await one('SELECT id FROM topics WHERE id = $1', [b.refId]))?.id;
  else topicId = (await one("SELECT topic_id FROM questions WHERE id = $1 AND status = 'published'", [z.string().uuid().parse(b.refId)]))?.topic_id;
  if (!topicId) throw notFound('Item');
  await enqueueRevision(userId(req), b.itemType, b.refId, topicId, b.itemType === 'formula' ? 'high_value_formula' : 'first_exposure');
  res.status(201).json({ queued: true });
});
