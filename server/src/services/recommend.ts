import { many, one } from '../db/pool.js';

/**
 * Explainable next-topic recommendation. Every point added to a topic's priority
 * comes with a human-readable reason. Rules (see docs/MASTERY.md):
 *
 *  - Prerequisite gate: a topic whose prerequisites are not yet at least
 *    'practicing' with score >= PREREQ_MIN_SCORE is blocked and its weakest
 *    prerequisite is recommended in its place.
 *  - weak: +50; revision_due: +35; learning: +30; practicing: +25 − score/10;
 *    not_started (unblocked): +20, plus a small bonus for earlier syllabus order;
 *    proficient: +5; exam_ready: +0.
 *  - Open errors in the topic: +8 each (max +24).
 *  - Section balance: the section with the least practice in the last 7 days gets +12.
 *  - Diagnostic: sections scoring below 50% in the diagnostic get +10.
 *  - Content availability: topics with no published questions get −40 (cannot practise).
 *
 * Easiness or past success never raise priority.
 */
export const RECOMMEND_CONFIG = { PREREQ_MIN_SCORE: 40 };

export interface Recommendation {
  topicId: string;
  topicName: string;
  sectionId: string;
  priority: number;
  state: string;
  score: number;
  reasons: string[];
  replaces?: { topicId: string; topicName: string };
}

export async function recommendTopics(userId: string, limit = 5): Promise<Recommendation[]> {
  const topics = await many(
    `SELECT t.id, t.name, t.section_id, t.position, coalesce(m.state, 'not_started') AS state, coalesce(m.score, 0) AS score,
            (SELECT count(*) FROM questions q WHERE q.topic_id = t.id AND q.status = 'published') AS qcount,
            (SELECT count(*) FROM error_logs e JOIN questions q ON q.id = e.question_id WHERE e.user_id = $1 AND q.topic_id = t.id AND e.resolved_at IS NULL) AS open_errors
       FROM topics t LEFT JOIN user_topic_mastery m ON m.topic_id = t.id AND m.user_id = $1`,
    [userId],
  );
  const prereqs = await many('SELECT topic_id, prerequisite_id FROM topic_prerequisites');
  const byId = new Map(topics.map((t) => [t.id, t]));
  const recentBySection = await many(
    `SELECT q.section_id, count(*) AS n FROM question_attempts a JOIN questions q ON q.id = a.question_id
      WHERE a.user_id = $1 AND a.created_at > now() - interval '7 days' GROUP BY 1`,
    [userId],
  );
  const sectionCounts: Record<string, number> = { VARC: 0, DILR: 0, QA: 0 };
  for (const r of recentBySection) sectionCounts[r.section_id] = r.n;
  const leastSection = Object.entries(sectionCounts).sort((a, b) => a[1] - b[1])[0][0];
  const diag = await many(
    `SELECT q.section_id, avg(CASE WHEN a.is_correct THEN 1 ELSE 0 END) AS acc FROM question_attempts a JOIN questions q ON q.id = a.question_id
      WHERE a.user_id = $1 AND a.context = 'diagnostic' GROUP BY 1`,
    [userId],
  );
  const weakDiagSections = new Set(diag.filter((d) => d.acc < 0.5).map((d) => d.section_id));

  const unmetPrereqs = (id: string) =>
    prereqs
      .filter((p) => p.topic_id === id)
      .map((p) => byId.get(p.prerequisite_id))
      .filter((p) => p && (p.score < RECOMMEND_CONFIG.PREREQ_MIN_SCORE || ['not_started', 'learning', 'weak'].includes(p.state)));

  const scored: Recommendation[] = [];
  for (const t of topics) {
    const reasons: string[] = [];
    let p = 0;
    switch (t.state) {
      case 'weak':
        p += 50;
        reasons.push('Marked weak: recent accuracy is low or the same mistake repeats.');
        break;
      case 'revision_due':
        p += 35;
        reasons.push('Was proficient but has not been practised recently.');
        break;
      case 'learning':
        p += 30;
        reasons.push('Started but not enough different questions attempted yet.');
        break;
      case 'practicing':
        p += 25 - t.score / 10;
        reasons.push(`Practising; mastery score ${t.score} is below proficiency.`);
        break;
      case 'not_started':
        p += 20 + Math.max(0, 6 - t.position * 0.2);
        reasons.push('Not started yet.');
        break;
      case 'proficient':
        p += 5;
        reasons.push('Proficient; occasional mixed practice keeps it fresh.');
        break;
    }
    if (t.open_errors > 0) {
      p += Math.min(24, 8 * t.open_errors);
      reasons.push(`${t.open_errors} unresolved mistake(s) in the error log.`);
    }
    if (t.section_id === leastSection) {
      p += 12;
      reasons.push(`${t.section_id} has had the least practice in the last 7 days.`);
    }
    if (weakDiagSections.has(t.section_id)) {
      p += 10;
      reasons.push(`Diagnostic accuracy in ${t.section_id} was below 50%.`);
    }
    if (t.qcount === 0) {
      p -= 40;
      reasons.push('No practice questions are published for this topic yet.');
    }
    scored.push({ topicId: t.id, topicName: t.name, sectionId: t.section_id, priority: Math.round(p * 10) / 10, state: t.state, score: t.score, reasons });
  }

  scored.sort((a, b) => b.priority - a.priority);
  const out: Recommendation[] = [];
  const used = new Set<string>();
  for (const r of scored) {
    if (out.length >= limit) break;
    const blockers = unmetPrereqs(r.topicId);
    if (blockers.length && r.state !== 'proficient' && r.state !== 'exam_ready') {
      // Recommend the weakest prerequisite with practice content instead.
      const sub = blockers.sort((a: any, b: any) => a.score - b.score).find((b: any) => b.qcount > 0 && !used.has(b.id)) as any;
      if (sub) {
        used.add(sub.id);
        out.push({
          topicId: sub.id,
          topicName: sub.name,
          sectionId: sub.section_id,
          priority: r.priority,
          state: sub.state,
          score: sub.score,
          reasons: [`Prerequisite for ${r.topicName}, which needs it first.`, ...r.reasons.filter((x) => !x.startsWith('Not started'))],
          replaces: { topicId: r.topicId, topicName: r.topicName },
        });
      }
      continue;
    }
    if (used.has(r.topicId)) continue;
    used.add(r.topicId);
    out.push(r);
  }
  return out;
}

