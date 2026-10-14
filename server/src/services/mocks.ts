import type pg from 'pg';
import { many, one, pool, query, tx } from '../db/pool.js';
import { classify, expectedValue, MOCK_CLASS_LABEL, successProbability, type MockClass } from '../domain/mockAnalysis.js';
import { PROVENANCE_SQL } from '../domain/provenance.js';
import { marksFor } from '../domain/scoring.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { activeConfig, configForYear, loadConfig, type LoadedConfig } from './examConfigs.js';
import { recomputeTopicMastery } from './mastery.js';
import { enqueueRevision } from './revision.js';

const GRACE_MS = 5000;

interface TestQuestion {
  mock_test_section_id: string;
  question_id: string;
  position: number;
  marks_correct: number;
  marks_wrong: number;
}
interface TestSection {
  id: string;
  section_id: string;
  position: number;
  duration_sec: number;
  questions: TestQuestion[];
}
export interface TestStructure {
  test: any;
  sections: TestSection[];
}

export async function loadTestStructure(testId: string, db: pg.Pool | pg.PoolClient = pool): Promise<TestStructure | null> {
  const test = await one('SELECT * FROM mock_tests WHERE id = $1', [testId], db);
  if (!test) return null;
  const sections = await many('SELECT * FROM mock_test_sections WHERE mock_test_id = $1 ORDER BY position', [testId], db);
  const questions = await many(
    `SELECT mq.mock_test_section_id, mq.question_id, mq.position, mq.marks_correct, mq.marks_wrong
       FROM mock_test_questions mq JOIN mock_test_sections s ON s.id = mq.mock_test_section_id WHERE s.mock_test_id = $1 ORDER BY s.position, mq.position`,
    [testId],
    db,
  );
  return { test, sections: sections.map((s) => ({ ...s, questions: questions.filter((q) => q.mock_test_section_id === s.id) })) };
}

function deadlines(attempt: any, structure: NonNullable<Awaited<ReturnType<typeof loadTestStructure>>>) {
  if (structure.test.sectional_lock) {
    const sec = structure.sections[attempt.current_section];
    return { sectionDeadline: new Date(new Date(attempt.section_started_at).getTime() + sec.duration_sec * 1000), sectional: true };
  }
  const total = structure.sections.reduce((s, x) => s + x.duration_sec, 0);
  return { sectionDeadline: new Date(new Date(attempt.started_at).getTime() + total * 1000), sectional: false };
}

/**
 * Server-side clock. Applies any section changes or the final submission that
 * should already have happened, so a learner who closes the tab and returns later
 * sees the correct state. Must be called inside a transaction holding the row lock.
 */
async function syncClock(c: pg.PoolClient, attemptId: string) {
  let attempt = await one('SELECT * FROM mock_attempts WHERE id = $1 FOR UPDATE', [attemptId], c);
  if (!attempt || attempt.status !== 'in_progress') return attempt;
  const structure = (await loadTestStructure(attempt.mock_test_id, c))!;
  for (;;) {
    const { sectionDeadline, sectional } = deadlines(attempt, structure);
    if (Date.now() <= sectionDeadline.getTime() + GRACE_MS) break;
    if (sectional && attempt.current_section < structure.sections.length - 1) {
      attempt = await one(
        'UPDATE mock_attempts SET current_section = current_section + 1, section_started_at = $2 WHERE id = $1 RETURNING *',
        [attemptId, sectionDeadline],
        c,
      );
    } else {
      await finaliseAttempt(c, attempt, 'timeout');
      attempt = await one('SELECT * FROM mock_attempts WHERE id = $1', [attemptId], c);
      break;
    }
  }
  return attempt;
}

export async function startOrResume(userId: string, testId: string) {
  const structure = await loadTestStructure(testId);
  if (!structure) throw notFound('Test');
  if (structure.test.owner_id && structure.test.owner_id !== userId) throw notFound('Test');
  if (!structure.sections.some((s) => s.questions.length)) throw badRequest('This test has no questions');
  return tx(async (c) => {
    const open = await one("SELECT id FROM mock_attempts WHERE user_id = $1 AND mock_test_id = $2 AND status = 'in_progress' FOR UPDATE", [userId, testId], c);
    if (open) {
      const synced = await syncClock(c, open.id);
      if (synced.status === 'in_progress') return synced.id as string;
    }
    const a = await one('INSERT INTO mock_attempts(mock_test_id, user_id) VALUES ($1,$2) RETURNING id', [testId, userId], c);
    return a!.id as string;
  });
}

