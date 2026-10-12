import { Router } from 'express';
import { z } from 'zod';
import { many, one } from '../../db/pool.js';
import { userId } from '../../lib/auth.js';
import { GROUP_PROVENANCE_SQL, GROUP_VISIBLE_SQL } from '../../domain/provenance.js';
import { notFound } from '../../lib/errors.js';
import { parseQuery } from '../../lib/validate.js';

export const syllabusRouter = Router();

syllabusRouter.get('/sections', async (req, res) => {
  const rows = await many(
    `SELECT s.id, s.name, s.position, count(t.id) AS topic_count,
            count(m.topic_id) FILTER (WHERE m.state IN ('proficient', 'exam_ready')) AS proficient_topics,
            round(avg(coalesce(m.score, 0)), 1) AS avg_mastery
       FROM sections s JOIN topics t ON t.section_id = s.id
       LEFT JOIN user_topic_mastery m ON m.topic_id = t.id AND m.user_id = $1
      GROUP BY s.id ORDER BY s.position`,
    [userId(req)],
  );
  res.json({ items: rows });
});

syllabusRouter.get('/topics', async (req, res) => {
  const { section } = parseQuery(z.object({ section: z.enum(['VARC', 'DILR', 'QA']).optional() }), req);
  const rows = await many(
    `SELECT t.id, t.section_id, t.area, t.name, t.position, t.summary, t.content_status, t.estimated_hours,
            coalesce(m.score, 0) AS mastery_score, coalesce(m.state, 'not_started') AS mastery_state, m.mode, m.state_reason,
            (SELECT count(*) FROM questions q WHERE q.topic_id = t.id AND q.status = 'published') AS question_count,
            (SELECT count(*) FROM questions q WHERE q.topic_id = t.id AND q.status = 'published' AND q.origin = 'authentic_pyq') AS pyq_count,
            (SELECT array_agg(prerequisite_id) FROM topic_prerequisites p WHERE p.topic_id = t.id) AS prerequisites
       FROM topics t
       LEFT JOIN user_topic_mastery m ON m.topic_id = t.id AND m.user_id = $1
      WHERE ($2::text IS NULL OR t.section_id = $2)
      ORDER BY t.section_id, t.position`,
    [userId(req), section ?? null],
  );
  res.json({ items: rows });
});

syllabusRouter.get('/topics/:id', async (req, res) => {
  const id = z.string().max(100).parse(req.params.id);
  const uid = userId(req);
  const topic = await one('SELECT * FROM topics WHERE id = $1', [id]);
  if (!topic) throw notFound('Topic');
  const [subtopics, prereqs, dependents, formulas, examples, counts, mastery, notes] = await Promise.all([
    many('SELECT id, name FROM subtopics WHERE topic_id = $1 ORDER BY position', [id]),
    many(
      `SELECT t.id, t.name, coalesce(m.state, 'not_started') AS mastery_state, coalesce(m.score, 0) AS mastery_score
         FROM topic_prerequisites p JOIN topics t ON t.id = p.prerequisite_id LEFT JOIN user_topic_mastery m ON m.topic_id = t.id AND m.user_id = $2
        WHERE p.topic_id = $1`,
      [id, uid],
    ),
    many('SELECT t.id, t.name FROM topic_prerequisites p JOIN topics t ON t.id = p.topic_id WHERE p.prerequisite_id = $1', [id]),
    many('SELECT * FROM formula_cards WHERE topic_id = $1 ORDER BY high_value DESC, title', [id]),
    many('SELECT id, problem_md, solution_md FROM worked_examples WHERE topic_id = $1 ORDER BY position', [id]),
    many(
      `SELECT difficulty, origin, count(*) AS n FROM questions WHERE topic_id = $1 AND status = 'published' GROUP BY 1, 2`,
      [id],
    ),
    one('SELECT * FROM user_topic_mastery WHERE user_id = $1 AND topic_id = $2', [uid, id]),
    many('SELECT id, body, created_at, updated_at FROM user_notes WHERE user_id = $1 AND topic_id = $2 ORDER BY created_at', [uid, id]),
  ]);
  res.json({ ...topic, subtopics, prerequisites: prereqs, dependents, formulas, workedExamples: examples, questionCounts: counts, mastery, notes });
});

