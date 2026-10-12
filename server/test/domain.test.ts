import { describe, expect, it } from 'vitest';
import { computeMastery, type AttemptForMastery } from '../src/domain/mastery.js';
import { classify, expectedValue, successProbability } from '../src/domain/mockAnalysis.js';
import { addDays, buildPlan, dayCapacity, interleave, reflow, type Availability } from '../src/domain/planner.js';
import { isCorrect, marksFor } from '../src/domain/scoring.js';
import { nextReview } from '../src/domain/srs.js';
import { evaluateChoice, optimalSelection } from '../src/domain/strategy.js';

describe('answer checking and marking', () => {
  const mcq = { question_type: 'MCQ' as const, correct_answer: 'B', answer_tolerance: 0, marks_correct: 3, marks_wrong: -1 };
  const tita = { question_type: 'TITA' as const, correct_answer: '20.48', answer_tolerance: 0.01, marks_correct: 3, marks_wrong: 0 };

  it('grades MCQs case-insensitively', () => {
    expect(isCorrect(mcq, 'b')).toBe(true);
    expect(isCorrect(mcq, 'C')).toBe(false);
    expect(isCorrect(mcq, '')).toBe(false);
  });
  it('grades numeric TITA with tolerance and separators', () => {
    expect(isCorrect(tita, '20.48')).toBe(true);
    expect(isCorrect(tita, '20.475')).toBe(true);
    expect(isCorrect(tita, '20.5')).toBe(false);
    expect(isCorrect({ ...tita, correct_answer: '27000', answer_tolerance: 0 }, '27,000')).toBe(true);
    expect(isCorrect({ ...tita, correct_answer: '2431', answer_tolerance: 0 }, '2413')).toBe(false);
  });
  it('applies negative marking only to wrong MCQs and nothing for unanswered', () => {
    expect(marksFor(mcq, 'B')).toEqual({ status: 'correct', marks: 3 });
    expect(marksFor(mcq, 'A')).toEqual({ status: 'wrong', marks: -1 });
    expect(marksFor(mcq, null)).toEqual({ status: 'unanswered', marks: 0 });
    expect(marksFor(tita, '1')).toEqual({ status: 'wrong', marks: 0 });
  });
});

const att = (o: Partial<AttemptForMastery> & { question_id: string }, daysAgo = 0): AttemptForMastery => ({
  is_correct: true,
  time_taken_sec: 60,
  estimated_time_sec: 60,
  difficulty: 'medium',
  confidence: 2,
  guessed: false,
  solution_seen_first: false,
  timed: false,
  mistake_type: null,
  created_at: new Date(Date.now() - daysAgo * 86400_000),
  ...o,
});

describe('mastery model', () => {
  it('is not_started with no attempts', () => {
    expect(computeMastery([]).state).toBe('not_started');
  });
  it('one correct attempt does not produce mastery', () => {
    const r = computeMastery([att({ question_id: 'a' })]);
    expect(r.state).toBe('learning');
    expect(r.score).toBeLessThan(20);
  });
  it('ignores attempts made after viewing the solution', () => {
    const r = computeMastery([att({ question_id: 'a', solution_seen_first: true }), att({ question_id: 'b', solution_seen_first: true })]);
    expect(r.state).toBe('not_started');
  });
  it('repeated correct answers on the SAME question do not add breadth', () => {
    const same = Array.from({ length: 10 }, (_, i) => att({ question_id: 'a' }, i * 0.01));
    const r = computeMastery(same);
    expect(r.distinct).toBe(1);
    expect(r.state).toBe('learning');
  });
  it('becomes proficient with broad accurate evidence and exam-ready with hard timed evidence', () => {
    const five = Array.from({ length: 5 }, (_, i) => att({ question_id: `q${i}` }));
    expect(computeMastery(five).state).toBe('practicing'); // needs 6 different questions
    const six = Array.from({ length: 6 }, (_, i) => att({ question_id: `q${i}` }));
    expect(computeMastery(six).state).toBe('proficient'); // 100 × 6/8 = 75
    const ten = Array.from({ length: 10 }, (_, i) => att({ question_id: `q${i}`, difficulty: i < 4 ? 'difficult' : 'medium', timed: true, time_taken_sec: 50 }));
    const r = computeMastery(ten);
    expect(r.score).toBeGreaterThanOrEqual(85);
    expect(r.state).toBe('exam_ready');
    expect(r.mode).toBe('B');
  });
  it('demotes to weak when recent accuracy drops', () => {
    const old = Array.from({ length: 8 }, (_, i) => att({ question_id: `q${i}` }, 5));
    const recent = Array.from({ length: 3 }, (_, i) => att({ question_id: `r${i}`, is_correct: false }, 0));
    expect(computeMastery([...old, ...recent]).state).toBe('weak');
  });
  it('flags weak on a repeated mistake type', () => {
    const xs = [
      ...Array.from({ length: 4 }, (_, i) => att({ question_id: `q${i}` }, 1)),
      att({ question_id: 'w1', is_correct: false, mistake_type: 'calculation_error' }),
      att({ question_id: 'w2', is_correct: false, mistake_type: 'calculation_error' }),
    ];
    const r = computeMastery(xs);
    expect(r.state).toBe('weak');
    expect(r.reason).toMatch(/calculation error/);
  });
  it('marks proficient topics as revision_due after a long gap', () => {
    const xs = Array.from({ length: 9 }, (_, i) => att({ question_id: `q${i}` }, 30));
    const r = computeMastery(xs);
    expect(r.state).toBe('revision_due');
  });
  it('guesses earn only partial credit and confident errors lower calibration', () => {
    const base = Array.from({ length: 8 }, (_, i) => att({ question_id: `q${i}` }));
    const guessed = Array.from({ length: 8 }, (_, i) => att({ question_id: `q${i}`, guessed: true }));
    expect(computeMastery(guessed).score).toBeLessThan(computeMastery(base).score);
    const confWrong = [...base.slice(0, 6), att({ question_id: 'x', is_correct: false, confidence: 3 }), att({ question_id: 'y', is_correct: false, confidence: 1 })];
    expect(computeMastery(confWrong).components.calibration).toBeCloseTo(7 / 8);
  });
});