export async function attemptState(userId: string, attemptId: string) {
  const attempt = await tx(async (c) => {
    const a = await one('SELECT user_id FROM mock_attempts WHERE id = $1', [attemptId], c);
    if (!a || a.user_id !== userId) throw notFound('Test attempt');
    return syncClock(c, attemptId);
  });
  const structure = (await loadTestStructure(attempt.mock_test_id))!;
  const responses = await many('SELECT question_id, answer, flagged, visited, time_spent_sec FROM mock_responses WHERE attempt_id = $1', [attemptId]);
  const qids = structure.sections.flatMap((s) => s.questions.map((q) => q.question_id));
  const qs = await many(
    `SELECT q.id, q.section_id, q.question_type, q.difficulty, q.stem_md, q.passage_id, q.dilr_set_id, q.origin, q.exam_year, q.exam_slot, q.question_number, q.topic_id,
            ${PROVENANCE_SQL} AS provenance,
            (SELECT json_agg(json_build_object('key', o.key, 'text_md', o.text_md) ORDER BY o.key) FROM question_options o WHERE o.question_id = q.id) AS options
       FROM questions q WHERE q.id = ANY($1::uuid[])`,
    [qids],
  );
  const passageIds = [...new Set(qs.map((q) => q.passage_id).filter(Boolean))];
  const setIds = [...new Set(qs.map((q) => q.dilr_set_id).filter(Boolean))];
  const passages = passageIds.length ? await many('SELECT id, title, body_md FROM passages WHERE id = ANY($1::uuid[])', [passageIds]) : [];
  const sets = setIds.length ? await many('SELECT id, title, body_md FROM dilr_sets WHERE id = ANY($1::uuid[])', [setIds]) : [];
  const { sectionDeadline } = attempt.status === 'in_progress' ? deadlines(attempt, structure) : { sectionDeadline: null };
  const pattern = structure.test.exam_config_id ? await loadConfig(structure.test.exam_config_id) : null;
  const visibleSections = structure.test.sectional_lock && attempt.status === 'in_progress' ? [attempt.current_section] : structure.sections.map((_, i) => i);
  return {
    attempt: {
      id: attempt.id,
      status: attempt.status,
      currentSection: attempt.current_section,
      startedAt: attempt.started_at,
      submittedAt: attempt.submitted_at,
      submitReason: attempt.submit_reason,
      rawScore: attempt.raw_score,
      deadline: sectionDeadline,
      serverNow: new Date(),
    },
    test: {
      id: structure.test.id,
      title: structure.test.title,
      kind: structure.test.kind,
      sectionalLock: structure.test.sectional_lock,
      description: structure.test.description,
      examPattern: pattern ? { id: pattern.id, label: pattern.label, status: pattern.status, year: pattern.year, version: pattern.version } : null,
    },
    sections: structure.sections.map((s, i) => ({
      index: i,
      sectionId: s.section_id,
      durationSec: s.duration_sec,
      locked: !visibleSections.includes(i),
      questions: visibleSections.includes(i)
        ? s.questions.map((mq) => ({ ...qs.find((q) => q.id === mq.question_id), position: mq.position, marksCorrect: mq.marks_correct, marksWrong: mq.marks_wrong }))
        : s.questions.map((mq) => ({ id: mq.question_id, position: mq.position })),
    })),
    responses,
    passages,
    sets,
  };
}

async function lockOpenAttempt(c: pg.PoolClient, userId: string, attemptId: string) {
  const a = await one('SELECT user_id FROM mock_attempts WHERE id = $1', [attemptId], c);
  if (!a || a.user_id !== userId) throw notFound('Test attempt');
  const synced = await syncClock(c, attemptId);
  if (synced.status !== 'in_progress') throw conflict('This test has already been submitted');
  return synced;
}

