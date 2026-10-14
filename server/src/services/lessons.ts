import { many, one, query } from '../db/pool.js';
import { PROVENANCE_SQL } from '../domain/provenance.js';
import { notFound } from '../lib/errors.js';
import { pickQuestions, recommendTopics } from './recommend.js';
import { dueQueue, fitToBudget } from './revision.js';

export type BlockType = 'revision' | 'concept' | 'worked_example' | 'practice' | 'timed_challenge' | 'review';
export interface LessonBlock {
  key: string;
  type: BlockType;
  title: string;
  minutes: number;
  questionIds?: string[];
  revisionItemIds?: string[];
  note?: string;
}

/** Minute splits by session length and section. Revision never exceeds ~35% of a session. */
export function lessonTemplate(minutes: number, section: string): { type: BlockType; minutes: number }[] {
  if (minutes <= 20) {
    return [
      { type: 'revision', minutes: 5 },
      { type: 'practice', minutes: 12 },
      { type: 'review', minutes: 3 },
    ];
  }
  if (minutes <= 30) {
    return [
      { type: 'revision', minutes: 5 },
      { type: 'concept', minutes: 7 },
      { type: 'practice', minutes: 13 },
      { type: 'review', minutes: 5 },
    ];
  }
  const scale = minutes / 60;
  const r = (m: number) => Math.max(3, Math.round(m * scale));
  if (section === 'VARC' || section === 'DILR') {
    // Passage/set work needs longer uninterrupted blocks.
    const base: { type: BlockType; minutes: number }[] = [
      { type: 'revision' as const, minutes: r(8) },
      { type: 'concept' as const, minutes: r(8) },
      { type: 'worked_example' as const, minutes: r(6) },
      { type: 'practice' as const, minutes: r(28) },
      { type: 'review' as const, minutes: r(10) },
    ];
    if (minutes > 60) base.splice(4, 0, { type: 'timed_challenge', minutes: r(12) });
    return base;
  }
  const base: { type: BlockType; minutes: number }[] = [
    { type: 'revision' as const, minutes: r(10) },
    { type: 'concept' as const, minutes: r(10) },
    { type: 'worked_example' as const, minutes: r(5) },
    { type: 'practice' as const, minutes: r(25) },
    { type: 'review' as const, minutes: r(10) },
  ];
  if (minutes > 60) base.splice(4, 0, { type: 'timed_challenge', minutes: r(12) });
  return base;
}

const TITLES: Record<BlockType, string> = {
  revision: 'Spaced revision',
  concept: 'Concept and strategy',
  worked_example: 'Worked example',
  practice: 'Practice',
  timed_challenge: 'Timed challenge',
  review: 'Solution analysis and error logging',
};

async function expandToGroups(ids: string[]) {
  if (!ids.length) return ids;
  const rows = await many(
    `SELECT DISTINCT q2.id, q2.passage_id, q2.dilr_set_id, q2.position_in_group FROM questions q
       JOIN questions q2 ON (q.passage_id IS NOT NULL AND q2.passage_id = q.passage_id) OR (q.dilr_set_id IS NOT NULL AND q2.dilr_set_id = q.dilr_set_id) OR q2.id = q.id
      WHERE q.id = ANY($1::uuid[]) AND q2.status = 'published'
      ORDER BY q2.passage_id NULLS LAST, q2.dilr_set_id NULLS LAST, q2.position_in_group NULLS LAST`,
    [ids],
  );
  return rows.map((r) => r.id as string);
}