syllabusRouter.get('/topics/:id/prerequisites', async (req, res) => {
  const id = z.string().max(100).parse(req.params.id);
  // Full prerequisite chain (transitive), nearest first.
  const rows = await many(
    `WITH RECURSIVE chain(topic_id, prerequisite_id, depth) AS (
        SELECT topic_id, prerequisite_id, 1 FROM topic_prerequisites WHERE topic_id = $1
        UNION
        SELECT p.topic_id, p.prerequisite_id, c.depth + 1 FROM topic_prerequisites p JOIN chain c ON p.topic_id = c.prerequisite_id WHERE c.depth < 10)
     SELECT DISTINCT ON (t.id) t.id, t.name, c.depth, coalesce(m.state, 'not_started') AS mastery_state, coalesce(m.score, 0) AS mastery_score
       FROM chain c JOIN topics t ON t.id = c.prerequisite_id
       LEFT JOIN user_topic_mastery m ON m.topic_id = t.id AND m.user_id = $2
      ORDER BY t.id, c.depth`,
    [id, userId(req)],
  );
  res.json({ items: rows.sort((a, b) => a.depth - b.depth) });
});

syllabusRouter.get('/topics/:id/progress', async (req, res) => {
  const id = z.string().max(100).parse(req.params.id);
  const uid = userId(req);
  const mastery = await one('SELECT * FROM user_topic_mastery WHERE user_id = $1 AND topic_id = $2', [uid, id]);
  const byDifficulty = await many(
    `SELECT q.difficulty, count(*) AS attempts, count(*) FILTER (WHERE a.is_correct) AS correct, round(avg(a.time_taken_sec)) AS avg_time
       FROM question_attempts a JOIN questions q ON q.id = a.question_id WHERE a.user_id = $1 AND q.topic_id = $2 GROUP BY 1`,
    [uid, id],
  );
  const recent = await many(
    `SELECT a.created_at, a.is_correct, a.time_taken_sec, q.difficulty, q.external_id FROM question_attempts a JOIN questions q ON q.id = a.question_id
      WHERE a.user_id = $1 AND q.topic_id = $2 ORDER BY a.created_at DESC LIMIT 20`,
    [uid, id],
  );
  res.json({ mastery, byDifficulty, recent });
});

// ------------------------------------------------------------- passages & DILR sets
export const groupsRouter = Router();

groupsRouter.get('/passages', async (_req, res) => {
  const rows = await many(
    `SELECT g.id, g.external_id, g.title, g.domain, g.difficulty, g.word_count, g.origin, g.exam_year, g.exam_slot, ${GROUP_PROVENANCE_SQL} AS provenance,
            (SELECT count(*) FROM questions q WHERE q.passage_id = g.id AND q.status = 'published') AS question_count
       FROM passages g WHERE ${GROUP_VISIBLE_SQL} ORDER BY g.created_at`,
  );
  res.json({ items: rows });
});

groupsRouter.get('/dilr-sets', async (_req, res) => {
  const rows = await many(
    `SELECT g.id, g.external_id, g.title, g.set_type, g.difficulty, g.origin, g.exam_year, g.exam_slot, g.estimated_time_sec, ${GROUP_PROVENANCE_SQL} AS provenance,
            (SELECT count(*) FROM questions q WHERE q.dilr_set_id = g.id AND q.status = 'published') AS question_count
       FROM dilr_sets g WHERE ${GROUP_VISIBLE_SQL} ORDER BY g.created_at`,
  );
  res.json({ items: rows });
});