export async function saveResponse(userId: string, attemptId: string, questionId: string, b: { answer?: string | null; flagged?: boolean; timeSpentSec?: number }) {
  return tx(async (c) => {
    const attempt = await lockOpenAttempt(c, userId, attemptId);
    const structure = (await loadTestStructure(attempt.mock_test_id, c))!;
    const secIndex = structure.sections.findIndex((s) => s.questions.some((q) => q.question_id === questionId));
    if (secIndex < 0) throw notFound('Question in this test');
    if (structure.test.sectional_lock && secIndex !== attempt.current_section) throw forbidden('This section is closed');
    const maxTime = structure.sections[secIndex].duration_sec;
    const row = await one(
      `INSERT INTO mock_responses(attempt_id, question_id, answer, flagged, time_spent_sec) VALUES ($1,$2,$3,$4::boolean, LEAST($5::int, $6::int))
       ON CONFLICT (attempt_id, question_id) DO UPDATE SET
         answer = CASE WHEN $7::boolean THEN EXCLUDED.answer ELSE mock_responses.answer END,
         flagged = coalesce($8::boolean, mock_responses.flagged),
         time_spent_sec = LEAST(mock_responses.time_spent_sec + coalesce($9::int, 0), $6::int),
         visited = true, updated_at = now()
       RETURNING *`,
      [attemptId, questionId, b.answer ?? null, b.flagged ?? false, b.timeSpentSec ?? 0, maxTime, b.answer !== undefined, b.flagged ?? null, b.timeSpentSec ?? 0],
      c,
    );
    return row;
  });
}

export async function nextSection(userId: string, attemptId: string) {
  return tx(async (c) => {
    const attempt = await lockOpenAttempt(c, userId, attemptId);
    const structure = (await loadTestStructure(attempt.mock_test_id, c))!;
    if (!structure.test.sectional_lock) throw badRequest('This test has no section lock');
    if (attempt.current_section >= structure.sections.length - 1) throw badRequest('This is the last section; submit the test instead');
    await query('UPDATE mock_attempts SET current_section = current_section + 1, section_started_at = now() WHERE id = $1', [attemptId], c);
    return { currentSection: attempt.current_section + 1 };
  });
}

export async function submit(userId: string, attemptId: string) {
  return tx(async (c) => {
    const a = await one('SELECT user_id FROM mock_attempts WHERE id = $1', [attemptId], c);
    if (!a || a.user_id !== userId) throw notFound('Test attempt');
    const synced = await syncClock(c, attemptId);
    if (synced.status === 'in_progress') await finaliseAttempt(c, synced, 'manual');
    return one('SELECT id, status, raw_score, submitted_at, submit_reason FROM mock_attempts WHERE id = $1', [attemptId], c);
  });
}