export async function getOrCreateDailyLesson(userId: string, minutes: number, date: string, topicOverride?: string) {
  const existing = await one('SELECT * FROM lessons WHERE user_id = $1 AND lesson_date = $2 AND minutes = $3', [userId, date, minutes]);
  if (existing) return existing;

  let topicId = topicOverride;
  let rationale = '';
  if (!topicId) {
    const recs = await recommendTopics(userId, 1);
    if (!recs.length) throw notFound('Topic with practice content');
    topicId = recs[0].topicId;
    rationale = recs[0].reasons.join(' ');
  } else {
    rationale = 'Topic chosen by you.';
  }
  const topic = await one('SELECT id, section_id, name, concept_md FROM topics WHERE id = $1', [topicId]);
  if (!topic) throw notFound('Topic');

  const blocks: LessonBlock[] = [];
  const used: string[] = [];
  for (const [i, t] of lessonTemplate(minutes, topic.section_id).entries()) {
    const block: LessonBlock = { key: `${i}-${t.type}`, type: t.type, title: TITLES[t.type], minutes: t.minutes };
    if (t.type === 'revision') {
      const q = await dueQueue(userId, 50);
      const items = fitToBudget(q.items, t.minutes * 60);
      block.revisionItemIds = items.map((x) => x.id);
      if (!items.length) block.note = 'Nothing is due for revision today. Use this time on the concept.';
    } else if (t.type === 'concept') {
      block.note = topic.concept_md ? undefined : 'Concept notes for this topic are an outline only.';
    } else if (t.type === 'worked_example') {
      const ex = await one(
        // Showing a worked solution uses the question up, so verified PYQs are kept for practice when other questions exist.
        `SELECT q.id FROM questions q WHERE q.topic_id = $2 AND q.status = 'published' AND q.passage_id IS NULL AND q.dilr_set_id IS NULL
          ORDER BY (q.origin = 'authentic_pyq'),
                   (SELECT count(*) FROM question_attempts a WHERE a.user_id = $1 AND a.question_id = q.id) DESC,
                   array_position(ARRAY['easy','medium','difficult','advanced'], q.difficulty) LIMIT 1`,
        [userId, topic.id],
      );
      if (ex) {
        block.questionIds = [ex.id];
        used.push(ex.id);
        // Showing a worked solution counts as a reveal for mastery purposes.
        await query('INSERT INTO solution_reveals(user_id, question_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [userId, ex.id]);
      } else block.note = 'No standalone example available for this topic.';
    } else if (t.type === 'practice' || t.type === 'timed_challenge') {
      let ids = await pickQuestions(userId, topic.id, t.minutes * 60, used);
      if (topic.section_id !== 'QA') ids = (await expandToGroups(ids)).filter((id) => !used.includes(id));
      block.questionIds = ids;
      used.push(...ids);
      if (!ids.length) block.note = 'No further published questions for this topic. Import more questions or pick another topic.';
    }
    blocks.push(block);
  }
  const plan = { topic: { id: topic.id, name: topic.name, sectionId: topic.section_id }, blocks, objective: `Build accuracy and method in ${topic.name}.` };
  return one(
    `INSERT INTO lessons(user_id, lesson_date, topic_id, minutes, rationale, plan) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (user_id, lesson_date, minutes) DO UPDATE SET minutes = EXCLUDED.minutes RETURNING *`,
    [userId, date, topic.id, minutes, rationale, plan],
  );
}

export async function lessonDetail(userId: string, lessonId: string) {
  const lesson = await one('SELECT * FROM lessons WHERE id = $1 AND user_id = $2', [lessonId, userId]);
  if (!lesson) return null;
  const progress = await many('SELECT block_key, completed_at FROM lesson_progress WHERE lesson_id = $1', [lessonId]);
  const qids: string[] = lesson.plan.blocks.flatMap((b: LessonBlock) => b.questionIds ?? []);
  const attempts = await many(
    `SELECT DISTINCT ON (question_id) question_id, is_correct, time_taken_sec FROM question_attempts
      WHERE user_id = $1 AND context = 'lesson' AND context_id = $2 ORDER BY question_id, created_at DESC`,
    [userId, lessonId],
  );
  const topic = await one('SELECT id, name, section_id, concept_md, traps_md, revision_md FROM topics WHERE id = $1', [lesson.topic_id]);
  const prereqs = await many('SELECT t.id, t.name FROM topic_prerequisites p JOIN topics t ON t.id = p.prerequisite_id WHERE p.topic_id = $1', [lesson.topic_id]);
  const formulas = await many('SELECT id, title, formula_tex, explanation_md FROM formula_cards WHERE topic_id = $1 ORDER BY high_value DESC', [lesson.topic_id]);
  const questions = qids.length
    ? await many(
        `SELECT q.id, q.external_id, q.question_type, q.difficulty, q.estimated_time_sec, q.origin, q.exam_year, q.exam_slot, ${PROVENANCE_SQL} AS provenance,
                left(q.stem_md, 160) AS stem_preview FROM questions q WHERE q.id = ANY($1::uuid[])`,
        [qids],
      )
    : [];
  return { ...lesson, progress, attempts, topic, prerequisites: prereqs, formulas, questions };
}

/** Completion criteria: every practice/timed question attempted in this lesson, and every block marked done. */
export async function completeBlock(userId: string, lessonId: string, blockKey: string) {
  const lesson = await one('SELECT * FROM lessons WHERE id = $1 AND user_id = $2', [lessonId, userId]);
  if (!lesson) throw notFound('Lesson');
  const block = (lesson.plan.blocks as LessonBlock[]).find((b) => b.key === blockKey);
  if (!block) throw notFound('Lesson block');
  if (block.type === 'practice' || block.type === 'timed_challenge') {
    const ids = block.questionIds ?? [];
    if (ids.length) {
      const done = await one(
        "SELECT count(DISTINCT question_id) AS n FROM question_attempts WHERE user_id = $1 AND context = 'lesson' AND context_id = $2 AND question_id = ANY($3::uuid[])",
        [userId, lessonId, ids],
      );
      if (done!.n < ids.length) return { completed: false, blockDone: false, message: `Answer all ${ids.length} questions first (${done!.n} done).` };
    }
  }
  await query('INSERT INTO lesson_progress(lesson_id, block_key) VALUES ($1,$2) ON CONFLICT DO NOTHING', [lessonId, blockKey]);
  const doneKeys = new Set((await many('SELECT block_key FROM lesson_progress WHERE lesson_id = $1', [lessonId])).map((r) => r.block_key));
  const allDone = (lesson.plan.blocks as LessonBlock[]).every((b) => doneKeys.has(b.key));
  if (allDone && lesson.status !== 'completed') {
    const report = await buildLessonReport(userId, lesson);
    await query("UPDATE lessons SET status = 'completed', completed_at = now(), report = $2 WHERE id = $1", [lessonId, report]);
    await query(
      "UPDATE study_plan_tasks SET status = 'done', completed_at = now() WHERE user_id = $1 AND scheduled_date = $2 AND topic_id = $3 AND status = 'pending' AND task_type IN ('learn', 'practice')",
      [userId, lesson.lesson_date, lesson.topic_id],
    );
    return { completed: true, blockDone: true, report };
  }
  return { completed: lesson.status === 'completed', blockDone: true };
}

async function buildLessonReport(userId: string, lesson: any) {
  const attempts = await many(
    `SELECT a.is_correct, a.time_taken_sec, a.mistake_type, a.guessed, q.estimated_time_sec, q.topic_id, t.name AS topic_name
       FROM question_attempts a JOIN questions q ON q.id = a.question_id JOIN topics t ON t.id = q.topic_id
      WHERE a.user_id = $1 AND a.context = 'lesson' AND a.context_id = $2`,
    [userId, lesson.id],
  );
  const n = attempts.length;
  const correct = attempts.filter((a) => a.is_correct).length;
  const time = attempts.reduce((s, a) => s + a.time_taken_sec, 0);
  const est = attempts.reduce((s, a) => s + a.estimated_time_sec, 0);
  const mistakes: Record<string, number> = {};
  for (const a of attempts) if (!a.is_correct) mistakes[a.mistake_type ?? 'unclassified'] = (mistakes[a.mistake_type ?? 'unclassified'] ?? 0) + 1;
  const needRevision = [...new Set(attempts.filter((a) => !a.is_correct || a.guessed).map((a) => a.topic_name))];
  const next = (await recommendTopics(userId, 1))[0];
  const m = await one('SELECT score, state FROM user_topic_mastery WHERE user_id = $1 AND topic_id = $2', [userId, lesson.topic_id]);
  return {
    learned: `${lesson.plan.topic.name}: ${lesson.plan.objective}`,
    questions: n,
    correct,
    accuracy: n ? Math.round((correct / n) * 100) : null,
    timeEfficiency: est ? Math.round((est / Math.max(1, time)) * 100) : null,
    timeSpentSec: time,
    mistakes,
    conceptsNeedingRevision: needRevision,
    masteryAfter: m,
    nextAction: next ? { topicId: next.topicId, topicName: next.topicName, why: next.reasons[0] } : null,
  };
}
