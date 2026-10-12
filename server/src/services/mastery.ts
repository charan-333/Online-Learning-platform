import { many, pool, query, type Db } from '../db/pool.js';
import { computeMastery, type MasteryResult } from '../domain/mastery.js';

/** Recomputes and stores mastery for one learner and topic from stored attempts. */
export async function recomputeTopicMastery(userId: string, topicId: string, db: Db = pool): Promise<MasteryResult> {
  const rows = await many(
    `SELECT a.question_id, a.is_correct, a.time_taken_sec, q.estimated_time_sec, q.difficulty, a.confidence, a.guessed,
            a.solution_seen_first, a.timed, a.mistake_type, a.created_at
       FROM question_attempts a JOIN questions q ON q.id = a.question_id
      WHERE a.user_id = $1 AND q.topic_id = $2
      ORDER BY a.created_at DESC LIMIT 200`,
    [userId, topicId],
    db,
  );
  const result = computeMastery(rows);
  await query(
    `INSERT INTO user_topic_mastery(user_id, topic_id, score, state, mode, attempts_count, correct_count, distinct_questions, last_practiced_at, state_reason, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
     ON CONFLICT (user_id, topic_id) DO UPDATE SET score=EXCLUDED.score, state=EXCLUDED.state, mode=EXCLUDED.mode, attempts_count=EXCLUDED.attempts_count,
       correct_count=EXCLUDED.correct_count, distinct_questions=EXCLUDED.distinct_questions, last_practiced_at=EXCLUDED.last_practiced_at,
       state_reason=EXCLUDED.state_reason, updated_at=now()`,
    [userId, topicId, result.score, result.state, result.mode, result.attempts, result.correct, result.distinct, rows[0]?.created_at ?? null, result.reason],
    db,
  );
  return result;
}

/** Refreshes time-dependent states (revision_due) for all of a learner's topics. */
export async function refreshAllMastery(userId: string, db: Db = pool) {
  const topics = await many('SELECT topic_id FROM user_topic_mastery WHERE user_id = $1', [userId], db);
  for (const t of topics) await recomputeTopicMastery(userId, t.topic_id, db);
}