/** Chooses practice questions for a topic: prefer unattempted, then previously wrong; level matched to mastery; authentic PYQs first. */
export async function pickQuestions(userId: string, topicId: string, budgetSec: number, exclude: string[] = []) {
  const m = await one('SELECT score FROM user_topic_mastery WHERE user_id = $1 AND topic_id = $2', [userId, topicId]);
  const score = m?.score ?? 0;
  const target = score < 40 ? ['easy', 'medium'] : score < 70 ? ['medium', 'difficult'] : ['difficult', 'advanced', 'medium'];
  const rows = await many(
    `SELECT q.id, q.estimated_time_sec, q.difficulty, q.origin, q.passage_id, q.dilr_set_id,
            (SELECT count(*) FROM question_attempts a WHERE a.user_id = $1 AND a.question_id = q.id) AS attempts,
            (SELECT bool_or(NOT a.is_correct) FROM question_attempts a WHERE a.user_id = $1 AND a.question_id = q.id) AS ever_wrong
       FROM questions q WHERE q.topic_id = $2 AND q.status = 'published' AND NOT (q.id = ANY($3::uuid[]))`,
    [userId, topicId, exclude],
  );
  const rank = (r: any) =>
    (r.attempts === 0 ? 0 : r.ever_wrong ? 1 : 3) * 10 + (target.includes(r.difficulty) ? 0 : 2) + (r.origin === 'authentic_pyq' ? 0 : 1);
  rows.sort((a, b) => rank(a) - rank(b));
  const picked: string[] = [];
  let used = 0;
  for (const r of rows) {
    if (used + r.estimated_time_sec > budgetSec && picked.length > 0) continue;
    picked.push(r.id);
    used += r.estimated_time_sec;
    if (used >= budgetSec) break;
  }
  return picked;
}
