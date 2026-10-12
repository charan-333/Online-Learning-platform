import { many, one } from '../db/pool.js';
import { recommendTopics } from './recommend.js';

/**
 * Dashboard metrics, all computed from stored attempts. The four headline metrics
 * are deliberately separate:
 *   syllabusCompletion – share of topics with at least one independent attempt
 *   conceptMastery     – mean topic mastery score (0–100)
 *   testPerformance    – mean score % over the last 5 submitted tests
 *   examReadiness      – share of topics at 'proficient' or 'exam_ready'
 */
export async function overview(userId: string) {
  const [topicStats, attempts, byDifficulty, timing, pyq, revision, errors, mocks, consistency, sections] = await Promise.all([
    one(
      `SELECT count(*) AS topics,
              count(m.topic_id) FILTER (WHERE m.distinct_questions > 0) AS started,
              round(avg(coalesce(m.score, 0)), 1) AS mastery,
              count(*) FILTER (WHERE m.state IN ('proficient', 'exam_ready')) AS ready
         FROM topics t LEFT JOIN user_topic_mastery m ON m.topic_id = t.id AND m.user_id = $1`,
      [userId],
    ),
    one(
      `SELECT count(*) AS total, count(*) FILTER (WHERE is_correct) AS correct,
              count(*) FILTER (WHERE timed) AS timed, count(*) FILTER (WHERE timed AND is_correct) AS timed_correct,
              count(*) FILTER (WHERE NOT timed) AS untimed, count(*) FILTER (WHERE NOT timed AND is_correct) AS untimed_correct
         FROM question_attempts WHERE user_id = $1`,
      [userId],
    ),
    many(
      `SELECT q.difficulty, count(*) AS n, count(*) FILTER (WHERE a.is_correct) AS correct FROM question_attempts a JOIN questions q ON q.id = a.question_id
        WHERE a.user_id = $1 GROUP BY 1 ORDER BY array_position(ARRAY['easy','medium','difficult','advanced'], q.difficulty)`,
      [userId],
    ),
    one(
      `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY time_taken_sec) AS median_sec, round(avg(time_taken_sec)) AS mean_sec
         FROM question_attempts WHERE user_id = $1`,
      [userId],
    ),
    one(
      `SELECT count(*) FILTER (WHERE origin = 'authentic_pyq') AS pyq_total,
              count(*) FILTER (WHERE origin = 'authentic_pyq' AND source_verification = 'verified') AS pyq_verified,
              count(*) FILTER (WHERE origin = 'authentic_pyq' AND EXISTS (SELECT 1 FROM question_attempts a WHERE a.user_id = $1 AND a.question_id = q.id)) AS pyq_done,
              count(*) AS all_total,
              count(*) FILTER (WHERE EXISTS (SELECT 1 FROM question_attempts a WHERE a.user_id = $1 AND a.question_id = q.id)) AS all_done
         FROM questions q WHERE status = 'published'`,
      [userId],
    ),
    one(`SELECT count(*) FILTER (WHERE due_at <= now()) AS due, count(*) AS active FROM revision_items WHERE user_id = $1 AND NOT retired`, [userId]),
    one(
      `SELECT count(*) FILTER (WHERE resolved_at IS NULL) AS open, count(*) FILTER (WHERE resolved_at IS NOT NULL) AS resolved,
              count(*) FILTER (WHERE review_count > 0 AND last_review_correct = false) AS recurred
         FROM error_logs WHERE user_id = $1`,
      [userId],
    ),
    many(
      `SELECT a.id, a.submitted_at, a.raw_score, t.title, t.kind, (ma.summary->'totals'->>'maxScore')::numeric AS max_score
         FROM mock_attempts a JOIN mock_tests t ON t.id = a.mock_test_id JOIN mock_analysis ma ON ma.attempt_id = a.id
        WHERE a.user_id = $1 AND a.status = 'submitted' ORDER BY a.submitted_at`,
      [userId],
    ),
    one(
      `SELECT count(DISTINCT created_at::date) FILTER (WHERE created_at > now() - interval '28 days') AS active_days_28,
              count(DISTINCT created_at::date) FILTER (WHERE created_at > now() - interval '7 days') AS active_days_7
         FROM question_attempts WHERE user_id = $1`,
      [userId],
    ),
    many(
      `SELECT s.id AS section_id, s.name, round(avg(coalesce(m.score, 0)), 1) AS mastery,
              count(*) FILTER (WHERE m.state IN ('proficient','exam_ready')) AS ready, count(*) AS topics,
              (SELECT count(*) FROM question_attempts a JOIN questions q ON q.id = a.question_id WHERE a.user_id = $1 AND q.section_id = s.id) AS attempts,
              (SELECT count(*) FROM question_attempts a JOIN questions q ON q.id = a.question_id WHERE a.user_id = $1 AND q.section_id = s.id AND a.is_correct) AS correct
         FROM sections s JOIN topics t ON t.section_id = s.id LEFT JOIN user_topic_mastery m ON m.topic_id = t.id AND m.user_id = $1
        GROUP BY s.id ORDER BY s.position`,
      [userId],
    ),
  ]);
  const recent = mocks.slice(-5).filter((m) => m.max_score > 0);
  const risk = await many(
    `SELECT t.id, t.name, t.section_id, m.state, m.score, m.state_reason FROM user_topic_mastery m JOIN topics t ON t.id = m.topic_id
      WHERE m.user_id = $1 AND m.state IN ('weak', 'revision_due') ORDER BY m.state = 'weak' DESC, m.score LIMIT 8`,
    [userId],
  );
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null);
  return {
    headline: {
      syllabusCompletion: pct(topicStats!.started, topicStats!.topics),
      conceptMastery: Number(topicStats!.mastery),
      testPerformance: recent.length ? Math.round(recent.reduce((s, m) => s + (Number(m.raw_score) / Number(m.max_score)) * 100, 0) / recent.length) : null,
      examReadiness: pct(topicStats!.ready, topicStats!.topics),
    },
    attempts: {
      total: attempts!.total,
      accuracy: pct(attempts!.correct, attempts!.total),
      timedAccuracy: pct(attempts!.timed_correct, attempts!.timed),
      untimedAccuracy: pct(attempts!.untimed_correct, attempts!.untimed),
      timedCount: attempts!.timed,
      untimedCount: attempts!.untimed,
    },
    byDifficulty: byDifficulty.map((d) => ({ ...d, accuracy: pct(d.correct, d.n) })),
    timing: { medianSec: timing?.median_sec ? Math.round(timing.median_sec) : null, meanSec: timing?.mean_sec ?? null },
    questionBank: pyq,
    revision,
    errors,
    mockTrend: mocks.map((m) => ({ ...m, percent: m.max_score ? Math.round((Number(m.raw_score) / Number(m.max_score)) * 100) : null })),
    consistency,
    sections: sections.map((s) => ({ ...s, accuracy: pct(s.correct, s.attempts) })),
    riskAreas: risk,
    nextActions: await recommendTopics(userId, 3),
  };
}

export async function topicAnalytics(userId: string) {
  return many(
    `SELECT t.id, t.name, t.section_id, t.area, coalesce(m.score, 0) AS mastery, coalesce(m.state, 'not_started') AS state, m.state_reason,
            count(a.id) AS attempts, count(a.id) FILTER (WHERE a.is_correct) AS correct,
            round(avg(a.time_taken_sec)) AS avg_time, round(avg(q.estimated_time_sec)) AS avg_estimate,
            count(a.id) FILTER (WHERE a.timed) AS timed, count(a.id) FILTER (WHERE a.timed AND a.is_correct) AS timed_correct
       FROM topics t
       LEFT JOIN user_topic_mastery m ON m.topic_id = t.id AND m.user_id = $1
       LEFT JOIN questions q ON q.topic_id = t.id
       LEFT JOIN question_attempts a ON a.question_id = q.id AND a.user_id = $1
      GROUP BY t.id, m.score, m.state, m.state_reason ORDER BY t.section_id, t.position`,
    [userId],
  );
}
