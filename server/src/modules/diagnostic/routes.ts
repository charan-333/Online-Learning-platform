import { Router } from 'express';
import { z } from 'zod';
import { many, one, query } from '../../db/pool.js';
import { userId } from '../../lib/auth.js';
import { badRequest, conflict } from '../../lib/errors.js';
import { parseBody } from '../../lib/validate.js';
import { recordAttempt } from '../../services/attempts.js';
import { generatePlan } from '../../services/plans.js';

export const diagnosticRouter = Router();

/**
 * Deterministic short diagnostic: one QA question from each QA area (preferring
 * medium difficulty), one complete RC passage, one verbal-ability item, and the
 * shortest complete DILR set.
 */
async function diagnosticQuestionIds(): Promise<string[]> {
  const qa = await many(
    `SELECT DISTINCT ON (t.area) q.id FROM questions q JOIN topics t ON t.id = q.topic_id
      WHERE q.status = 'published' AND q.section_id = 'QA'
      ORDER BY t.area, (q.difficulty = 'medium') DESC, t.position, q.external_id`,
  );
  const passage = await one(
    `SELECT passage_id FROM questions WHERE status = 'published' AND passage_id IS NOT NULL GROUP BY passage_id ORDER BY count(*) DESC, passage_id LIMIT 1`,
  );
  const rc = passage ? await many("SELECT id FROM questions WHERE passage_id = $1 AND status = 'published' ORDER BY position_in_group", [passage.passage_id]) : [];
  const va = await many(
    "SELECT id FROM questions WHERE status = 'published' AND section_id = 'VARC' AND passage_id IS NULL ORDER BY (difficulty = 'medium') DESC, external_id LIMIT 1",
  );
  const set = await one(
    `SELECT s.id FROM dilr_sets s WHERE EXISTS (SELECT 1 FROM questions q WHERE q.dilr_set_id = s.id AND q.status = 'published') ORDER BY s.estimated_time_sec, s.external_id LIMIT 1`,
  );
  const dilr = set ? await many("SELECT id FROM questions WHERE dilr_set_id = $1 AND status = 'published' ORDER BY position_in_group", [set.id]) : [];
  return [...rc, ...va, ...dilr, ...qa].map((r) => r.id);
}

diagnosticRouter.get('/', async (req, res) => {
  const ids = await diagnosticQuestionIds();
  const qs = await many(
    `SELECT q.id, q.section_id, q.topic_id, t.name AS topic_name, q.question_type, q.difficulty, q.stem_md, q.estimated_time_sec, q.passage_id, q.dilr_set_id, q.origin,
            (SELECT json_agg(json_build_object('key', o.key, 'text_md', o.text_md) ORDER BY o.key) FROM question_options o WHERE o.question_id = q.id) AS options
       FROM questions q JOIN topics t ON t.id = q.topic_id WHERE q.id = ANY($1::uuid[])`,
    [ids],
  );
  const ordered = ids.map((id) => qs.find((q) => q.id === id)).filter(Boolean);
  const groupIds = { passages: [...new Set(ordered.map((q) => q.passage_id).filter(Boolean))], sets: [...new Set(ordered.map((q) => q.dilr_set_id).filter(Boolean))] };
  const passages = groupIds.passages.length ? await many('SELECT id, title, domain, body_md FROM passages WHERE id = ANY($1::uuid[])', [groupIds.passages]) : [];
  const sets = groupIds.sets.length ? await many('SELECT id, title, set_type, body_md FROM dilr_sets WHERE id = ANY($1::uuid[])', [groupIds.sets]) : [];
  const profile = await one('SELECT diagnostic_completed_at FROM user_profiles WHERE user_id = $1', [userId(req)]);
  res.json({
    questions: ordered,
    passages,
    sets,
    estimatedMinutes: Math.round(ordered.reduce((s, q: any) => s + q.estimated_time_sec, 0) / 60),
    completedAt: profile?.diagnostic_completed_at ?? null,
    note: 'The diagnostic uses CAT 100 original practice questions, not past CAT papers.',
  });
});

diagnosticRouter.post('/submit', async (req, res) => {
  const uid = userId(req);
  const b = parseBody(
    z.object({
      responses: z
        .array(
          z.object({
            questionId: z.string().uuid(),
            answer: z.string().max(50).nullable(),
            timeTakenSec: z.number().min(0).max(3600),
            confidence: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
          }),
        )
        .min(1)
        .max(60),
    }),
    req,
  );
  const allowed = new Set(await diagnosticQuestionIds());
  if (b.responses.some((r) => !allowed.has(r.questionId))) throw badRequest('Response for a question that is not in the diagnostic');
  const done = await one('SELECT diagnostic_completed_at FROM user_profiles WHERE user_id = $1', [uid]);
  if (done?.diagnostic_completed_at) {
    const recent = await one("SELECT 1 FROM question_attempts WHERE user_id = $1 AND context = 'diagnostic' AND created_at > now() - interval '7 days' LIMIT 1", [uid]);
    if (recent) throw conflict('You took the diagnostic in the last 7 days. Retake it after a week of practice.');
  }
  for (const r of b.responses) {
    await recordAttempt(uid, r.questionId, { answer: r.answer, timeTakenSec: r.timeTakenSec, confidence: r.confidence, context: 'diagnostic', timed: true });
  }
  const bySection = await many(
    `SELECT q.section_id, count(*) AS attempted, count(*) FILTER (WHERE a.is_correct) AS correct, sum(a.time_taken_sec) AS time_sec, sum(q.estimated_time_sec) AS est_sec
       FROM question_attempts a JOIN questions q ON q.id = a.question_id
      WHERE a.user_id = $1 AND a.context = 'diagnostic' AND a.created_at > now() - interval '1 hour' GROUP BY 1`,
    [uid],
  );
  const sections = bySection.map((s) => {
    const accuracy = s.attempted ? s.correct / s.attempted : 0;
    return {
      sectionId: s.section_id,
      attempted: s.attempted,
      correct: s.correct,
      accuracy: Math.round(accuracy * 100),
      speed: s.time_sec ? Math.round((s.est_sec / s.time_sec) * 100) : null,
      suggestedMode: accuracy >= 0.75 ? 'B' : 'A',
      interpretation:
        accuracy >= 0.75
          ? 'Strong start on this small sample; you can move to high-performance practice in this section while we confirm with more questions.'
          : accuracy >= 0.4
            ? 'Mixed results; build concepts in weaker topics while practising PYQ-style problems.'
            : 'Start from fundamentals in this section; the plan front-loads concept work here.',
    };
  });
  const overallAcc = bySection.reduce((s, x) => s + x.correct, 0) / Math.max(1, bySection.reduce((s, x) => s + x.attempted, 0));
  await query('UPDATE user_profiles SET diagnostic_completed_at = now(), onboarding_completed = true, preparation_mode = $2, updated_at = now() WHERE user_id = $1', [
    uid,
    overallAcc >= 0.75 ? 'B' : 'A',
  ]);
  const plan = await generatePlan(uid);
  res.json({
    sections,
    overallAccuracy: Math.round(overallAcc * 100),
    caveat: `Based on ${b.responses.length} questions. Treat this as a starting point; mastery estimates update with every attempt.`,
    planId: plan.id,
  });
});
