/**
 * Spaced-repetition scheduler (SM-2 style, simplified to 4 grades).
 * grade: 0 = forgot, 1 = hard, 2 = good, 3 = easy.
 */
export const SRS_CONFIG = {
  MIN_EASE: 1.3,
  MAX_EASE: 3.0,
  FIRST_INTERVAL: { 0: 1, 1: 1, 2: 3, 3: 5 } as Record<number, number>,
  HARD_FACTOR: 1.2,
  EASY_BONUS: 1.3,
  MAX_INTERVAL_DAYS: 120,
  /** Share of a study session that revision may take, so new learning is not starved. */
  MAX_REVISION_SHARE: 0.35,
};

export interface SrsState {
  interval_days: number;
  ease: number;
  reps: number;
  lapses: number;
}

export function nextReview(s: SrsState, grade: 0 | 1 | 2 | 3, daysUntilExam: number | null = null, cfg = SRS_CONFIG): SrsState & { due_in_days: number } {
  let { interval_days: interval, ease, reps, lapses } = s;
  if (grade === 0) {
    lapses += 1;
    reps = 0;
    interval = 1;
    ease = Math.max(cfg.MIN_EASE, ease - 0.2);
  } else {
    if (reps === 0) interval = cfg.FIRST_INTERVAL[grade];
    else if (grade === 1) interval = interval * cfg.HARD_FACTOR;
    else if (grade === 2) interval = interval * ease;
    else interval = interval * ease * cfg.EASY_BONUS;
    reps += 1;
    if (grade === 1) ease = Math.max(cfg.MIN_EASE, ease - 0.15);
    if (grade === 3) ease = Math.min(cfg.MAX_EASE, ease + 0.15);
  }
  interval = Math.min(interval, cfg.MAX_INTERVAL_DAYS);
  // Before the exam, never schedule a review after exam day: compress so it lands before.
  if (daysUntilExam !== null && daysUntilExam > 1 && interval > daysUntilExam - 1) interval = Math.max(1, daysUntilExam - 1);
  interval = Math.round(interval * 100) / 100;
  return { interval_days: interval, ease: Math.round(ease * 100) / 100, reps, lapses, due_in_days: interval };
}

/** Initial delay for a newly queued item, by why it was queued. */
export function initialDelayDays(reason: 'incorrect' | 'low_confidence' | 'guessed' | 'first_exposure' | 'high_value_formula'): number {
  switch (reason) {
    case 'incorrect':
      return 1;
    case 'low_confidence':
    case 'guessed':
      return 2;
    case 'high_value_formula':
      return 3;
    default:
      return 4;
  }
}