/** Scores the attempt, writes the analysis, and feeds results into mastery and the error log. Runs inside the caller's transaction. */
async function finaliseAttempt(c: pg.PoolClient, attempt: any, reason: 'manual' | 'timeout') {
  const structure = (await loadTestStructure(attempt.mock_test_id, c))!;
  const responses = await many('SELECT * FROM mock_responses WHERE attempt_id = $1', [attempt.id], c);
  const qids = structure.sections.flatMap((s) => s.questions.map((q) => q.question_id));
  const qs = await many(
    `SELECT q.id, q.external_id, q.section_id, q.topic_id, t.name AS topic_name, q.question_type, q.correct_answer, q.answer_tolerance, q.difficulty, q.estimated_time_sec
       FROM questions q JOIN topics t ON t.id = q.topic_id WHERE q.id = ANY($1::uuid[])`,
    [qids],
    c,
  );
  // Topic history BEFORE this mock, for expected-value and classification.
  const hist = await many(
    `SELECT q.topic_id, count(*) AS n, count(*) FILTER (WHERE a.is_correct) AS k FROM question_attempts a JOIN questions q ON q.id = a.question_id
      WHERE a.user_id = $1 GROUP BY 1`,
    [attempt.user_id],
    c,
  );
  const mastery = await many('SELECT topic_id, score FROM user_topic_mastery WHERE user_id = $1', [attempt.user_id], c);

  const perQuestion: any[] = [];
  const sections: any[] = [];
  let total = 0;
  let maxTotal = 0;
  for (const s of structure.sections) {
    const sec = { sectionId: s.section_id, durationSec: s.duration_sec, score: 0, max: 0, correct: 0, wrong: 0, unanswered: 0, timeSec: 0, negative: 0 };
    for (const mq of s.questions) {
      const q = qs.find((x) => x.id === mq.question_id)!;
      const r = responses.find((x) => x.question_id === mq.question_id);
      const { status, marks } = marksFor({ ...q, marks_correct: mq.marks_correct, marks_wrong: mq.marks_wrong }, r?.answer);
      const h = hist.find((x) => x.topic_id === q.topic_id);
      const p = successProbability(q.difficulty, h?.n ?? 0, h?.k ?? 0);
      const ev = expectedValue(p, Number(mq.marks_correct), q.question_type === 'MCQ' ? Number(mq.marks_wrong) : 0);
      const topicMastery = mastery.find((m) => m.topic_id === q.topic_id)?.score ?? 0;
      const cls: MockClass = classify({ status, timeSec: r?.time_spent_sec ?? 0, estimatedSec: q.estimated_time_sec, difficulty: q.difficulty, topicMastery, expectedValue: ev });
      perQuestion.push({
        questionId: q.id,
        externalId: q.external_id,
        sectionId: s.section_id,
        topicId: q.topic_id,
        topicName: q.topic_name,
        type: q.question_type,
        difficulty: q.difficulty,
        answer: r?.answer ?? null,
        correctAnswer: q.correct_answer,
        status,
        marks,
        timeSec: r?.time_spent_sec ?? 0,
        estimatedSec: q.estimated_time_sec,
        flagged: !!r?.flagged,
        expectedValue: Math.round(ev * 100) / 100,
        classification: cls,
        classificationLabel: MOCK_CLASS_LABEL[cls],
      });
      sec.score += marks;
      sec.max += Number(mq.marks_correct);
      sec.timeSec += r?.time_spent_sec ?? 0;
      if (status === 'correct') sec.correct++;
      else if (status === 'wrong') {
        sec.wrong++;
        sec.negative += marks;
      } else sec.unanswered++;
    }
    total += sec.score;
    maxTotal += sec.max;
    sections.push({
      ...sec,
      accuracy: sec.correct + sec.wrong ? Math.round((sec.correct / (sec.correct + sec.wrong)) * 100) : null,
      attemptRate: Math.round(((sec.correct + sec.wrong) / Math.max(1, s.questions.length)) * 100),
    });
  }

  const byTopic = new Map<string, { topicId: string; topicName: string; attempted: number; correct: number; total: number }>();
  for (const q of perQuestion) {
    const t = byTopic.get(q.topicId) ?? { topicId: q.topicId, topicName: q.topicName, attempted: 0, correct: 0, total: 0 };
    t.total++;
    if (q.status !== 'unanswered') t.attempted++;
    if (q.status === 'correct') t.correct++;
    byTopic.set(q.topicId, t);
  }
  const topics = [...byTopic.values()];
  const easyMissed = perQuestion.filter((q) => q.difficulty === 'easy' && q.status !== 'correct');
  const hardWaste = perQuestion.filter((q) => (q.difficulty === 'difficult' || q.difficulty === 'advanced') && q.status !== 'correct' && q.timeSec > q.estimatedSec);
  const attemptedQ = perQuestion.filter((q) => q.status !== 'unanswered');
  const positiveEvAttempts = attemptedQ.filter((q) => q.expectedValue > 0).length;
  const skippedPositive = perQuestion.filter((q) => q.status === 'unanswered' && q.expectedValue > 0.5);
  const negative = perQuestion.filter((q) => q.status === 'wrong').reduce((s, q) => s + q.marks, 0);

  const previous = await many(
    `SELECT a.id, a.raw_score, a.submitted_at, ma.summary->'totals' AS totals FROM mock_attempts a JOIN mock_tests t ON t.id = a.mock_test_id
       LEFT JOIN mock_analysis ma ON ma.attempt_id = a.id
      WHERE a.user_id = $1 AND a.status = 'submitted' AND a.id <> $2 AND t.kind = $3 ORDER BY a.submitted_at DESC LIMIT 5`,
    [attempt.user_id, attempt.id, structure.test.kind],
    c,
  );
  const totals = {
    rawScore: total,
    maxScore: maxTotal,
    correct: perQuestion.filter((q) => q.status === 'correct').length,
    wrong: perQuestion.filter((q) => q.status === 'wrong').length,
    unanswered: perQuestion.filter((q) => q.status === 'unanswered').length,
    accuracy: attemptedQ.length ? Math.round((perQuestion.filter((q) => q.status === 'correct').length / attemptedQ.length) * 100) : null,
    attemptRate: Math.round((attemptedQ.length / Math.max(1, perQuestion.length)) * 100),
    negativeMarks: negative,
    timeSec: perQuestion.reduce((s, q) => s + q.timeSec, 0),
    selectionQuality: attemptedQ.length ? Math.round((positiveEvAttempts / attemptedQ.length) * 100) : null,
    easyMissed: easyMissed.length,
    hardTimeWastedSec: hardWaste.reduce((s, q) => s + Math.max(0, q.timeSec - q.estimatedSec), 0),
  };

  // Recommendations with measurable metrics, checked again after the next mock.
  const recs: { id: string; text: string; metric: keyof typeof totals; direction: 'down' | 'up'; baseline: number | null }[] = [];
  if (negative < 0 && totals.wrong >= 2)
    recs.push({ id: 'reduce_negative', text: `Negative marking cost ${-negative} marks. Skip MCQs where you cannot eliminate at least two options.`, metric: 'negativeMarks', direction: 'up', baseline: negative });
  if (easyMissed.length)
    recs.push({ id: 'secure_easy', text: `${easyMissed.length} easy question(s) were missed. Do a first pass for easy questions before anything else.`, metric: 'easyMissed', direction: 'down', baseline: easyMissed.length });
  if (hardWaste.length)
    recs.push({ id: 'exit_hard', text: `About ${Math.round(totals.hardTimeWastedSec / 60)} minute(s) went beyond the estimate on difficult questions you did not get. Set an exit time per question.`, metric: 'hardTimeWastedSec', direction: 'down', baseline: totals.hardTimeWastedSec });
  if (totals.selectionQuality !== null && totals.selectionQuality < 70)
    recs.push({ id: 'select_better', text: 'Under a third of your attempts had a positive expected score. Practise strategy drills to choose questions.', metric: 'selectionQuality', direction: 'up', baseline: totals.selectionQuality });
  if (skippedPositive.length >= 2)
    recs.push({ id: 'attempt_more', text: `${skippedPositive.length} skipped question(s) were in topics where your record suggests a good chance. Attempt them on your second pass.`, metric: 'attemptRate', direction: 'up', baseline: totals.attemptRate });

  // Follow-up on the previous attempt's recommendations.
  const prevAnalysis = previous[0] ? await one('SELECT summary FROM mock_analysis WHERE attempt_id = $1', [previous[0].id], c) : null;
  const followUp = (prevAnalysis?.summary?.recommendations ?? []).map((r: any) => {
    const now = totals[r.metric as keyof typeof totals] as number | null;
    const improved = now === null || r.baseline === null ? null : r.direction === 'down' ? now < r.baseline : now > r.baseline;
    return { id: r.id, text: r.text, before: r.baseline, after: now, improved };
  });

  const summary = {
    totals,
    sections,
    topics,
    questions: perQuestion,
    classificationCounts: perQuestion.reduce((m: Record<string, number>, q) => ((m[q.classification] = (m[q.classification] ?? 0) + 1), m), {}),
    strengths: topics.filter((t) => t.attempted >= 1 && t.correct === t.attempted).map((t) => t.topicName),
    weaknesses: topics.filter((t) => t.attempted > t.correct).map((t) => t.topicName),
    recommendations: recs,
    followUp,
    previous: previous.map((p) => ({ attemptId: p.id, rawScore: p.raw_score, submittedAt: p.submitted_at })),
    percentile: null,
    percentileNote: 'No percentile estimate is shown: CAT 100 does not have a calibrated dataset that maps scores to percentiles.',
  };

  await query("UPDATE mock_attempts SET status = 'submitted', submitted_at = now(), submit_reason = $2, raw_score = $3 WHERE id = $1", [attempt.id, reason, total], c);
  await query('INSERT INTO mock_analysis(attempt_id, summary) VALUES ($1,$2) ON CONFLICT (attempt_id) DO UPDATE SET summary = EXCLUDED.summary', [attempt.id, summary], c);

  // Feed answered questions into the learning record.
  const touched = new Set<string>();
  for (const q of perQuestion.filter((x) => x.status !== 'unanswered')) {
    const ins = await one(
      `INSERT INTO question_attempts(user_id, question_id, context, context_id, answer, is_correct, time_taken_sec, timed) VALUES ($1,$2,'mock',$3,$4,$5,$6,true) RETURNING id`,
      [attempt.user_id, q.questionId, attempt.id, q.answer, q.status === 'correct', q.timeSec],
      c,
    );
    if (q.status === 'wrong') {
      await query(
        `INSERT INTO error_logs(user_id, question_id, attempt_id, learner_answer, correct_answer, category, root_cause, remediation_topic_id, next_review_at)
         VALUES ($1,$2,$3,$4,$5,'unclassified','Logged from a test. Classify this mistake during your mock review.',$6, now() + interval '1 day')
         ON CONFLICT (user_id, question_id) WHERE resolved_at IS NULL DO NOTHING`,
        [attempt.user_id, q.questionId, ins!.id, q.answer, q.correctAnswer, q.topicId],
        c,
      );
      await enqueueRevision(attempt.user_id, 'question', q.questionId, q.topicId, 'incorrect', c);
    }
    touched.add(q.topicId);
  }
  for (const t of touched) await recomputeTopicMastery(attempt.user_id, t, c);
}

