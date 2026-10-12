import { Router } from 'express';
import { z } from 'zod';
import { many, one, query } from '../../db/pool.js';
import { ERROR_CATEGORIES } from '../../domain/errors.js';
import { PROVENANCE_FILTERS, PROVENANCE_SQL } from '../../domain/provenance.js';
import { userId } from '../../lib/auth.js';
import { forbidden, notFound } from '../../lib/errors.js';
import { boolish, csv, pagination, parseBody, parseQuery, uuidParam } from '../../lib/validate.js';
import { recordAttempt } from '../../services/attempts.js';
import { loadQuestionPublic, loadSolution } from './repo.js';

export const questionsRouter = Router();

const listQuery = pagination.extend({
  q: z.string().max(200).optional(),
  section: csv(z.enum(['VARC', 'DILR', 'QA'])),
  topic: csv(z.string()),
  subtopic: csv(z.string()),
  difficulty: csv(z.enum(['easy', 'medium', 'difficult', 'advanced'])),
  type: csv(z.enum(['MCQ', 'TITA'])),
  origin: csv(z.enum(['authentic_pyq', 'reconstructed', 'inspired', 'original_practice', 'ai_generated'])),
  year: csv(z.coerce.number().int()),
  slot: csv(z.coerce.number().int()),
  sourceVerification: csv(z.enum(['verified', 'unverified', 'not_applicable'])),
  provenance: csv(z.enum(['verified_pyq', 'unverified_historical', 'practice'])),
  attempted: boolish,
  result: z.enum(['correct', 'incorrect']).optional(),
  previouslyIncorrect: boolish,
  bookmarked: boolish,
  mastery: csv(z.enum(['not_started', 'learning', 'practicing', 'weak', 'revision_due', 'proficient', 'exam_ready'])),
  minTimeSec: z.coerce.number().int().min(0).optional(),
  maxTimeSec: z.coerce.number().int().min(0).optional(),
  sort: z.enum(['default', 'difficulty', 'year', 'recent']).default('default'),
});

questionsRouter.get('/', async (req, res) => {
  const uid = userId(req);
  const f = parseQuery(listQuery, req);
  const where: string[] = ["q.status = 'published'"];
  const params: unknown[] = [uid];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (f.q) {
    params.push(f.q);
    const i = params.length;
    where.push(`(q.search @@ plainto_tsquery('english', $${i}) OR q.external_id ILIKE '%' || $${i} || '%' OR q.stem_md ILIKE '%' || $${i} || '%')`);
  }
  if (f.section) add('q.section_id = ANY(?)', f.section);
  if (f.topic) add('q.topic_id = ANY(?)', f.topic);
  if (f.subtopic) add('q.subtopic_id = ANY(?)', f.subtopic);
  if (f.difficulty) add('q.difficulty = ANY(?)', f.difficulty);
  if (f.type) add('q.question_type = ANY(?)', f.type);
  if (f.origin) add('q.origin = ANY(?)', f.origin);
  if (f.year) add('q.exam_year = ANY(?)', f.year);
  if (f.slot) add('q.exam_slot = ANY(?)', f.slot);
  if (f.sourceVerification) add('q.source_verification = ANY(?)', f.sourceVerification);
  if (f.provenance) where.push(`(${f.provenance.map((p) => PROVENANCE_FILTERS[p]).join(' OR ')})`);
  if (f.attempted === true) where.push('st.attempts > 0');
  if (f.attempted === false) where.push('coalesce(st.attempts, 0) = 0');
  if (f.result === 'correct') where.push('st.last_correct IS TRUE');
  if (f.result === 'incorrect') where.push('st.last_correct IS FALSE');
  if (f.previouslyIncorrect) where.push('st.ever_wrong IS TRUE');
  if (f.bookmarked) where.push('b.question_id IS NOT NULL');
  if (f.mastery) add("coalesce(m.state, 'not_started') = ANY(?)", f.mastery);
  if (f.minTimeSec !== undefined) add('st.avg_time >= ?', f.minTimeSec);
  if (f.maxTimeSec !== undefined) add('st.avg_time <= ?', f.maxTimeSec);

  const order = {
    default: 'q.section_id, t.position, q.passage_id NULLS FIRST, q.dilr_set_id NULLS FIRST, q.position_in_group NULLS FIRST, q.external_id',
    difficulty: "array_position(ARRAY['easy','medium','difficult','advanced'], q.difficulty) DESC, q.external_id",
    year: 'q.exam_year DESC NULLS LAST, q.exam_slot NULLS LAST, q.external_id',
    recent: 'st.last_at DESC NULLS LAST, q.external_id',
  }[f.sort];

  const sql = `
    WITH st AS (
      SELECT question_id, count(*) AS attempts, avg(time_taken_sec)::int AS avg_time, bool_or(NOT is_correct) AS ever_wrong, max(created_at) AS last_at,
             (array_agg(is_correct ORDER BY created_at DESC))[1] AS last_correct
        FROM question_attempts WHERE user_id = $1 GROUP BY question_id)
    SELECT q.id, q.external_id, q.section_id, q.topic_id, t.name AS topic_name, q.question_type, q.difficulty, left(q.stem_md, 220) AS stem_preview,
           q.estimated_time_sec, q.origin, q.exam_year, q.exam_slot, q.question_number, q.source_verification, q.solution_verification, q.passage_id, q.dilr_set_id,
           ${PROVENANCE_SQL} AS provenance,
           coalesce(st.attempts, 0) AS attempts, st.last_correct, st.avg_time, b.question_id IS NOT NULL AS bookmarked, coalesce(m.state, 'not_started') AS topic_state,
           count(*) OVER () AS total
      FROM questions q
      JOIN topics t ON t.id = q.topic_id
      LEFT JOIN st ON st.question_id = q.id
      LEFT JOIN bookmarks b ON b.question_id = q.id AND b.user_id = $1
      LEFT JOIN user_topic_mastery m ON m.topic_id = q.topic_id AND m.user_id = $1
     WHERE ${where.join(' AND ')}
     ORDER BY ${order}
     LIMIT ${f.pageSize} OFFSET ${(f.page - 1) * f.pageSize}`;
  const rows = await many(sql, params);
  const total = rows[0]?.total ?? 0;
  res.json({ items: rows.map(({ total: _t, ...r }) => r), page: f.page, pageSize: f.pageSize, total });
});

