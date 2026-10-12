import { many, one, pool, query, type Db } from '../db/pool.js';
import { PROVENANCE_SQL } from '../domain/provenance.js';
import { initialDelayDays, nextReview, SRS_CONFIG } from '../domain/srs.js';

export type QueueReason = 'incorrect' | 'low_confidence' | 'guessed' | 'first_exposure' | 'high_value_formula';

export async function daysUntilExam(userId: string, db: Db = pool): Promise<number | null> {
  const p = await one('SELECT exam_date FROM user_profiles WHERE user_id = $1', [userId], db);
  if (!p?.exam_date) return null;
  return Math.ceil((new Date(p.exam_date + 'T00:00:00Z').getTime() - Date.now()) / 86400_000);
}

/** Adds an item to the revision queue, or pulls an existing one forward. Never duplicates. */
export async function enqueueRevision(
  userId: string,
  itemType: 'question' | 'formula' | 'error' | 'topic',
  refId: string,
  topicId: string | null,
  reason: QueueReason,
  db: Db = pool,
) {
  const delay = initialDelayDays(reason);
  await query(
    `INSERT INTO revision_items(user_id, item_type, ref_id, topic_id, reason, interval_days, due_at)
     VALUES ($1,$2,$3,$4,$5,$6, now() + make_interval(secs => $6::numeric * 86400))
     ON CONFLICT (user_id, item_type, ref_id) DO UPDATE
       SET due_at = LEAST(revision_items.due_at, EXCLUDED.due_at), reason = EXCLUDED.reason, retired = false`,
    [userId, itemType, refId, topicId, reason, delay],
    db,
  );
}

export async function reviewItem(userId: string, itemId: string, grade: 0 | 1 | 2 | 3) {
  const item = await one('SELECT * FROM revision_items WHERE id = $1 AND user_id = $2', [itemId, userId]);
  if (!item) return null;
  const next = nextReview(item, grade, await daysUntilExam(userId));
  // Items recalled easily at long intervals are retired from the active queue.
  const retire = grade >= 2 && next.interval_days >= 60;
  await query(
    `UPDATE revision_items SET interval_days=$3, ease=$4, reps=$5, lapses=$6, due_at = now() + make_interval(secs => $3::numeric * 86400), last_reviewed_at = now(), retired = $7
      WHERE id = $1 AND user_id = $2`,
    [itemId, userId, next.interval_days, next.ease, next.reps, next.lapses, retire],
  );
  await query('INSERT INTO revision_reviews(revision_item_id, user_id, grade, interval_before, interval_after) VALUES ($1,$2,$3,$4,$5)', [itemId, userId, grade, item.interval_days, next.interval_days]);
  return { ...next, retired: retire };
}

/** Due queue with estimated time. Each entry carries what the UI needs to review it. */
export async function dueQueue(userId: string, limit = 50) {
  const rows = await many(
    `SELECT r.*, t.name AS topic_name,
            q.stem_md, q.estimated_time_sec, q.question_type, q.external_id, q.exam_year, q.exam_slot,
            CASE WHEN q.id IS NULL THEN NULL ELSE ${PROVENANCE_SQL} END AS provenance,
            f.title AS formula_title, f.formula_tex, f.explanation_md AS formula_explanation
       FROM revision_items r
       LEFT JOIN topics t ON t.id = r.topic_id
       LEFT JOIN questions q ON r.item_type IN ('question', 'error') AND q.id::text = r.ref_id
       LEFT JOIN formula_cards f ON r.item_type = 'formula' AND f.id::text = r.ref_id
      WHERE r.user_id = $1 AND NOT r.retired AND r.due_at <= now() + interval '1 hour'
      ORDER BY r.due_at ASC LIMIT $2`,
    [userId, limit],
  );
  const items = rows.map((r) => ({
    id: r.id,
    itemType: r.item_type,
    refId: r.ref_id,
    topicId: r.topic_id,
    topicName: r.topic_name,
    reason: r.reason,
    dueAt: r.due_at,
    intervalDays: r.interval_days,
    reps: r.reps,
    lapses: r.lapses,
    estimatedSec: r.item_type === 'formula' ? 30 : r.item_type === 'topic' ? 300 : Math.round((r.estimated_time_sec ?? 90) * (r.item_type === 'error' ? 1.5 : 1)),
    question: r.stem_md
      ? { id: r.ref_id, stem: r.stem_md, type: r.question_type, externalId: r.external_id, provenance: r.provenance, examYear: r.exam_year, examSlot: r.exam_slot }
      : null,
    formula: r.formula_title ? { title: r.formula_title, tex: r.formula_tex, explanation: r.formula_explanation } : null,
  }));
  const totalSec = items.reduce((s, i) => s + i.estimatedSec, 0);
  return { items, totalSec, maxShare: SRS_CONFIG.MAX_REVISION_SHARE };
}

/** Picks due items that fit within a time budget (used by daily lessons). */
export function fitToBudget<T extends { estimatedSec: number }>(items: T[], budgetSec: number): T[] {
  const out: T[] = [];
  let used = 0;
  for (const it of items) {
    if (used + it.estimatedSec > budgetSec) continue;
    out.push(it);
    used += it.estimatedSec;
  }
  return out;
}