/** Group analysis (argument map, deductions) unlocks once every question in the group has been attempted, or on explicit reveal. */
async function groupDetail(kind: 'passage' | 'dilr_set', id: string, uid: string, reveal: boolean) {
  const table = kind === 'passage' ? 'passages' : 'dilr_sets';
  const fk = kind === 'passage' ? 'passage_id' : 'dilr_set_id';
  // A passage or set from a CAT paper stays hidden until its review approval.
  const g = await one(`SELECT g.*, ${GROUP_PROVENANCE_SQL} AS provenance FROM ${table} g WHERE g.id = $1 AND ${GROUP_VISIBLE_SQL}`, [id]);
  if (!g) return null;
  const questions = await many(
    `SELECT q.id, q.external_id, q.position_in_group, q.question_type, q.difficulty, q.stem_md, q.topic_id, q.estimated_time_sec,
            (SELECT a.is_correct FROM question_attempts a WHERE a.user_id = $2 AND a.question_id = q.id ORDER BY a.created_at DESC LIMIT 1) AS last_correct,
            (SELECT json_agg(json_build_object('key', o.key, 'text_md', o.text_md) ORDER BY o.key) FROM question_options o WHERE o.question_id = q.id) AS options
       FROM questions q WHERE q.${fk} = $1 AND q.status = 'published' ORDER BY q.position_in_group, q.external_id`,
    [id, uid],
  );
  const allAttempted = questions.length > 0 && questions.every((q) => q.last_correct !== null);
  const unlocked = allAttempted || reveal;
  const analysisFields = kind === 'passage' ? ['central_argument', 'structure_md', 'purpose_tone', 'vocabulary_md'] : ['structure_md', 'deductions_md', 'selection_md'];
  const analysis = unlocked ? Object.fromEntries(analysisFields.map((f) => [f, g[f]])) : null;
  for (const f of analysisFields) delete g[f];
  const notes = await many(`SELECT id, kind, body, anchor, created_at, updated_at FROM user_notes WHERE user_id = $1 AND ${fk} = $2 ORDER BY created_at`, [uid, id]);
  return { ...g, kind, questions, analysis, analysisUnlocked: unlocked, notes };
}

groupsRouter.get('/passages/:id', async (req, res) => {
  const { reveal } = parseQuery(z.object({ reveal: z.enum(['true', 'false']).optional() }), req);
  const d = await groupDetail('passage', z.string().uuid().parse(req.params.id), userId(req), reveal === 'true');
  if (!d) throw notFound('Passage');
  res.json(d);
});

groupsRouter.get('/dilr-sets/:id', async (req, res) => {
  const { reveal } = parseQuery(z.object({ reveal: z.enum(['true', 'false']).optional() }), req);
  const d = await groupDetail('dilr_set', z.string().uuid().parse(req.params.id), userId(req), reveal === 'true');
  if (!d) throw notFound('DILR set');
  res.json(d);
});

groupsRouter.get('/formulas', async (req, res) => {
  const { q, topic, section } = parseQuery(z.object({ q: z.string().max(100).optional(), topic: z.string().max(100).optional(), section: z.enum(['VARC', 'DILR', 'QA']).optional() }), req);
  const rows = await many(
    `SELECT f.*, t.name AS topic_name, t.area, t.section_id FROM formula_cards f JOIN topics t ON t.id = f.topic_id
      WHERE ($1::text IS NULL OR f.title ILIKE '%' || $1 || '%' OR f.explanation_md ILIKE '%' || $1 || '%' OR t.name ILIKE '%' || $1 || '%')
        AND ($2::text IS NULL OR f.topic_id = $2) AND ($3::text IS NULL OR t.section_id = $3)
      ORDER BY t.section_id, t.position, f.high_value DESC, f.title`,
    [q ?? null, topic ?? null, section ?? null],
  );
  res.json({ items: rows });
});
