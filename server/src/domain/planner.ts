/**
 * Study-plan generation and reallocation (pure functions; see services/plans.ts).
 *
 * - Daily capacity comes from the learner's availability: off days = 0, weekend days
 *   use weekend minutes, other days workday minutes; low-time mode caps at 20.
 * - Each study day reserves a revision slot (15% of capacity, at least 5 minutes).
 * - One mock per week from week 2: a full mock on a weekend day with ≥ 120 minutes,
 *   otherwise a 40-minute sectional; followed by a review task on the next study day.
 * - Remaining time is filled from an ordered topic queue. Each topic's workload is
 *   estimated_hours × 60 scaled by mastery (not started 100%, weak 100%, learning 90%,
 *   practicing 60%, revision_due 40%, proficient 25%, exam-ready 0%), split into
 *   'learn' (first 40%) and 'practice' tasks in chunks that fit the day.
 * - Reallocation re-flows pending tasks into future capacity in their original
 *   order. Rows are moved, never copied, so nothing is duplicated; overdue revision
 *   slots are skipped because the revision queue itself carries the overdue work.
 */
export interface Availability {
  workdayMinutes: number;
  weekendMinutes: number;
  offDays: number[];
  weekendDays: number[];
  lowTimeMode: boolean;
}

export interface TopicWork {
  topicId: string;
  name: string;
  sectionId: string;
  estimatedHours: number;
  state: string;
}

export interface PlanTask {
  scheduledDate: string;
  taskType: 'learn' | 'practice' | 'revision' | 'mock' | 'mock_review' | 'catch_up';
  topicId: string | null;
  title: string;
  minutes: number;
  position: number;
}

export const PLAN_CONFIG = {
  REVISION_SHARE: 0.15,
  MIN_REVISION: 5,
  MIN_CHUNK: 15,
  LEARN_SHARE: 0.4,
  FULL_MOCK_MINUTES: 120,
  SECTIONAL_MOCK_MINUTES: 40,
  MOCK_REVIEW_MINUTES: 30,
  MOCKS_FROM_WEEK: 2,
  HORIZON_DAYS: 56,
  WORKLOAD_FACTOR: { not_started: 1, weak: 1, learning: 0.9, practicing: 0.6, revision_due: 0.4, proficient: 0.25, exam_ready: 0 } as Record<string, number>,
};

