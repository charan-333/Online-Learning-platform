export interface Gradable {
  question_type: 'MCQ' | 'TITA';
  correct_answer: string;
  answer_tolerance: number;
}

/** Normalises a TITA response: trims, removes thousands separators and spaces. */
export const normaliseTita = (s: string) => s.trim().replace(/[,\s]/g, '').toUpperCase();

export function isCorrect(q: Gradable, answer: string | null | undefined): boolean {
  if (answer === null || answer === undefined || answer.trim() === '') return false;
  if (q.question_type === 'MCQ') return answer.trim().toUpperCase() === q.correct_answer.trim().toUpperCase();
  const given = normaliseTita(answer);
  const expected = normaliseTita(q.correct_answer);
  const num = /^-?\d+(\.\d+)?$/;
  if (num.test(given) && num.test(expected)) {
    return Math.abs(Number(given) - Number(expected)) <= Math.max(Number(q.answer_tolerance) || 0, 1e-9);
  }
  return given === expected;
}

export interface Marking {
  marks_correct: number;
  marks_wrong: number;
}

/** Marks for one response. Unanswered = 0. Wrong answers take the (non-positive) negative mark. */
export function marksFor(q: Gradable & Marking, answer: string | null | undefined): { status: 'correct' | 'wrong' | 'unanswered'; marks: number } {
  if (answer === null || answer === undefined || answer.trim() === '') return { status: 'unanswered', marks: 0 };
  return isCorrect(q, answer) ? { status: 'correct', marks: Number(q.marks_correct) } : { status: 'wrong', marks: Number(q.marks_wrong) };
}
