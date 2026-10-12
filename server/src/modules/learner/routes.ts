import { Router } from 'express';
import { z } from 'zod';
import { many, one, query } from '../../db/pool.js';
import { ERROR_CATEGORIES, ERROR_GUIDE } from '../../domain/errors.js';
import { clearSessionCookies, userId, verifyPassword } from '../../lib/auth.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { dateStr, pagination, parseBody, parseQuery, uuidParam } from '../../lib/validate.js';
import { listConfigs } from '../../services/examConfigs.js';
import { recommendTopics } from '../../services/recommend.js';

export const learnerRouter = Router();

// ------------------------------------------------------------------ profile
const profilePatch = z
  .object({
    displayName: z.string().trim().min(1).max(80),
    education: z.string().max(200),
    currentStatus: z.string().max(200),
    currentLevel: z.string().max(100),
    qaSelfRating: z.enum(['weak', 'needs_improvement', 'average', 'strong']),
    varcSelfRating: z.enum(['weak', 'needs_improvement', 'average', 'strong']),
    dilrSelfRating: z.enum(['weak', 'needs_improvement', 'average', 'strong']),
    workdayMinutes: z.number().int().min(10).max(600),
    weekendMinutes: z.number().int().min(0).max(720),
    offDays: z.array(z.number().int().min(0).max(6)).max(6),
    weekendDays: z.array(z.number().int().min(0).max(6)).max(7),
    goal: z.string().max(200),
    learningStyle: z.string().max(400),
    examYear: z.number().int().min(2015).max(2100),
    examDate: dateStr.nullable(),
    preparationMode: z.enum(['A', 'B']),
    lowTimeMode: z.boolean(),
    gamificationEnabled: z.boolean(),
    onboardingCompleted: z.boolean(),
  })
  .partial();

const COLS: Record<string, string> = {
  displayName: 'display_name', education: 'education', currentStatus: 'current_status', currentLevel: 'current_level', qaSelfRating: 'qa_self_rating',
  varcSelfRating: 'varc_self_rating', dilrSelfRating: 'dilr_self_rating', workdayMinutes: 'workday_minutes', weekendMinutes: 'weekend_minutes', offDays: 'off_days',
  weekendDays: 'weekend_days', goal: 'goal', learningStyle: 'learning_style', examYear: 'exam_year', examDate: 'exam_date', preparationMode: 'preparation_mode',
  lowTimeMode: 'low_time_mode', gamificationEnabled: 'gamification_enabled', onboardingCompleted: 'onboarding_completed',
};

learnerRouter.get('/profile', async (req, res) => {
  res.json(await one('SELECT * FROM user_profiles WHERE user_id = $1', [userId(req)]));
});

learnerRouter.patch('/profile', async (req, res) => {
  const body = parseBody(profilePatch, req);
  const entries = Object.entries(body).filter(([, v]) => v !== undefined);
  if (!entries.length) throw badRequest('Nothing to update');
  const sets = entries.map(([k], i) => `${COLS[k]} = $${i + 2}`).join(', ');
  const row = await one(`UPDATE user_profiles SET ${sets}, updated_at = now() WHERE user_id = $1 RETURNING *`, [userId(req), ...entries.map(([, v]) => v)]);
  res.json(row);
});

/** Every recorded pattern version, the active one first, with its verification status and sources. */
learnerRouter.get('/exam-configs', async (_req, res) => {
  const cfgs = await listConfigs();
  const items = cfgs
    .sort((a, b) => Number(b.is_active) - Number(a.is_active))
    .map(({ id, year, version, name, is_active, total_duration_min, sectional_lock, status, label, fields, sections, sources }) => ({
      id, year, version, name, is_active, total_duration_min, sectional_lock, status, label, fields, sections,
      sources: sources.map((s: any) => ({ kind: s.kind, title: s.title, publisher: s.publisher, url: s.url, accessed_on: s.accessed_on, supports: s.supports })),
    }));
  res.json({ items });
});

// ------------------------------------------------------------------ recommendations
learnerRouter.get('/recommendations', async (req, res) => {
  res.json({ items: await recommendTopics(userId(req), 5) });
});