export const addDays = (d: string, n: number) => {
  const x = new Date(d + 'T00:00:00Z');
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
const dow = (d: string) => new Date(d + 'T00:00:00Z').getUTCDay();

export function dayCapacity(date: string, a: Availability): number {
  const w = dow(date);
  if (a.offDays.includes(w)) return 0;
  const cap = a.weekendDays.includes(w) ? a.weekendMinutes : a.workdayMinutes;
  return a.lowTimeMode ? Math.min(cap, 20) : cap;
}

export const revisionSlot = (cap: number) => (cap <= 0 ? 0 : Math.min(cap, Math.max(PLAN_CONFIG.MIN_REVISION, Math.round(cap * PLAN_CONFIG.REVISION_SHARE))));

/** Interleaves sections so consecutive topics alternate, weighting weaker sections more often. */
export function interleave(topics: TopicWork[], sectionWeight: Record<string, number>): TopicWork[] {
  const queues: Record<string, TopicWork[]> = {};
  for (const t of topics) (queues[t.sectionId] ??= []).push(t);
  const out: TopicWork[] = [];
  const credit: Record<string, number> = Object.fromEntries(Object.keys(queues).map((s) => [s, 0]));
  while (Object.values(queues).some((q) => q.length)) {
    for (const s of Object.keys(queues)) if (queues[s].length) credit[s] += sectionWeight[s] ?? 1;
    const next = Object.keys(queues)
      .filter((s) => queues[s].length)
      .sort((a, b) => credit[b] - credit[a])[0];
    credit[next] -= Object.keys(queues).filter((s) => queues[s].length).reduce((sum, s) => sum + (sectionWeight[s] ?? 1), 0);
    out.push(queues[next].shift()!);
  }
  return out;
}

export function buildPlan(start: string, endInclusive: string, a: Availability, topics: TopicWork[]): { tasks: PlanTask[]; unscheduledMinutes: number } {
  const tasks: PlanTask[] = [];
  const work: { topic: TopicWork; learn: number; practice: number }[] = topics
    .map((t) => {
      const total = Math.round(t.estimatedHours * 60 * (PLAN_CONFIG.WORKLOAD_FACTOR[t.state] ?? 1));
      const learn = t.state === 'not_started' || t.state === 'learning' || t.state === 'weak' ? Math.round(total * PLAN_CONFIG.LEARN_SHARE) : 0;
      return { topic: t, learn, practice: total - learn };
    })
    .filter((w) => w.learn + w.practice > 0);

  let pendingReview = false;
  let day = start;
  let dayIndex = 0;
  let mockWeekDone = -1;
  while (day <= endInclusive) {
    let cap = dayCapacity(day, a);
    let pos = 0;
    const push = (t: Omit<PlanTask, 'scheduledDate' | 'position'>) => tasks.push({ ...t, scheduledDate: day, position: pos++ });
    const week = Math.floor(dayIndex / 7);
    if (cap > 0) {
      if (pendingReview && cap >= PLAN_CONFIG.MOCK_REVIEW_MINUTES) {
        push({ taskType: 'mock_review', topicId: null, title: 'Review last mock: classify every question', minutes: PLAN_CONFIG.MOCK_REVIEW_MINUTES });
        cap -= PLAN_CONFIG.MOCK_REVIEW_MINUTES;
        pendingReview = false;
      }
      const isWeekend = a.weekendDays.includes(dow(day));
      const lastDayOfWeek = dayIndex % 7 === 6;
      if (week + 1 >= PLAN_CONFIG.MOCKS_FROM_WEEK && mockWeekDone < week && (isWeekend || lastDayOfWeek)) {
        if (cap >= PLAN_CONFIG.FULL_MOCK_MINUTES) {
          push({ taskType: 'mock', topicId: null, title: 'Full-length mock in exam conditions', minutes: PLAN_CONFIG.FULL_MOCK_MINUTES });
          cap -= PLAN_CONFIG.FULL_MOCK_MINUTES;
          mockWeekDone = week;
          pendingReview = true;
        } else if (cap >= PLAN_CONFIG.SECTIONAL_MOCK_MINUTES + PLAN_CONFIG.MIN_REVISION) {
          push({ taskType: 'mock', topicId: null, title: 'Sectional test (40 minutes)', minutes: PLAN_CONFIG.SECTIONAL_MOCK_MINUTES });
          cap -= PLAN_CONFIG.SECTIONAL_MOCK_MINUTES;
          mockWeekDone = week;
          pendingReview = true;
        }
      }
      const rev = revisionSlot(cap);
      if (rev > 0) {
        push({ taskType: 'revision', topicId: null, title: 'Spaced revision queue', minutes: rev });
        cap -= rev;
      }
      while (cap >= Math.min(PLAN_CONFIG.MIN_CHUNK, cap) && cap > 0 && work.length) {
        const w = work[0];
        const kind = w.learn > 0 ? 'learn' : 'practice';
        const remaining = kind === 'learn' ? w.learn : w.practice;
        const chunk = Math.min(cap, remaining);
        // Avoid tiny leftovers: merge a final sliver into this chunk if it fits.
        push({ taskType: kind, topicId: w.topic.topicId, title: `${kind === 'learn' ? 'Learn' : 'Practise'}: ${w.topic.name}`, minutes: chunk });
        cap -= chunk;
        if (kind === 'learn') w.learn -= chunk;
        else w.practice -= chunk;
        if (w.learn <= 0 && w.practice <= 0) work.shift();
        if (cap < PLAN_CONFIG.MIN_CHUNK) break;
      }
    }
    day = addDays(day, 1);
    dayIndex++;
  }
  const unscheduledMinutes = work.reduce((s, w) => s + w.learn + w.practice, 0);
  return { tasks, unscheduledMinutes };
}

export interface FlowTask {
  id: string;
  scheduledDate: string;
  taskType: PlanTask['taskType'];
  minutes: number;
  position: number;
  status: 'pending' | 'done' | 'skipped';
}

/**
 * Re-flows pending tasks starting at `from` without duplication. Tasks already
 * fitting on or after `from` keep their relative order; overdue revision tasks are
 * skipped. Returns the new date for each task id and any that were skipped.
 */
export function reflow(tasks: FlowTask[], from: string, a: Availability, maxDays = 365) {
  const pending = tasks
    .filter((t) => t.status === 'pending')
    .sort((x, y) => (x.scheduledDate === y.scheduledDate ? x.position - y.position : x.scheduledDate < y.scheduledDate ? -1 : 1));
  const skipped = pending.filter((t) => t.taskType === 'revision' && t.scheduledDate < from).map((t) => t.id);
  const revisionKeep = pending.filter((t) => t.taskType === 'revision' && t.scheduledDate >= from);
  const movable = pending.filter((t) => t.taskType !== 'revision');
  const used = new Map<string, number>();
  for (const t of tasks) if (t.status === 'done' && t.scheduledDate >= from) used.set(t.scheduledDate, (used.get(t.scheduledDate) ?? 0) + t.minutes);
  for (const t of revisionKeep) used.set(t.scheduledDate, (used.get(t.scheduledDate) ?? 0) + t.minutes);
  const moves: { id: string; scheduledDate: string; position: number }[] = [];
  let day = from;
  let guard = 0;
  for (const t of movable) {
    while (guard < maxDays) {
      const cap = dayCapacity(day, a);
      const free = cap - (used.get(day) ?? 0);
      if (free >= t.minutes || (free > 0 && cap > 0 && t.minutes > cap && (used.get(day) ?? 0) === 0)) {
        used.set(day, (used.get(day) ?? 0) + t.minutes);
        moves.push({ id: t.id, scheduledDate: day, position: moves.filter((m) => m.scheduledDate === day).length + 10 });
        break;
      }
      day = addDays(day, 1);
      guard++;
    }
  }
  return { moves, skipped, lastDate: moves.length ? moves[moves.length - 1].scheduledDate : from };
}