/** Facet values for filters, including counts by origin so users see how many authentic PYQs exist. */
questionsRouter.get('/facets', async (_req, res) => {
  const [years, origins, sections] = await Promise.all([
    many("SELECT exam_year AS year, exam_slot AS slot, count(*) AS n FROM questions WHERE status = 'published' AND exam_year IS NOT NULL GROUP BY 1, 2 ORDER BY 1 DESC, 2"),
    many(`SELECT q.origin, q.source_verification, ${PROVENANCE_SQL} AS provenance, count(*) AS n FROM questions q WHERE q.status = 'published' GROUP BY 1, 2, 3`),
    many("SELECT section_id, count(*) AS n FROM questions WHERE status = 'published' GROUP BY 1"),
  ]);
  res.json({ years, origins, sections });
});

questionsRouter.get('/:id', async (req, res) => {
  const q = await loadQuestionPublic(uuidParam(req), userId(req));
  if (!q) throw notFound('Question');
  const notes = await many('SELECT id, kind, body, anchor, created_at, updated_at FROM user_notes WHERE user_id = $1 AND question_id = $2 ORDER BY created_at', [userId(req), q.id]);
  res.json({ ...q, notes });
});

/** Progressive hints. Does not reveal the answer. */
questionsRouter.get('/:id/hints', async (req, res) => {
  const id = uuidParam(req);
  const { count } = parseQuery(z.object({ count: z.coerce.number().int().min(1).max(10).default(1) }), req);
  const row = await one("SELECT s.hints FROM question_solutions s JOIN questions q ON q.id = s.question_id WHERE q.id = $1 AND q.status = 'published'", [id]);
  if (!row) throw notFound('Question');
  res.json({ hints: row.hints.slice(0, count), total: row.hints.length });
});

/**
 * Solution is available once the learner has attempted the question, or when they
 * explicitly reveal it (?reveal=true), which is recorded so later attempts on this
 * question do not count as independent evidence of mastery.
 */
