export const ERROR_CATEGORIES = [
  'conceptual_gap',
  'formula_recall',
  'calculation_error',
  'misread_question',
  'incorrect_assumption',
  'logical_reasoning_error',
  'poor_option_elimination',
  'time_pressure',
  'blind_guess',
  'wrong_question_selection',
  'overcomplication',
  'careless_execution',
] as const;
export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

/** What the category usually means and the default remediation, shown with each error. */
export const ERROR_GUIDE: Record<ErrorCategory | 'unclassified', { label: string; misconception: string; remedy: string }> = {
  conceptual_gap: { label: 'Conceptual gap', misconception: 'The underlying idea was missing or misunderstood, so no method was available.', remedy: 'Re-study the topic concept and worked examples, then solve two similar questions untimed.' },
  formula_recall: { label: 'Formula recall', misconception: 'The right relationship was known in principle but recalled incorrectly or not at all.', remedy: 'Add the formula to revision and re-derive it once from first principles.' },
  calculation_error: { label: 'Calculation error', misconception: 'The method was right; arithmetic went wrong.', remedy: 'Do a timed calculation drill and add a quick sanity check (units, magnitude, options) before submitting.' },
  misread_question: { label: 'Misread question', misconception: 'The question asked for something different from what was solved.', remedy: 'Before solving, underline what is asked (units, "not", "minimum", "at least").' },
  incorrect_assumption: { label: 'Incorrect assumption', misconception: 'A condition was assumed that the question did not give.', remedy: 'List the givens explicitly; mark anything you add as an assumption and test it.' },
  logical_reasoning_error: { label: 'Logical reasoning error', misconception: 'A deduction did not follow from the conditions.', remedy: 'Write each deduction with the condition that forces it; re-check cases you discarded.' },
  poor_option_elimination: { label: 'Poor option elimination', misconception: 'A distractor was chosen because it sounded right rather than because the text supports it.', remedy: 'For each option, point to the supporting line; eliminate on scope, extremity and unsupported inference.' },
  time_pressure: { label: 'Time pressure', misconception: 'The approach was abandoned or rushed because time ran short.', remedy: 'Practise timed sets and set a per-question exit time.' },
  blind_guess: { label: 'Blind guess', misconception: 'Answered without a basis, risking negative marks.', remedy: 'Under negative marking, skip unless you can eliminate options to raise the odds above the break-even.' },
  wrong_question_selection: { label: 'Wrong question selection', misconception: 'Time went to a low-value question while easier ones were left.', remedy: 'Do strategy drills: scan, rank by expected value, attempt in that order.' },
  overcomplication: { label: 'Overcomplication', misconception: 'A long method was used where a short one exists, causing errors or time loss.', remedy: 'Compare your method with the exam method in the solution; practise the shorter approach on similar questions.' },
  careless_execution: { label: 'Careless execution', misconception: 'Knew how to solve it but slipped (sign, copying, option marking).', remedy: 'Slow down on the last step; re-read the question before marking.' },
  unclassified: { label: 'Not yet classified', misconception: 'Classify this mistake to get a targeted explanation.', remedy: 'Open the error and choose the category that best describes what went wrong.' },
};