// ------------------------------------------------------------------ bookmarks & notes
learnerRouter.get('/bookmarks', async (req, res) => {
  const rows = await many(
    `SELECT q.id, q.external_id, q.section_id, t.name AS topic_name, q.difficulty, q.origin, left(q.stem_md, 200) AS stem_preview, b.created_at
       FROM bookmarks b JOIN questions q ON q.id = b.question_id JOIN topics t ON t.id = q.topic_id
      WHERE b.user_id = $1 ORDER BY b.created_at DESC`,
    [userId(req)],
  );
  res.json({ items: rows });
});

const noteBody = z
  .object({
    body: z.string().trim().min(1).max(20000),
    kind: z.enum(['note', 'annotation', 'highlight', 'workspace']).default('note'),
    questionId: z.string().uuid().optional(),
    topicId: z.string().max(100).optional(),
    passageId: z.string().uuid().optional(),
    dilrSetId: z.string().uuid().optional(),
    anchor: z
      .union([
        z.object({ paragraph: z.number().int().min(0), start: z.number().int().min(0), end: z.number().int().min(0), text: z.string().max(2000) }),
        z.object({ grid: z.array(z.array(z.string().max(40)).max(20)).max(20) }),
      ])
      .optional(),
  })
  .refine((b) => [b.questionId, b.topicId, b.passageId, b.dilrSetId].filter(Boolean).length <= 1, 'A note can attach to at most one item');

learnerRouter.get('/notes', async (req, res) => {
  const { q } = parseQuery(z.object({ q: z.string().max(200).optional() }), req);
  const rows = await many(
    `SELECT n.*, t.name AS topic_name, qu.external_id AS question_external_id, p.title AS passage_title, s.title AS set_title
       FROM user_notes n
       LEFT JOIN topics t ON t.id = n.topic_id LEFT JOIN questions qu ON qu.id = n.question_id
       LEFT JOIN passages p ON p.id = n.passage_id LEFT JOIN dilr_sets s ON s.id = n.dilr_set_id
      WHERE n.user_id = $1 AND ($2::text IS NULL OR n.body ILIKE '%' || $2 || '%')
      ORDER BY n.updated_at DESC LIMIT 500`,
    [userId(req), q ?? null],
  );
  res.json({ items: rows });
});