describe('spaced repetition', () => {
  const fresh = { interval_days: 1, ease: 2.3, reps: 0, lapses: 0 };
  it('grows intervals on success and resets on failure', () => {
    const a = nextReview(fresh, 2);
    expect(a.interval_days).toBe(3);
    const b = nextReview(a, 2);
    expect(b.interval_days).toBeCloseTo(3 * 2.3, 1);
    const c = nextReview(b, 0);
    expect(c.interval_days).toBe(1);
    expect(c.lapses).toBe(1);
    expect(c.ease).toBeLessThan(b.ease);
  });
  it('never schedules past the exam', () => {
    const r = nextReview({ interval_days: 30, ease: 2.5, reps: 4, lapses: 0 }, 3, 10);
    expect(r.interval_days).toBeLessThanOrEqual(9);
  });
});

describe('study planner', () => {
  const a: Availability = { workdayMinutes: 60, weekendMinutes: 150, offDays: [], weekendDays: [0, 6], lowTimeMode: false };
  const topics = [
    { topicId: 'a', name: 'A', sectionId: 'QA', estimatedHours: 3, state: 'not_started' },
    { topicId: 'b', name: 'B', sectionId: 'VARC', estimatedHours: 2, state: 'practicing' },
    { topicId: 'c', name: 'C', sectionId: 'QA', estimatedHours: 2, state: 'exam_ready' },
  ];
  it('respects daily capacity, reserves revision, and skips exam-ready topics', () => {
    const start = '2026-10-12'; // Monday
    const { tasks } = buildPlan(start, addDays(start, 20), a, topics);
    const byDay = new Map<string, number>();
    for (const t of tasks) byDay.set(t.scheduledDate, (byDay.get(t.scheduledDate) ?? 0) + t.minutes);
    for (const [d, m] of byDay) expect(m).toBeLessThanOrEqual(dayCapacity(d, a));
    expect(tasks.filter((t) => t.taskType === 'revision').length).toBeGreaterThan(10);
    expect(tasks.some((t) => t.topicId === 'c')).toBe(false);
    const learnA = tasks.filter((t) => t.topicId === 'a').reduce((s, t) => s + t.minutes, 0);
    expect(learnA).toBe(180);
    expect(tasks.some((t) => t.taskType === 'mock')).toBe(true);
  });
  it('gives off days no tasks and caps low-time mode at 20 minutes', () => {
    const off = { ...a, offDays: [3], lowTimeMode: true };
    const { tasks } = buildPlan('2026-10-12', '2026-10-25', off, topics);
    expect(tasks.some((t) => new Date(t.scheduledDate + 'T00:00:00Z').getUTCDay() === 3)).toBe(false);
    const byDay = new Map<string, number>();
    for (const t of tasks) byDay.set(t.scheduledDate, (byDay.get(t.scheduledDate) ?? 0) + t.minutes);
    for (const m of byDay.values()) expect(m).toBeLessThanOrEqual(20);
  });
  it('interleaves sections weighted toward weaker ones', () => {
    const ts = ['q1', 'q2', 'q3', 'q4', 'v1', 'v2'].map((id) => ({ topicId: id, name: id, sectionId: id.startsWith('q') ? 'QA' : 'VARC', estimatedHours: 1, state: 'not_started' }));
    const order = interleave(ts, { QA: 2, VARC: 1 }).map((t) => t.topicId);
    expect(order.slice(0, 3).filter((x) => x.startsWith('q')).length).toBe(2);
    expect(new Set(order).size).toBe(6);
  });
  it('re-flows overdue tasks forward without duplication or over-filling', () => {
    const tasks = [
      { id: '1', scheduledDate: '2026-10-10', taskType: 'learn' as const, minutes: 50, position: 0, status: 'pending' as const },
      { id: '2', scheduledDate: '2026-10-11', taskType: 'revision' as const, minutes: 10, position: 0, status: 'pending' as const },
      { id: '3', scheduledDate: '2026-10-12', taskType: 'practice' as const, minutes: 50, position: 0, status: 'pending' as const },
      { id: '4', scheduledDate: '2026-10-12', taskType: 'revision' as const, minutes: 10, position: 1, status: 'pending' as const },
      { id: '5', scheduledDate: '2026-10-09', taskType: 'learn' as const, minutes: 30, position: 0, status: 'done' as const },
    ];
    const { moves, skipped } = reflow(tasks, '2026-10-12', a);
    expect(skipped).toEqual(['2']);
    expect(moves.map((m) => m.id).sort()).toEqual(['1', '3']);
    expect(new Set(moves.map((m) => m.id)).size).toBe(moves.length);
    const day12 = moves.filter((m) => m.scheduledDate === '2026-10-12').map((m) => m.id);
    expect(day12).toEqual(['1']); // 50 + revision 10 fills Monday's 60
    expect(moves.find((m) => m.id === '3')!.scheduledDate).toBe('2026-10-13');
  });
});

