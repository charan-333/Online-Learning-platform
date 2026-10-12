import { one, query, tx } from '../db/pool.js';
import { ERROR_GUIDE, type ErrorCategory } from '../domain/errors.js';
import { isCorrect } from '../domain/scoring.js';
import { notFound } from '../lib/errors.js';
import { recomputeTopicMastery } from './mastery.js';
import { enqueueRevision } from './revision.js';

export interface AttemptInput {
  answer: string | null;
  timeTakenSec: number;
  confidence?: 1 | 2 | 3;
  guessed?: boolean;
  timed?: boolean;
  hintsUsed?: number;
  mistakeType?: ErrorCategory;
  context?: 'practice' | 'lesson' | 'diagnostic' | 'revision' | 'drill' | 'error_test' | 'mock';
  contextId?: string;
}

/**
 * Records one attempt and applies its consequences atomically:
 * mastery recomputation, revision queueing, and error-log creation/resolution.
 */
export async function recordAttempt(userId: string, questionId: string, input: AttemptInput) {
  const q = await one("SELECT id, topic_id, question_type, correct_answer, answer_tolerance, status FROM questions WHERE id = $1 AND status = 'published'", [questionId]);
  if (!q) throw notFound('Question');
  const correct = isCorrect(q, input.answer);
  return tx(async (c) => {
    const revealed = await one('SELECT 1 FROM solution_reveals WHERE user_id = $1 AND question_id = $2', [userId, questionId], c);
    const attempt = await one(
      `INSERT INTO question_attempts(user_id, question_id, context, context_id, answer, is_correct, time_taken_sec, timed, confidence, guessed, mistake_type, hints_used, solution_seen_first)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [userId, questionId, input.context ?? 'practice', input.contextId ?? null, input.answer, correct, Math.round(input.timeTakenSec), !!input.timed,
       input.confidence ?? null, !!input.guessed, correct ? null : input.mistakeType ?? null, input.hintsUsed ?? 0, !!revealed],
      c,
    );

    let errorLogId: string | null = null;
    if (!correct) {
      const category = input.mistakeType ?? 'unclassified';
      const guide = ERROR_GUIDE[category];
      const sol = await one('SELECT exam_method_md, common_mistakes_md FROM question_solutions WHERE question_id = $1', [questionId], c);
      const existing = await one('SELECT id FROM error_logs WHERE user_id = $1 AND question_id = $2 AND resolved_at IS NULL', [userId, questionId], c);
      if (existing) {
        await query(
          `UPDATE error_logs SET attempt_id = $2, learner_answer = $3, category = CASE WHEN $4 = 'unclassified' THEN category ELSE $4 END,
             next_review_at = now() + interval '1 day', last_review_correct = false, review_count = review_count + 1, updated_at = now() WHERE id = $1`,
          [existing.id, attempt!.id, input.answer, category],
          c,
        );
        errorLogId = existing.id;
      } else {
        const e = await one(
          `INSERT INTO error_logs(user_id, question_id, attempt_id, learner_answer, correct_answer, category, root_cause, correct_approach, remediation_topic_id, next_review_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now() + interval '1 day') RETURNING id`,
          [userId, questionId, attempt!.id, input.answer, q.correct_answer, category, guide.misconception, sol?.exam_method_md || sol?.common_mistakes_md || '', q.topic_id],
          c,
        );
        errorLogId = e!.id;
      }
      await enqueueRevision(userId, 'question', questionId, q.topic_id, 'incorrect', c);
    } else {
      // A correct, unguessed attempt after an error counts as one successful re-test.
      const open = await one('SELECT id, review_count FROM error_logs WHERE user_id = $1 AND question_id = $2 AND resolved_at IS NULL', [userId, questionId], c);
      if (open && !input.guessed && !revealed) {
        // Resolve only when the fix transfers: a correct answer to a DIFFERENT question
        // in the same topic after the error was logged, plus this correct re-test.
        const transfer = await one(
          `SELECT 1 FROM question_attempts a JOIN questions q2 ON q2.id = a.question_id
            WHERE a.user_id = $1 AND q2.topic_id = $2 AND a.question_id <> $3 AND a.is_correct AND NOT a.guessed
              AND a.created_at > (SELECT created_at FROM error_logs WHERE id = $4) LIMIT 1`,
          [userId, q.topic_id, questionId, open.id],
          c,
        );
        await query(
          `UPDATE error_logs SET last_review_correct = true, review_count = review_count + 1, updated_at = now(),
             next_review_at = now() + interval '4 days', resolved_at = CASE WHEN $2 THEN now() ELSE NULL END WHERE id = $1`,
          [open.id, !!transfer],
          c,
        );
        errorLogId = open.id;
      }
      if (input.guessed) await enqueueRevision(userId, 'question', questionId, q.topic_id, 'guessed', c);
      else if (input.confidence === 1) await enqueueRevision(userId, 'question', questionId, q.topic_id, 'low_confidence', c);
    }
    const mastery = await recomputeTopicMastery(userId, q.topic_id, c);
    return { attempt: attempt!, correct, correctAnswer: q.correct_answer, errorLogId, mastery };
  });
}