questionsRouter.get('/:id/solution', async (req, res) => {
  const uid = userId(req);
  const id = uuidParam(req);
  const { reveal } = parseQuery(z.object({ reveal: boolish }), req);
  const exists = await one("SELECT 1 FROM questions WHERE id = $1 AND status = 'published'", [id]);
  if (!exists) throw notFound('Question');
  const attempted = await one('SELECT 1 FROM question_attempts WHERE user_id = $1 AND question_id = $2 LIMIT 1', [uid, id]);
  const revealed = await one('SELECT 1 FROM solution_reveals WHERE user_id = $1 AND question_id = $2', [uid, id]);
  const inSubmittedMock = await one(
    `SELECT 1 FROM mock_responses r JOIN mock_attempts a ON a.id = r.attempt_id WHERE a.user_id = $1 AND r.question_id = $2 AND a.status = 'submitted' LIMIT 1`,
    [uid, id],
  );
  const inOpenMock = await one(
    `SELECT 1 FROM mock_attempts a JOIN mock_test_sections s ON s.mock_test_id = a.mock_test_id JOIN mock_test_questions mq ON mq.mock_test_section_id = s.id
      WHERE a.user_id = $1 AND a.status = 'in_progress' AND mq.question_id = $2 LIMIT 1`,
    [uid, id],
  );
  if (inOpenMock) throw forbidden('This question is part of a test you have not submitted yet');
  if (!attempted && !revealed && !inSubmittedMock) {
    if (!reveal) throw forbidden('Answer the question first, or choose to reveal the solution');
    await query('INSERT INTO solution_reveals(user_id, question_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [uid, id]);
  }
  res.json(await loadSolution(id));
});

const attemptBody = z.object({
  answer: z.string().max(50).nullable(),
  timeTakenSec: z.number().min(0).max(4 * 3600),
  confidence: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  guessed: z.boolean().optional(),
  timed: z.boolean().optional(),
  hintsUsed: z.number().int().min(0).max(10).optional(),
  mistakeType: z.enum(ERROR_CATEGORIES).optional(),
  context: z.enum(['practice', 'lesson', 'diagnostic', 'revision', 'drill', 'error_test']).optional(),
  contextId: z.string().max(100).optional(),
});

questionsRouter.post('/:id/attempts', async (req, res) => {
  const body = parseBody(attemptBody, req);
  const inOpenMock = await one(
    `SELECT 1 FROM mock_attempts a JOIN mock_test_sections s ON s.mock_test_id = a.mock_test_id JOIN mock_test_questions mq ON mq.mock_test_section_id = s.id
      WHERE a.user_id = $1 AND a.status = 'in_progress' AND mq.question_id = $2 LIMIT 1`,
    [userId(req), uuidParam(req)],
  );
  if (inOpenMock) throw forbidden('Answer this question inside the test you have in progress');
  const result = await recordAttempt(userId(req), uuidParam(req), body);
  res.status(201).json({
    attemptId: result.attempt.id,
    correct: result.correct,
    correctAnswer: result.correctAnswer,
    errorLogId: result.errorLogId,
    mastery: { score: result.mastery.score, state: result.mastery.state, reason: result.mastery.reason },
  });
});

/** Post-answer reflection: understood flag and mistake type can be set after seeing the solution. */
questionsRouter.patch('/attempts/:attemptId', async (req, res) => {
  const uid = userId(req);
  const id = uuidParam(req, 'attemptId');
  const body = parseBody(z.object({ understood: z.boolean().optional(), mistakeType: z.enum(ERROR_CATEGORIES).optional(), confidence: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional() }), req);
  const a = await one('SELECT id, question_id, is_correct FROM question_attempts WHERE id = $1 AND user_id = $2', [id, uid]);
  if (!a) throw notFound('Attempt');
  await query(
    'UPDATE question_attempts SET understood = coalesce($3, understood), mistake_type = CASE WHEN is_correct THEN NULL ELSE coalesce($4, mistake_type) END, confidence = coalesce($5, confidence) WHERE id = $1 AND user_id = $2',
    [id, uid, body.understood ?? null, body.mistakeType ?? null, body.confidence ?? null],
  );
  if (!a.is_correct && body.mistakeType) {
    await query("UPDATE error_logs SET category = $3, updated_at = now() WHERE user_id = $1 AND question_id = $2 AND resolved_at IS NULL", [uid, a.question_id, body.mistakeType]);
    const t = await one('SELECT topic_id FROM questions WHERE id = $1', [a.question_id]);
    const { recomputeTopicMastery } = await import('../../services/mastery.js');
    await recomputeTopicMastery(uid, t!.topic_id);
  }
  res.json({ ok: true });
});

questionsRouter.get('/:id/history', async (req, res) => {
  const rows = await many(
    `SELECT id, context, answer, is_correct, time_taken_sec, timed, confidence, guessed, understood, mistake_type, hints_used, solution_seen_first, created_at
       FROM question_attempts WHERE user_id = $1 AND question_id = $2 ORDER BY created_at DESC`,
    [userId(req), uuidParam(req)],
  );
  res.json({ items: rows });
});

questionsRouter.post('/:id/bookmark', async (req, res) => {
  const id = uuidParam(req);
  const exists = await one("SELECT 1 FROM questions WHERE id = $1 AND status = 'published'", [id]);
  if (!exists) throw notFound('Question');
  await query('INSERT INTO bookmarks(user_id, question_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [userId(req), id]);
  res.status(201).json({ bookmarked: true });
});

questionsRouter.delete('/:id/bookmark', async (req, res) => {
  await query('DELETE FROM bookmarks WHERE user_id = $1 AND question_id = $2', [userId(req), uuidParam(req)]);
  res.json({ bookmarked: false });
});