describe('mock analysis and strategy', () => {
  it('computes expected value with negative marking', () => {
    expect(expectedValue(0.25, 3, -1)).toBeCloseTo(0);
    expect(expectedValue(0.5, 3, 0)).toBeCloseTo(1.5);
    expect(successProbability('difficult', 0, 0)).toBeLessThan(successProbability('easy', 0, 0));
  });
  it('classifies question outcomes', () => {
    const base = { estimatedSec: 100, difficulty: 'medium', topicMastery: 70, expectedValue: 1 };
    expect(classify({ ...base, status: 'correct', timeSec: 90 })).toBe('correct_efficient');
    expect(classify({ ...base, status: 'correct', timeSec: 200 })).toBe('correct_slow');
    expect(classify({ ...base, status: 'wrong', timeSec: 20 })).toBe('incorrect_careless');
    expect(classify({ ...base, status: 'wrong', timeSec: 100, topicMastery: 10 })).toBe('incorrect_conceptual_gap');
    expect(classify({ ...base, status: 'wrong', timeSec: 100 })).toBe('incorrect_adequate_time');
    expect(classify({ ...base, status: 'wrong', timeSec: 100, difficulty: 'advanced', expectedValue: -0.5 })).toBe('attempted_low_expected_value');
    expect(classify({ ...base, status: 'unanswered', timeSec: 0 })).toBe('skipped_despite_ability');
    expect(classify({ ...base, status: 'unanswered', timeSec: 0, difficulty: 'difficult' })).toBe('skipped_appropriately');
  });
  it('finds the optimal attempt set under a time budget', () => {
    const items = [
      { id: 'a', ev: 2, timeSec: 60 },
      { id: 'b', ev: 1.5, timeSec: 30 },
      { id: 'c', ev: 1.4, timeSec: 30 },
      { id: 'd', ev: -0.5, timeSec: 15 },
    ];
    const best = optimalSelection(items, 60);
    expect(best.ids.sort()).toEqual(['b', 'c']);
    expect(best.ev).toBeCloseTo(2.9);
    const r = evaluateChoice(items, ['a', 'd'], 60);
    expect(r.counted).toEqual(['a']);
    expect(r.negativeEvChosen).toEqual(['d']);
    expect(r.efficiency).toBe(69);
  });
});
