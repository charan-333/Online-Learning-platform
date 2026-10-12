import { many, one, query, tx } from '../db/pool.js';
import { addDays, buildPlan, interleave, PLAN_CONFIG, reflow, type Availability, type TopicWork } from '../domain/planner.js';
import { notFound } from '../lib/errors.js';

export const todayStr = () => new Date().toISOString().slice(0, 10);

async function availability(userId: string): Promise<{ a: Availability; examDate: string | null; profile: any }> {
  const p = await one('SELECT * FROM user_profiles WHERE user_id = $1', [userId]);
  return {
    a: { workdayMinutes: p.workday_minutes, weekendMinutes: p.weekend_minutes, offDays: p.off_days, weekendDays: p.weekend_days, lowTimeMode: p.low_time_mode },
    examDate: p.exam_date,
    profile: p,
  };
}

/** Topological order of topics (prerequisites first), stable by section and syllabus position. */
async function orderedTopics(userId: string): Promise<TopicWork[]> {
  const topics = await many(
    `SELECT t.id, t.name, t.section_id, t.position, t.estimated_hours, coalesce(m.state, 'not_started') AS state
       FROM topics t LEFT JOIN user_topic_mastery m ON m.topic_id = t.id AND m.user_id = $1 ORDER BY t.section_id, t.position`,
    [userId],
  );
  const edges = await many('SELECT topic_id, prerequisite_id FROM topic_prerequisites');
  const indeg = new Map(topics.map((t) => [t.id, 0]));
  for (const e of edges) indeg.set(e.topic_id, (indeg.get(e.topic_id) ?? 0) + 1);
  const ready = topics.filter((t) => indeg.get(t.id) === 0);
  const out: any[] = [];
  const seen = new Set<string>();
  while (ready.length) {
    // Weak topics first among those that are ready.
    ready.sort((a, b) => Number(b.state === 'weak') - Number(a.state === 'weak') || a.position - b.position);
    const t = ready.shift()!;
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
    for (const e of edges.filter((x) => x.prerequisite_id === t.id)) {
      indeg.set(e.topic_id, indeg.get(e.topic_id)! - 1);
      if (indeg.get(e.topic_id) === 0) ready.push(topics.find((x) => x.id === e.topic_id)!);
    }
  }
  for (const t of topics) if (!seen.has(t.id)) out.push(t); // cycles (should not exist) appended
  return out.map((t) => ({ topicId: t.id, name: t.name, sectionId: t.section_id, estimatedHours: Number(t.estimated_hours), state: t.state }));
}

async function sectionWeights(userId: string, profile: any) {
  const ratingWeight: Record<string, number> = { weak: 1.4, needs_improvement: 1.2, average: 1.0, strong: 0.8 };
  const w: Record<string, number> = { QA: ratingWeight[profile.qa_self_rating], VARC: ratingWeight[profile.varc_self_rating], DILR: ratingWeight[profile.dilr_self_rating] };
  // After a diagnostic, measured accuracy replaces the self-rating.
  const diag = await many(
    `SELECT q.section_id, avg(CASE WHEN a.is_correct THEN 1.0 ELSE 0 END) AS acc FROM question_attempts a JOIN questions q ON q.id = a.question_id
      WHERE a.user_id = $1 AND a.context = 'diagnostic' GROUP BY 1`,
    [userId],
  );
  for (const d of diag) w[d.section_id] = 1.5 - Number(d.acc) * 0.7;
  return w;
}

export async function generatePlan(userId: string, start = todayStr()) {
  const { a, examDate, profile } = await availability(userId);
  const horizonEnd = addDays(start, PLAN_CONFIG.HORIZON_DAYS - 1);
  const end = examDate && examDate < horizonEnd ? addDays(examDate, -1) : horizonEnd;
  const topics = interleave(await orderedTopics(userId), await sectionWeights(userId, profile));
  const { tasks, unscheduledMinutes } = buildPlan(start, end, a, topics);
  const rationale = [
    `Built from your availability (${a.workdayMinutes} min on workdays, ${a.weekendMinutes} min on weekend days${a.lowTimeMode ? ', low-time mode on' : ''}).`,
    'Topics follow prerequisite order, interleaving sections and weighting weaker sections more often.',
    `Each study day reserves about ${Math.round(PLAN_CONFIG.REVISION_SHARE * 100)}% for spaced revision; one mock per week from week ${PLAN_CONFIG.MOCKS_FROM_WEEK}.`,
    unscheduledMinutes > 0
      ? `About ${Math.round(unscheduledMinutes / 60)} hours of topic work does not fit before ${end}; the plan continues when regenerated.`
      : 'All planned topic work fits in this window.',
  ].join(' ');
  return tx(async (c) => {
    await query("UPDATE study_plans SET status = 'archived' WHERE user_id = $1 AND status = 'active'", [userId], c);
    const plan = await one('INSERT INTO study_plans(user_id, start_date, end_date, rationale) VALUES ($1,$2,$3,$4) RETURNING *', [userId, start, end, rationale], c);
    for (const t of tasks) {
      await query(
        'INSERT INTO study_plan_tasks(plan_id, user_id, scheduled_date, original_date, task_type, topic_id, title, minutes, position) VALUES ($1,$2,$3,$3,$4,$5,$6,$7,$8)',
        [plan!.id, userId, t.scheduledDate, t.taskType, t.topicId, t.title, t.minutes, t.position],
        c,
      );
    }
    return { ...plan!, unscheduledMinutes };
  });
}

/** Moves unfinished past tasks forward into available capacity. Idempotent. */
export async function reallocate(userId: string, planId: string, from = todayStr()) {
  const plan = await one('SELECT * FROM study_plans WHERE id = $1 AND user_id = $2', [planId, userId]);
  if (!plan) throw notFound('Plan');
  const { a, examDate } = await availability(userId);
  const rows = await many('SELECT id, scheduled_date, task_type, minutes, position, status FROM study_plan_tasks WHERE plan_id = $1', [planId]);
  const overdue = rows.filter((r) => r.status === 'pending' && r.scheduled_date < from);
  if (!overdue.length) return { moved: 0, skipped: 0, beyondExam: 0 };
  const { moves, skipped } = reflow(
    rows.map((r) => ({ id: r.id, scheduledDate: r.scheduled_date, taskType: r.task_type, minutes: r.minutes, position: r.position, status: r.status })),
    from,
    a,
  );
  let moved = 0;
  await tx(async (c) => {
    for (const id of skipped) await query("UPDATE study_plan_tasks SET status = 'skipped' WHERE id = $1", [id], c);
    for (const m of moves) {
      const r = rows.find((x) => x.id === m.id)!;
      if (r.scheduled_date !== m.scheduledDate) moved++;
      await query('UPDATE study_plan_tasks SET scheduled_date = $2, position = $3 WHERE id = $1', [m.id, m.scheduledDate, m.position], c);
    }
    const last = moves.reduce((d, m) => (m.scheduledDate > d ? m.scheduledDate : d), plan.end_date);
    await query('UPDATE study_plans SET end_date = $2 WHERE id = $1', [planId, last], c);
  });
  const beyondExam = examDate ? moves.filter((m) => m.scheduledDate >= examDate).length : 0;
  return { moved, skipped: skipped.length, beyondExam };
}
