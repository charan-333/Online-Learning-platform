/**
 * Rule-based per-question classification for mock review. Thresholds are
 * deliberately simple and documented so learners can see why a label was given.
 */
export type MockClass =
  | 'correct_efficient'
  | 'correct_slow'
  | 'incorrect_adequate_time'
  | 'incorrect_conceptual_gap'
  | 'incorrect_careless'
  | 'skipped_appropriately'
  | 'skipped_despite_ability'
  | 'attempted_low_expected_value';

export const MOCK_CLASS_LABEL: Record<MockClass, string> = {
  correct_efficient: 'Correct and efficient',
  correct_slow: 'Correct but slow',
  incorrect_adequate_time: 'Incorrect despite adequate time',
  incorrect_conceptual_gap: 'Incorrect due to a conceptual gap',
  incorrect_careless: 'Incorrect due to careless execution',
  skipped_appropriately: 'Skipped appropriately',
  skipped_despite_ability: 'Skipped despite sufficient ability',
  attempted_low_expected_value: 'Attempted despite low expected value',
};

export const ANALYSIS_CONFIG = {
  SLOW_FACTOR: 1.25, // correct but took > 1.25 × estimate
  RUSHED_FACTOR: 0.4, // wrong in < 40% of estimate → careless/rushed
  GAP_MASTERY: 40, // wrong with topic mastery below this → conceptual gap
  ABLE_MASTERY: 60, // skipped easy/medium with mastery ≥ this → skipped despite ability
  DIFFICULTY_P: { easy: 0.85, medium: 0.65, difficult: 0.45, advanced: 0.3 } as Record<string, number>,
};

/** Probability of answering correctly, from topic accuracy shrunk toward a difficulty prior. */
export function successProbability(difficulty: string, topicAttempts: number, topicCorrect: number) {
  const prior = ANALYSIS_CONFIG.DIFFICULTY_P[difficulty] ?? 0.5;
  const k = 5; // prior strength in pseudo-attempts
  const base = (topicCorrect + prior * k) / (topicAttempts + k);
  // Harder questions than average scale down, easier scale up, relative to the medium prior.
  return Math.max(0.02, Math.min(0.98, base * (prior / ANALYSIS_CONFIG.DIFFICULTY_P.medium)));
}

export function expectedValue(p: number, marksCorrect: number, marksWrong: number) {
  return p * marksCorrect + (1 - p) * marksWrong;
}

export interface ClassifyInput {
  status: 'correct' | 'wrong' | 'unanswered';
  timeSec: number;
  estimatedSec: number;
  difficulty: string;
  topicMastery: number;
  expectedValue: number;
}

export function classify(x: ClassifyInput): MockClass {
  const c = ANALYSIS_CONFIG;
  if (x.status === 'correct') return x.timeSec > x.estimatedSec * c.SLOW_FACTOR ? 'correct_slow' : 'correct_efficient';
  if (x.status === 'wrong') {
    if (x.expectedValue < 0 && (x.difficulty === 'difficult' || x.difficulty === 'advanced')) return 'attempted_low_expected_value';
    if (x.timeSec < x.estimatedSec * c.RUSHED_FACTOR) return 'incorrect_careless';
    if (x.topicMastery < c.GAP_MASTERY) return 'incorrect_conceptual_gap';
    return 'incorrect_adequate_time';
  }
  if ((x.difficulty === 'easy' || x.difficulty === 'medium') && x.topicMastery >= c.ABLE_MASTERY) return 'skipped_despite_ability';
  return 'skipped_appropriately';
}
