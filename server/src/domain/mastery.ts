/**
 * Topic mastery model (rule-based, explainable). See docs/MASTERY.md.
 *
 * score = 100 × evidence × (W_ACC·accuracy + W_SPEED·speed + W_CAL·calibration)
 *
 * - accuracy: recency- and difficulty-weighted share of correct answers. A correct
 *   guess counts GUESS_CREDIT; attempts made after viewing the solution count 0 and
 *   are excluded from evidence. Only the latest MAX_ATTEMPTS attempts are used.
 * - speed: mean of min(1, estimated / actual) over correct attempts.
 * - calibration: 1 − share of attempts answered wrongly with high confidence.
 * - evidence: min(1, distinctQuestions / EVIDENCE_TARGET); one success cannot
 *   produce mastery because the score is scaled by breadth of evidence.
 */
export const MASTERY_CONFIG = {
  MAX_ATTEMPTS: 30,
  HALF_LIFE_DAYS: 21,
  DIFFICULTY_WEIGHT: { easy: 0.6, medium: 1.0, difficult: 1.3, advanced: 1.5 } as Record<string, number>,
  GUESS_CREDIT: 0.5,
  W_ACC: 0.7,
  W_SPEED: 0.2,
  W_CAL: 0.1,
  EVIDENCE_TARGET: 8,
  LEARNING_MIN_DISTINCT: 3,
  WEAK_RECENT_WINDOW: 5,
  WEAK_RECENT_ACCURACY: 0.5,
  REPEATED_MISTAKE_COUNT: 2,
  PROFICIENT_SCORE: 70,
  PROFICIENT_MIN_DISTINCT: 6,
  EXAM_READY_SCORE: 85,
  EXAM_READY_MIN_DISTINCT: 10,
  EXAM_READY_MIN_HARD_CORRECT: 3,
  EXAM_READY_MIN_TIMED_FAST: 3,
  REVISION_DUE_DAYS: 21,
  MODE_B_SCORE: 70,
};

export type MasteryState = 'not_started' | 'learning' | 'practicing' | 'weak' | 'revision_due' | 'proficient' | 'exam_ready';

export interface AttemptForMastery {
  question_id: string;
  is_correct: boolean;
  time_taken_sec: number;
  estimated_time_sec: number;
  difficulty: string;
  confidence: number | null;
  guessed: boolean;
  solution_seen_first: boolean;
  timed: boolean;
  mistake_type: string | null;
  created_at: Date;
}

export interface MasteryResult {
  score: number;
  state: MasteryState;
  mode: 'A' | 'B';
  attempts: number;
  correct: number;
  distinct: number;
  reason: string;
  components: { accuracy: number; speed: number; calibration: number; evidence: number };
}

