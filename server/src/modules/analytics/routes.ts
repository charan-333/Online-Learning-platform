import { Router } from 'express';
import { many } from '../../db/pool.js';
import { ERROR_GUIDE } from '../../domain/errors.js';
import { userId } from '../../lib/auth.js';
import { overview, topicAnalytics } from '../../services/analytics.js';

export const analyticsRouter = Router();

analyticsRouter.get('/overview', async (req, res) => {
  res.json(await overview(userId(req)));
});

analyticsRouter.get('/topics', async (req, res) => {
  res.json({ items: await topicAnalytics(userId(req)) });
});

analyticsRouter.get('/errors', async (req, res) => {
  const rows = await many(
    `SELECT e.category, q.section_id, count(*) AS n, count(*) FILTER (WHERE e.resolved_at IS NOT NULL) AS resolved
       FROM error_logs e JOIN questions q ON q.id = e.question_id WHERE e.user_id = $1 GROUP BY 1, 2 ORDER BY n DESC`,
    [userId(req)],
  );
  res.json({ items: rows.map((r) => ({ ...r, label: ERROR_GUIDE[r.category as keyof typeof ERROR_GUIDE]?.label ?? r.category })) });
});
