import { Router } from 'express';
import { z } from 'zod';
import { many, one, query } from '../../db/pool.js';
import { expectedValue, successProbability } from '../../domain/mockAnalysis.js';
import { evaluateChoice } from '../../domain/strategy.js';
import { userId } from '../../lib/auth.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { parseBody, uuidParam } from '../../lib/validate.js';

export const strategyRouter = Router();

async function drillItems(uid: string, qids: string[]) {
  const qs = await many(
    `SELECT q.id, q.external_id, q.topic_id, t.name AS topic_name, q.question_type, q.difficulty, q.estimated_time_sec, q.marks_correct, q.marks_wrong
       FROM questions q JOIN topics t ON t.id = q.topic_id WHERE q.id = ANY($1::uuid[])`,
    [qids],
  );
  const hist = await many(
    `SELECT q.topic_id, count(*) AS n, count(*) FILTER (WHERE a.is_correct) AS k, avg(a.time_taken_sec::float / q.estimated_time_sec) AS pace
       FROM question_attempts a JOIN questions q ON q.id = a.question_id WHERE a.user_id = $1 GROUP BY 1`,
    [uid],
  );
  return qs.map((q) => {
    const h = hist.find((x) => x.topic_id === q.topic_id);
    const p = successProbability(q.difficulty, h?.n ?? 0, h?.k ?? 0);
    const time = Math.round(q.estimated_time_sec * Math.min(2, Math.max(0.6, h?.pace ?? 1)));
    return { ...q, p: Math.round(p * 100) / 100, ev: Math.round(expectedValue(p, Number(q.marks_correct), q.question_type === 'MCQ' ? Number(q.marks_wrong) : 0) * 100) / 100, timeSec: time };
  });
}

/** Creates a drill: a mixed set of questions shown only by metadata, with a time budget below their total time. */
strategyRouter.post('/drills', async (req, res) => {
  const uid = userId(req);
  const b = parseBody(z.object({ section: z.enum(['VARC', 'DILR', 'QA']).default('QA'), count: z.number().int().min(4).max(20).default(10) }), req);
  const qs = await many(
    "SELECT id, estimated_time_sec FROM questions WHERE status = 'published' AND section_id = $1 AND passage_id IS NULL ORDER BY random() LIMIT $2",
    [b.section, b.count],
  );
  if (qs.length < 4) throw badRequest('Not enough questions in this section for a drill');
  const total = qs.reduce((s, q) => s + q.estimated_time_sec, 0);
  const budget = Math.round((total * 0.55) / 15) * 15;
  const d = await one('INSERT INTO strategy_drills(user_id, section_id, budget_sec, question_ids) VALUES ($1,$2,$3,$4) RETURNING *', [uid, b.section, budget, qs.map((q) => q.id)]);
  const items = await drillItems(uid, d!.question_ids);
  res.status(201).json({
    id: d!.id,
    budgetSec: budget,
    items: items.map((i) => ({ id: i.id, topicName: i.topic_name, type: i.question_type, difficulty: i.difficulty, estimatedSec: i.estimated_time_sec, marksCorrect: i.marks_correct, marksWrong: i.marks_wrong })),
    instructions: 'Choose the questions you would attempt, in order, within the time budget. You will be scored on expected marks using your own accuracy history.',
  });
});

strategyRouter.post('/drills/:id/submit', async (req, res) => {
  const uid = userId(req);
  const b = parseBody(z.object({ chosen: z.array(z.string().uuid()).max(20) }), req);
  const d = await one('SELECT * FROM strategy_drills WHERE id = $1 AND user_id = $2', [uuidParam(req), uid]);
  if (!d) throw notFound('Drill');
  if (d.submitted_at) throw conflict('Drill already submitted');
  if (b.chosen.some((c) => !d.question_ids.includes(c))) throw badRequest('Chosen question is not part of this drill');
  const items = await drillItems(uid, d.question_ids);
  const result = evaluateChoice(items.map((i) => ({ id: i.id, ev: i.ev, timeSec: i.timeSec })), b.chosen, d.budget_sec);
  const detail = items.map((i) => ({ id: i.id, topicName: i.topic_name, difficulty: i.difficulty, type: i.question_type, p: i.p, ev: i.ev, timeSec: i.timeSec, chosen: b.chosen.includes(i.id), inOptimal: result.optimal.ids.includes(i.id) }));
  const full = { ...result, items: detail };
  await query('UPDATE strategy_drills SET chosen_ids = $2, result = $3, submitted_at = now() WHERE id = $1', [d.id, b.chosen, full]);
  res.json(full);
});

strategyRouter.get('/drills', async (req, res) => {
  res.json({
    items: await many(
      "SELECT id, section_id, budget_sec, created_at, submitted_at, result->'efficiency' AS efficiency, result->'chosenEv' AS chosen_ev FROM strategy_drills WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30",
      [userId(req)],
    ),
  });
});
