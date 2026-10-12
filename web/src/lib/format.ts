export const SECTION_NAMES: Record<string, string> = { VARC: 'Verbal Ability & Reading Comprehension', DILR: 'Data Interpretation & Logical Reasoning', QA: 'Quantitative Aptitude' };

export const ORIGIN_LABEL: Record<string, string> = {
  authentic_pyq: 'Authentic CAT PYQ',
  reconstructed: 'Reconstructed from memory',
  inspired: 'PYQ-inspired',
  original_practice: 'Original practice',
  ai_generated: 'AI-generated practice',
};

export const STATE_LABEL: Record<string, string> = {
  not_started: 'Not started',
  learning: 'Learning',
  practicing: 'Practising',
  weak: 'Weak',
  revision_due: 'Revision due',
  proficient: 'Proficient',
  exam_ready: 'Exam-ready',
};

export const DIFFICULTY_LABEL: Record<string, string> = { easy: 'Easy', medium: 'Medium', difficult: 'Difficult', advanced: 'Advanced' };

export const ERROR_LABEL: Record<string, string> = {
  conceptual_gap: 'Conceptual gap',
  formula_recall: 'Formula recall',
  calculation_error: 'Calculation error',
  misread_question: 'Misread question',
  incorrect_assumption: 'Incorrect assumption',
  logical_reasoning_error: 'Logical reasoning error',
  time_pressure: 'Time pressure',
  poor_selection: 'Poor question selection',
  rc_inference: 'RC inference error',
  rc_scope: 'RC scope error',
  va_option_elimination: 'VA option-elimination error',
  dilr_setup: 'DILR set-up error',
};

export function fmtSec(sec: number | null | undefined) {
  if (sec === null || sec === undefined || Number.isNaN(sec)) return '—';
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m ? `${m}m ${String(r).padStart(2, '0')}s` : `${r}s`;
}

export function fmtClock(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return `${h ? h + ':' : ''}${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

export const fmtDate = (d: string | Date | null | undefined) =>
  d ? new Date(typeof d === 'string' && d.length === 10 ? d + 'T00:00:00' : d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

export const fmtDay = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

export const pct = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${Math.round(n)}%`);

export const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