learnerRouter.post('/notes', async (req, res) => {
  const b = parseBody(noteBody, req);
  const row = await one(
    `INSERT INTO user_notes(user_id, question_id, topic_id, passage_id, dilr_set_id, kind, body, anchor) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [userId(req), b.questionId ?? null, b.topicId ?? null, b.passageId ?? null, b.dilrSetId ?? null, b.kind, b.body, b.anchor ?? null],
  );
  res.status(201).json(row);
});

learnerRouter.patch('/notes/:id', async (req, res) => {
  const b = parseBody(z.object({ body: z.string().trim().min(1).max(20000), anchor: z.any().optional() }), req);
  const row = await one('UPDATE user_notes SET body = $3, anchor = coalesce($4, anchor), updated_at = now() WHERE id = $1 AND user_id = $2 RETURNING *', [uuidParam(req), userId(req), b.body, b.anchor ?? null]);
  if (!row) throw notFound('Note');
  res.json(row);
});

learnerRouter.delete('/notes/:id', async (req, res) => {
  const r = await query('DELETE FROM user_notes WHERE id = $1 AND user_id = $2', [uuidParam(req), userId(req)]);
  if (!r.rowCount) throw notFound('Note');
  res.status(204).end();
});

// ------------------------------------------------------------------ error log
learnerRouter.get('/errors', async (req, res) => {
  const f = parseQuery(
    pagination.extend({
      category: z.enum([...ERROR_CATEGORIES, 'unclassified']).optional(),
      section: z.enum(['VARC', 'DILR', 'QA']).optional(),
      topic: z.string().max(100).optional(),
      status: z.enum(['open', 'resolved', 'all']).default('open'),
      q: z.string().max(200).optional(),
    }),
    req,
  );
  const rows = await many(
    `SELECT e.*, q.external_id, q.section_id, q.topic_id, t.name AS topic_name, q.question_type, q.difficulty, left(q.stem_md, 200) AS stem_preview,
            rt.name AS remediation_topic_name, count(*) OVER () AS total,
            (SELECT json_agg(json_build_object('at', a.created_at, 'correct', a.is_correct) ORDER BY a.created_at)
               FROM question_attempts a WHERE a.user_id = e.user_id AND a.question_id = e.question_id AND a.created_at >= e.created_at) AS subsequent
       FROM error_logs e JOIN questions q ON q.id = e.question_id JOIN topics t ON t.id = q.topic_id LEFT JOIN topics rt ON rt.id = e.remediation_topic_id
      WHERE e.user_id = $1
        AND ($2::text IS NULL OR e.category = $2) AND ($3::text IS NULL OR q.section_id = $3) AND ($4::text IS NULL OR q.topic_id = $4)
        AND ($5 = 'all' OR ($5 = 'open' AND e.resolved_at IS NULL) OR ($5 = 'resolved' AND e.resolved_at IS NOT NULL))
        AND ($6::text IS NULL OR q.stem_md ILIKE '%' || $6 || '%' OR e.root_cause ILIKE '%' || $6 || '%')
      ORDER BY e.created_at DESC LIMIT $7 OFFSET $8`,
    [userId(req), f.category ?? null, f.section ?? null, f.topic ?? null, f.status, f.q ?? null, f.pageSize, (f.page - 1) * f.pageSize],
  );
  res.json({
    items: rows.map(({ total: _t, ...r }) => ({ ...r, guide: ERROR_GUIDE[r.category as keyof typeof ERROR_GUIDE] })),
    total: rows[0]?.total ?? 0,
    page: f.page,
    pageSize: f.pageSize,
    categories: Object.fromEntries(Object.entries(ERROR_GUIDE).map(([k, v]) => [k, v.label])),
  });
});

learnerRouter.patch('/errors/:id', async (req, res) => {
  const b = parseBody(z.object({ category: z.enum(ERROR_CATEGORIES).optional(), rootCause: z.string().max(4000).optional(), correctApproach: z.string().max(8000).optional() }), req);
  const row = await one(
    `UPDATE error_logs SET category = coalesce($3, category), root_cause = coalesce($4, root_cause), correct_approach = coalesce($5, correct_approach), updated_at = now()
      WHERE id = $1 AND user_id = $2 RETURNING *`,
    [uuidParam(req), userId(req), b.category ?? null, b.rootCause ?? null, b.correctApproach ?? null],
  );
  if (!row) throw notFound('Error entry');
  res.json({ ...row, guide: ERROR_GUIDE[row.category as keyof typeof ERROR_GUIDE] });
});

/** Recurring patterns: counts per category per week, and whether each is improving. */
learnerRouter.get('/errors/trends', async (req, res) => {
  const uid = userId(req);
  const weekly = await many(
    `SELECT date_trunc('week', created_at)::date AS week, category, count(*) AS n FROM error_logs WHERE user_id = $1 AND created_at > now() - interval '12 weeks'
      GROUP BY 1, 2 ORDER BY 1`,
    [uid],
  );
  const byCategory = await many(
    `SELECT category, count(*) AS total, count(*) FILTER (WHERE resolved_at IS NOT NULL) AS resolved,
            count(*) FILTER (WHERE created_at > now() - interval '14 days') AS last_14d,
            count(*) FILTER (WHERE created_at <= now() - interval '14 days' AND created_at > now() - interval '28 days') AS prev_14d
       FROM error_logs WHERE user_id = $1 GROUP BY 1 ORDER BY total DESC`,
    [uid],
  );
  res.json({
    weekly,
    byCategory: byCategory.map((c) => ({
      ...c,
      label: ERROR_GUIDE[c.category as keyof typeof ERROR_GUIDE]?.label ?? c.category,
      trend: c.last_14d < c.prev_14d ? 'improving' : c.last_14d > c.prev_14d ? 'worsening' : 'flat',
      recurring: c.total - c.resolved >= 3,
    })),
  });
});

// ------------------------------------------------------------------ study sessions
learnerRouter.get('/study-sessions', async (req, res) => {
  const uid = userId(req);
  const sessions = await many('SELECT * FROM study_sessions WHERE user_id = $1 ORDER BY started_at DESC LIMIT 100', [uid]);
  // Consistency (not a streak penalty): days with any study activity in the last 28 days.
  const days = await many(
    `SELECT d::date AS day,
            (SELECT count(*) FROM question_attempts a WHERE a.user_id = $1 AND a.created_at::date = d::date) AS attempts,
            (SELECT coalesce(sum(active_seconds), 0) FROM study_sessions s WHERE s.user_id = $1 AND s.started_at::date = d::date) AS seconds
       FROM generate_series(current_date - 27, current_date, interval '1 day') d ORDER BY d`,
    [uid],
  );
  let streak = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    const active = days[i].attempts > 0 || days[i].seconds > 0;
    if (active) streak++;
    else if (i === days.length - 1) continue; // today not yet studied does not break the streak
    else break;
  }
  res.json({ items: sessions, days, currentStreak: streak, activeDays28: days.filter((d) => d.attempts > 0 || d.seconds > 0).length });
});

learnerRouter.post('/study-sessions', async (req, res) => {
  const b = parseBody(z.object({ kind: z.string().max(40), refId: z.string().max(100).optional() }), req);
  const row = await one('INSERT INTO study_sessions(user_id, kind, ref_id) VALUES ($1,$2,$3) RETURNING *', [userId(req), b.kind, b.refId ?? null]);
  res.status(201).json(row);
});

learnerRouter.patch('/study-sessions/:id', async (req, res) => {
  const b = parseBody(z.object({ activeSeconds: z.number().int().min(0).max(24 * 3600), ended: z.boolean().optional() }), req);
  const row = await one(
    'UPDATE study_sessions SET active_seconds = GREATEST(active_seconds, $3), ended_at = CASE WHEN $4 THEN now() ELSE ended_at END WHERE id = $1 AND user_id = $2 RETURNING *',
    [uuidParam(req), userId(req), b.activeSeconds, !!b.ended],
  );
  if (!row) throw notFound('Study session');
  res.json(row);
});

// ------------------------------------------------------------------ account
const EXPORT_TABLES: [string, string][] = [
  ['profile', 'SELECT * FROM user_profiles WHERE user_id = $1'],
  ['attempts', 'SELECT a.*, q.external_id FROM question_attempts a JOIN questions q ON q.id = a.question_id WHERE a.user_id = $1 ORDER BY a.created_at'],
  ['mastery', 'SELECT * FROM user_topic_mastery WHERE user_id = $1'],
  ['bookmarks', 'SELECT b.*, q.external_id FROM bookmarks b JOIN questions q ON q.id = b.question_id WHERE b.user_id = $1'],
  ['notes', 'SELECT * FROM user_notes WHERE user_id = $1'],
  ['errorLog', 'SELECT * FROM error_logs WHERE user_id = $1'],
  ['revisionItems', 'SELECT * FROM revision_items WHERE user_id = $1'],
  ['revisionReviews', 'SELECT * FROM revision_reviews WHERE user_id = $1'],
  ['lessons', 'SELECT * FROM lessons WHERE user_id = $1'],
  ['studyPlans', 'SELECT * FROM study_plans WHERE user_id = $1'],
  ['studyPlanTasks', 'SELECT * FROM study_plan_tasks WHERE user_id = $1'],
  ['studySessions', 'SELECT * FROM study_sessions WHERE user_id = $1'],
  ['mockAttempts', 'SELECT * FROM mock_attempts WHERE user_id = $1'],
  ['mockResponses', 'SELECT r.* FROM mock_responses r JOIN mock_attempts a ON a.id = r.attempt_id WHERE a.user_id = $1'],
  ['tutorSessions', 'SELECT * FROM ai_tutor_sessions WHERE user_id = $1'],
  ['tutorMessages', 'SELECT m.* FROM ai_tutor_messages m JOIN ai_tutor_sessions s ON s.id = m.session_id WHERE s.user_id = $1'],
  ['strategyDrills', 'SELECT * FROM strategy_drills WHERE user_id = $1'],
];

learnerRouter.get('/account/export', async (req, res) => {
  const uid = userId(req);
  const out: Record<string, unknown> = { exportedAt: new Date().toISOString(), account: { id: uid, email: req.user!.email } };
  for (const [k, sql] of EXPORT_TABLES) out[k] = (await many(sql, [uid])).map((r) => r);
  res.setHeader('Content-Disposition', 'attachment; filename="cat100-export.json"');
  res.json(out);
});

learnerRouter.delete('/account', async (req, res) => {
  const b = parseBody(z.object({ password: z.string().min(1).max(200), confirm: z.literal('DELETE') }), req);
  const u = await one('SELECT password_hash FROM users WHERE id = $1', [userId(req)]);
  if (!u || !(await verifyPassword(b.password, u.password_hash))) throw badRequest('Password is incorrect');
  await query('DELETE FROM users WHERE id = $1', [userId(req)]); // cascades to all learner data
  clearSessionCookies(res);
  res.status(204).end();
});