const provenanceRank = (origin: string) => (origin === 'authentic_pyq' ? 0 : origin === 'ai_generated' ? 2 : 1);

/**
 * Builds a test from the question bank. Timing and marking come from an exam pattern version:
 * the active one, or for a previous-year paper the pattern recorded for that year. The test keeps
 * that version, so activating a newer pattern later does not change how it is scored.
 * Verified PYQs are chosen before other questions when the bank has them.
 */
export async function createTest(
  userId: string,
  spec: {
    kind: 'full' | 'sectional' | 'topic' | 'custom' | 'pyq_paper' | 'error_test' | 'drill';
    title?: string;
    sections?: ('VARC' | 'DILR' | 'QA')[];
    topics?: string[];
    difficulty?: string[];
    origin?: string[];
    year?: number;
    slot?: number;
    questionCount?: number;
    durationMin?: number;
  },
) {
  let cfg: LoadedConfig;
  if (spec.kind === 'pyq_paper') {
    if (!spec.year) throw badRequest('Year is required for a previous-year paper');
    const forYear = await configForYear(spec.year);
    if (!forYear) throw badRequest(`No exam pattern is recorded for CAT ${spec.year}. An admin must add that year's pattern before its paper can be timed and scored.`);
    cfg = forYear;
  } else cfg = await activeConfig();
  const cfgSections: any[] = cfg.sections;
  const sectionOrder = cfgSections.map((s) => s.section_id);
  const sections = spec.kind === 'full' || spec.kind === 'pyq_paper' ? sectionOrder : spec.sections?.length ? sectionOrder.filter((s) => spec.sections!.includes(s)) : sectionOrder;

  const where = ["q.status = 'published'", 'q.section_id = ANY($1)'];
  const params: unknown[] = [sections];
  if (spec.topics?.length) params.push(spec.topics), where.push(`q.topic_id = ANY($${params.length})`);
  if (spec.difficulty?.length) params.push(spec.difficulty), where.push(`q.difficulty = ANY($${params.length})`);
  if (spec.kind === 'pyq_paper') {
    // Published authentic PYQs are verified and approved (enforced by the database).
    params.push(spec.year), where.push(`q.origin = 'authentic_pyq' AND q.exam_year = $${params.length}`);
    if (spec.slot) params.push(spec.slot), where.push(`q.exam_slot = $${params.length}`);
  } else if (spec.origin?.length) params.push(spec.origin), where.push(`q.origin = ANY($${params.length})`);
  if (spec.kind === 'error_test') {
    params.push(userId);
    where.push(`q.id IN (SELECT question_id FROM error_logs WHERE user_id = $${params.length} AND resolved_at IS NULL)`);
  }
  const pool_ = await many(
    `SELECT q.id, q.section_id, q.question_type, q.passage_id, q.dilr_set_id, q.position_in_group, q.estimated_time_sec, q.origin, q.question_number,
            md5(coalesce(q.passage_id, q.dilr_set_id, q.id)::text || $${params.length + 1}) AS shuffle
       FROM questions q
      WHERE ${where.join(' AND ')}
      ORDER BY q.section_id, q.question_number NULLS LAST, q.position_in_group NULLS LAST, q.external_id`,
    [...params, userId + Date.now()],
  );
  if (!pool_.length) throw badRequest(spec.kind === 'pyq_paper' ? 'No verified PYQs exist for that year and slot yet. Import them through the admin console.' : 'No questions match these filters');

  // Pattern tests take the pattern's question count per section; custom tests take the requested count.
  const isPattern = spec.kind === 'full' || spec.kind === 'sectional' || spec.kind === 'pyq_paper';
  const chosen: Record<string, any[]> = {};
  for (const s of sections) {
    const qs = pool_.filter((q) => q.section_id === s);
    const limit = spec.kind === 'pyq_paper' ? null : isPattern ? cfgSections.find((x) => x.section_id === s)?.question_count ?? null : spec.questionCount ?? null;
    if (spec.kind === 'pyq_paper') {
      chosen[s] = qs; // the whole paper, in paper order
      continue;
    }
    // Keep passages and DILR sets whole; verified PYQs first, then a per-test shuffle.
    const groups = new Map<string, any[]>();
    for (const q of qs) {
      const key = q.passage_id ?? q.dilr_set_id ?? q.id;
      groups.set(key, [...(groups.get(key) ?? []), q]);
    }
    const ordered = [...groups.values()].sort((a, b) => provenanceRank(a[0].origin) - provenanceRank(b[0].origin) || (a[0].shuffle < b[0].shuffle ? -1 : 1));
    const out: any[] = [];
    for (const g of ordered) {
      if (limit !== null && out.length >= limit) break;
      out.push(...g);
    }
    chosen[s] = out;
  }
  const title =
    spec.title ??
    {
      full: 'Full test in CAT format',
      sectional: `Sectional test: ${sections.join(', ')}`,
      topic: 'Topic test',
      custom: 'Custom test',
      pyq_paper: `CAT ${spec.year}${spec.slot ? ` slot ${spec.slot}` : ''} paper`,
      error_test: 'Error revision test',
      drill: 'Timed drill',
    }[spec.kind];
  return tx(async (c) => {
    const t = await one(
      'INSERT INTO mock_tests(owner_id, title, kind, exam_config_id, sectional_lock, description) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [userId, title, spec.kind, cfg.id, isPattern && sections.length > 1, isPattern ? `Timing and marking follow ${cfg.label}.` : `Custom timing; marking follows ${cfg.label}.`],
      c,
    );
    let pos = 1;
    for (const s of sections) {
      const qs = chosen[s] ?? [];
      if (!qs.length) continue;
      const cs = cfgSections.find((x) => x.section_id === s)!;
      const durationSec = isPattern ? cs.duration_min * 60 : spec.durationMin ? Math.round((spec.durationMin * 60) / sections.length) : qs.reduce((sum, q) => sum + q.estimated_time_sec, 0);
      const sec = await one('INSERT INTO mock_test_sections(mock_test_id, section_id, position, duration_sec) VALUES ($1,$2,$3,$4) RETURNING id', [t!.id, s, pos++, durationSec], c);
      for (const [i, q] of qs.entries()) {
        const mc = q.question_type === 'MCQ' ? cs.mcq_correct : cs.tita_correct;
        const mw = q.question_type === 'MCQ' ? cs.mcq_wrong : cs.tita_wrong;
        await query('INSERT INTO mock_test_questions(mock_test_section_id, question_id, position, marks_correct, marks_wrong) VALUES ($1,$2,$3,$4,$5)', [sec!.id, q.id, i + 1, mc, mw], c);
      }
    }
    return t!;
  });
}