export function computeMastery(all: AttemptForMastery[], now = new Date(), cfg = MASTERY_CONFIG): MasteryResult {
  const sorted = [...all].sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
  const attempts = sorted.slice(0, cfg.MAX_ATTEMPTS);
  const counted = attempts.filter((a) => !a.solution_seen_first);
  const distinct = new Set(counted.map((a) => a.question_id)).size;
  const correct = counted.filter((a) => a.is_correct).length;

  if (counted.length === 0) {
    return { score: 0, state: 'not_started', mode: 'A', attempts: all.length, correct: 0, distinct: 0, reason: 'No independent attempts yet.', components: { accuracy: 0, speed: 0, calibration: 0, evidence: 0 } };
  }

  let wSum = 0;
  let wCorrect = 0;
  for (const a of counted) {
    const ageDays = Math.max(0, (now.getTime() - a.created_at.getTime()) / 86400_000);
    const w = Math.pow(0.5, ageDays / cfg.HALF_LIFE_DAYS) * (cfg.DIFFICULTY_WEIGHT[a.difficulty] ?? 1);
    wSum += w;
    if (a.is_correct) wCorrect += w * (a.guessed ? cfg.GUESS_CREDIT : 1);
  }
  const accuracy = wSum ? wCorrect / wSum : 0;
  const corrects = counted.filter((a) => a.is_correct);
  const speed = corrects.length ? corrects.reduce((s, a) => s + Math.min(1, a.estimated_time_sec / Math.max(1, a.time_taken_sec)), 0) / corrects.length : 0;
  const confidentWrong = counted.filter((a) => !a.is_correct && a.confidence === 3).length;
  const calibration = 1 - confidentWrong / counted.length;
  const evidence = Math.min(1, distinct / cfg.EVIDENCE_TARGET);
  const score = Math.round(100 * evidence * (cfg.W_ACC * accuracy + cfg.W_SPEED * speed + cfg.W_CAL * calibration) * 100) / 100;

  // ---- state rules (evaluated in priority order)
  const recent = counted.slice(0, cfg.WEAK_RECENT_WINDOW);
  const recentAcc = recent.filter((a) => a.is_correct).length / recent.length;
  const mistakeCounts = new Map<string, number>();
  for (const a of recent) if (!a.is_correct && a.mistake_type) mistakeCounts.set(a.mistake_type, (mistakeCounts.get(a.mistake_type) ?? 0) + 1);
  const repeated = [...mistakeCounts.entries()].find(([, n]) => n >= cfg.REPEATED_MISTAKE_COUNT);
  const lastPractice = sorted[0].created_at;
  const daysSince = (now.getTime() - lastPractice.getTime()) / 86400_000;
  const hardCorrect = corrects.filter((a) => (a.difficulty === 'difficult' || a.difficulty === 'advanced') && !a.guessed).length;
  const timedFast = corrects.filter((a) => a.timed && a.time_taken_sec <= a.estimated_time_sec).length;

  let state: MasteryState;
  let reason: string;
  if (distinct < cfg.LEARNING_MIN_DISTINCT) {
    state = 'learning';
    reason = `Only ${distinct} different question(s) attempted; at least ${cfg.LEARNING_MIN_DISTINCT} are needed before judging.`;
  } else if (recentAcc < cfg.WEAK_RECENT_ACCURACY || repeated) {
    state = 'weak';
    reason = repeated
      ? `Repeated mistake type "${repeated[0].replace(/_/g, ' ')}" in the last ${recent.length} attempts.`
      : `Recent accuracy ${Math.round(recentAcc * 100)}% over the last ${recent.length} attempts is below ${cfg.WEAK_RECENT_ACCURACY * 100}%.`;
  } else if (score >= cfg.EXAM_READY_SCORE && distinct >= cfg.EXAM_READY_MIN_DISTINCT && hardCorrect >= cfg.EXAM_READY_MIN_HARD_CORRECT && timedFast >= cfg.EXAM_READY_MIN_TIMED_FAST) {
    state = 'exam_ready';
    reason = `Score ${score} across ${distinct} questions, ${hardCorrect} hard questions correct and ${timedFast} timed correct within the estimate.`;
  } else if (score >= cfg.PROFICIENT_SCORE && distinct >= cfg.PROFICIENT_MIN_DISTINCT) {
    state = 'proficient';
    reason = `Score ${score} across ${distinct} different questions.`;
  } else {
    state = 'practicing';
    reason = `Score ${score}; proficiency needs ${cfg.PROFICIENT_SCORE}+ across ${cfg.PROFICIENT_MIN_DISTINCT}+ different questions.`;
  }
  if ((state === 'proficient' || state === 'exam_ready') && daysSince > cfg.REVISION_DUE_DAYS) {
    reason = `Was ${state.replace('_', '-')}, but not practised for ${Math.floor(daysSince)} days.`;
    state = 'revision_due';
  }
  const mode: 'A' | 'B' = score >= cfg.MODE_B_SCORE && state !== 'weak' ? 'B' : 'A';
  return { score, state, mode, attempts: all.length, correct, distinct, reason, components: { accuracy, speed, calibration, evidence } };
}
