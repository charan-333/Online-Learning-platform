import { Router } from 'express';
import { z } from 'zod';
import { many, one, query } from '../../db/pool.js';
import { userId } from '../../lib/auth.js';
import { notFound } from '../../lib/errors.js';
import { dateStr, parseBody, parseQuery, uuidParam } from '../../lib/validate.js';
import { generatePlan, reallocate, todayStr } from '../../services/plans.js';

export const plansRouter = Router();

plansRouter.get('/current', async (req, res) => {
  const uid = userId(req);
  const f = parseQuery(z.object({ from: dateStr.optional(), to: dateStr.optional() }), req);
  const plan = await one("SELECT * FROM study_plans WHERE user_id = $1 AND status = 'active'", [uid]);
  if (!plan) return res.json({ plan: null, tasks: [] });
  // Opening the plan re-flows anything left unfinished on earlier days.
  const realloc = await reallocate(uid, plan.id, todayStr());
  const from = f.from ?? todayStr();
  const to = f.to ?? plan.end_date;
  const tasks = await many(
    `SELECT k.*, t.name AS topic_name, t.section_id FROM study_plan_tasks k LEFT JOIN topics t ON t.id = k.topic_id
      WHERE k.plan_id = $1 AND k.scheduled_date BETWEEN $2 AND $3 ORDER BY k.scheduled_date, k.position`,
    [plan.id, from, to],
  );
  const totals = await one(
    `SELECT count(*) FILTER (WHERE status = 'done') AS done, count(*) FILTER (WHERE status = 'pending') AS pending,
            count(*) FILTER (WHERE status = 'skipped') AS skipped, coalesce(sum(minutes) FILTER (WHERE status = 'pending'), 0) AS pending_minutes
       FROM study_plan_tasks WHERE plan_id = $1`,
    [plan.id],
  );
  res.json({ plan: { ...(await one('SELECT * FROM study_plans WHERE id = $1', [plan.id])) }, tasks, totals, reallocation: realloc });
});

plansRouter.post('/generate', async (req, res) => {
  const b = parseBody(z.object({ startDate: dateStr.optional() }), req);
  const plan = await generatePlan(userId(req), b.startDate ?? todayStr());
  res.status(201).json(plan);
});

plansRouter.patch('/:id', async (req, res) => {
  const uid = userId(req);
  const planId = uuidParam(req);
  const b = parseBody(
    z.union([
      z.object({ action: z.literal('reallocate') }),
      z.object({ taskId: z.string().uuid(), status: z.enum(['pending', 'done', 'skipped']).optional(), scheduledDate: dateStr.optional() }),
    ]),
    req,
  );
  const plan = await one('SELECT id FROM study_plans WHERE id = $1 AND user_id = $2', [planId, uid]);
  if (!plan) throw notFound('Plan');
  if ('action' in b) return res.json(await reallocate(uid, planId, todayStr()));
  const row = await one(
    `UPDATE study_plan_tasks SET status = coalesce($3, status), scheduled_date = coalesce($4::date, scheduled_date),
       completed_at = CASE WHEN $3 = 'done' THEN now() WHEN $3 IS NULL THEN completed_at ELSE NULL END
     WHERE id = $1 AND plan_id = $2 RETURNING *`,
    [b.taskId, planId, b.status ?? null, b.scheduledDate ?? null],
  );
  if (!row) throw notFound('Task');
  res.json(row);
});

plansRouter.get('/history', async (req, res) => {
  res.json({ items: await many('SELECT * FROM study_plans WHERE user_id = $1 ORDER BY created_at DESC', [userId(req)]) });
});

/** Minimum viable session for very short windows, and a higher-value extension when more time is available. */
plansRouter.get('/today', async (req, res) => {
  const uid = userId(req);
  const tasks = await many(
    `SELECT k.*, t.name AS topic_name FROM study_plan_tasks k JOIN study_plans p ON p.id = k.plan_id LEFT JOIN topics t ON t.id = k.topic_id
      WHERE p.user_id = $1 AND p.status = 'active' AND k.scheduled_date = $2 ORDER BY k.position`,
    [uid, todayStr()],
  );
  const extension = await one(
    `SELECT k.*, t.name AS topic_name FROM study_plan_tasks k JOIN study_plans p ON p.id = k.plan_id LEFT JOIN topics t ON t.id = k.topic_id
      WHERE p.user_id = $1 AND p.status = 'active' AND k.scheduled_date > $2 AND k.status = 'pending' AND k.task_type IN ('learn', 'practice')
      ORDER BY k.scheduled_date, k.position LIMIT 1`,
    [uid, todayStr()],
  );
  res.json({ tasks, minimumViable: { minutes: 20, description: '5 min revision, 12 min practice on the top recommendation, 3 min error logging.' }, extension });
});
