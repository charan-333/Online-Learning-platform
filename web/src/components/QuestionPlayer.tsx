import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { ERROR_LABEL, fmtClock, fmtSec } from '../lib/format';
import { useApi } from '../lib/useApi';
import { Markdown } from './Markdown';
import { Badge, DifficultyBadge, ErrorBox, OriginBadge, Spinner, StateBadge, Tabs } from './ui';

export interface AttemptResult {
  attemptId: string;
  correct: boolean;
  correctAnswer: string;
  errorLogId: string | null;
  mastery: { score: number; state: string; reason: string };
}

interface Props {
  questionId: string;
  context?: 'practice' | 'lesson' | 'diagnostic' | 'revision' | 'drill' | 'error_test';
  contextId?: string;
  timed?: boolean;
  /** When the passage/set is already on screen (reading/DILR labs). */
  hideGroup?: boolean;
  onAnswered?: (r: AttemptResult) => void;
  onNext?: () => void;
  nextLabel?: string;
}

export function useElapsed(running: boolean) {
  const [sec, setSec] = useState(0);
  const start = useRef(Date.now());
  useEffect(() => {
    if (!running) return;
    start.current = Date.now() - sec * 1000;
    const t = setInterval(() => setSec(Math.floor((Date.now() - start.current) / 1000)), 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);
  return [sec, setSec] as const;
}

export function QuestionPlayer({ questionId, context = 'practice', contextId, timed = false, hideGroup = false, onAnswered, onNext, nextLabel = 'Next question' }: Props) {
  const q = useApi(`/api/questions/${questionId}`);
  const [answer, setAnswer] = useState('');
  const [confidence, setConfidence] = useState<1 | 2 | 3 | null>(null);
  const [guessed, setGuessed] = useState(false);
  const [hints, setHints] = useState<string[]>([]);
  const [hintTotal, setHintTotal] = useState<number | null>(null);
  const [result, setResult] = useState<AttemptResult | null>(null);
  const [solution, setSolution] = useState<any>(null);
  const [revealAsk, setRevealAsk] = useState(false);
  const [err, setErr] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useElapsed(!result && !solution && !!q.data);
  const nav = useNavigate();

  useEffect(() => {
    setAnswer('');
    setConfidence(null);
    setGuessed(false);
    setHints([]);
    setHintTotal(null);
    setResult(null);
    setSolution(null);
    setRevealAsk(false);
    setErr(null);
    setElapsed(0);
  }, [questionId, setElapsed]);

  if (q.loading && !q.data) return <Spinner label="Loading question" />;
  if (q.error) return <ErrorBox error={q.error} onRetry={q.reload} />;
  const d = q.data;
  if (!d) return null;
  const done = !!result || !!solution;
  const limit = d.estimated_time_sec;

  const loadSolution = async (reveal = false) => {
    try {
      setSolution(await api.get(`/api/questions/${questionId}/solution${reveal ? '?reveal=true' : ''}`));
    } catch (e) {
      setErr(e as Error);
    }
  };

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post<AttemptResult>(`/api/questions/${questionId}/attempts`, {
        answer: answer.trim() === '' ? null : answer.trim(),
        timeTakenSec: elapsed,
        confidence: confidence ?? undefined,
        guessed,
        timed,
        hintsUsed: hints.length,
        context,
        contextId,
      });
      setResult(r);
      onAnswered?.(r);
      await loadSolution();
    } catch (e) {
      setErr(e as Error);
    } finally {
      setBusy(false);
    }
  };

  const nextHint = async () => {
    try {
      const r = await api.get(`/api/questions/${questionId}/hints?count=${hints.length + 1}`);
      setHints(r.hints);
      setHintTotal(r.total);
    } catch (e) {
      setErr(e as Error);
    }
  };

  const toggleBookmark = async () => {
    if (d.bookmarked) await api.del(`/api/questions/${questionId}/bookmark`);
    else await api.post(`/api/questions/${questionId}/bookmark`);
    q.setData({ ...d, bookmarked: !d.bookmarked });
  };

  const askTutor = async () => {
    const s = await api.post('/api/tutor/sessions', { contextType: 'question', contextId: questionId, title: `Question ${d.external_id}` });
    nav(`/tutor/${s.id}`);
  };

  const body = (
    <div>
      <div className="row-between mb">
        <div className="row">
          <Badge tone="accent">{d.section_id}</Badge>
          <Link to={`/syllabus/${d.topic_id}`} className="small">
            {d.topic_name}
          </Link>
          <DifficultyBadge d={d.difficulty} />
          <Badge tone="outline">{d.question_type === 'TITA' ? 'TITA (type in answer)' : 'MCQ'}</Badge>
          <OriginBadge origin={d.origin} year={d.exam_year} slot={d.exam_slot} verification={d.source_verification} />
          {d.solution_verification !== 'verified' && <Badge tone="warn">Solution not yet verified</Badge>}
        </div>
        <div className="row">
          {!done && (
            <span className={`timer ${timed && elapsed > limit ? 'low' : ''}`} aria-label="Time on this question">
              {timed ? `${fmtClock(Math.max(0, limit - elapsed))} left` : fmtClock(elapsed)}
            </span>
          )}
          <button className="btn btn-sm" onClick={() => void toggleBookmark()} aria-pressed={d.bookmarked}>
            {d.bookmarked ? '★ Bookmarked' : '☆ Bookmark'}
          </button>
        </div>
      </div>
      {d.sources?.length > 0 && (
        <p className="tiny muted">
          Source: {d.sources.map((s: any) => `${s.source_name}${s.reference ? ` (${s.reference})` : ''}${s.verified ? '' : ' — unverified'}`).join('; ')}
        </p>
      )}
      <Markdown text={d.stem_md} />

      {d.question_type === 'MCQ' ? (
        <ul className="options" role="radiogroup" aria-label="Answer options">
          {d.options.map((o: any) => {
            const isAns = result?.correctAnswer === o.key || (solution && solution.correct_answer === o.key);
            const cls = done ? (isAns ? 'correct' : answer === o.key ? 'wrong' : '') : answer === o.key ? 'selected' : '';
            return (
              <li key={o.key}>
                <label className={`option ${cls}`}>
                  <input type="radio" name={`opt-${questionId}`} value={o.key} checked={answer === o.key} disabled={done} onChange={() => setAnswer(o.key)} />
                  <span className="option-key">{o.key}</span>
                  <Markdown text={o.text_md} inline />
                </label>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="field mt">
          <label htmlFor={`tita-${questionId}`}>Your answer</label>
          <input id={`tita-${questionId}`} inputMode="decimal" autoComplete="off" value={answer} disabled={done} onChange={(e) => setAnswer(e.target.value)} style={{ maxWidth: 220 }} />
        </div>
      )}

      {!done && (
        <>
          <fieldset>
            <legend>Before you submit</legend>
            <div className="row">
              <span className="small">Confidence:</span>
              {([1, 2, 3] as const).map((c) => (
                <label key={c} className="check">
                  <input type="radio" name={`conf-${questionId}`} checked={confidence === c} onChange={() => setConfidence(c)} /> {['Low', 'Medium', 'High'][c - 1]}
                </label>
              ))}
              <label className="check">
                <input type="checkbox" checked={guessed} onChange={(e) => setGuessed(e.target.checked)} /> I guessed
              </label>
            </div>
          </fieldset>
          {hints.length > 0 && (
            <div className="alert alert-info">
              <strong>Hints</strong>
              <ol style={{ margin: '4px 0 0', paddingLeft: 20 }}>
                {hints.map((h, i) => (
                  <li key={i}>
                    <Markdown text={h} inline />
                  </li>
                ))}
              </ol>
            </div>
          )}
          <div className="row">
            <button className="btn btn-primary" onClick={() => void submit()} disabled={busy}>
              {answer ? 'Submit answer' : 'Submit without answering'}
            </button>
            <button className="btn" onClick={() => void nextHint()} disabled={hintTotal !== null && hints.length >= hintTotal}>
              {hints.length ? 'Next hint' : 'Show a hint'}
            </button>
            {!revealAsk ? (
              <button className="btn btn-ghost" onClick={() => setRevealAsk(true)}>
                Reveal solution
              </button>
            ) : (
              <span className="row small">
                Revealing first means later attempts on this question will not count toward mastery.
                <button className="btn btn-sm" onClick={() => void loadSolution(true)}>
                  Reveal
                </button>
                <button className="btn btn-sm btn-ghost" onClick={() => setRevealAsk(false)}>
                  Cancel
                </button>
              </span>
            )}
          </div>
        </>
      )}
      <ErrorBox error={err} />
      {result && <ResultPanel result={result} elapsed={elapsed} estimate={limit} questionId={questionId} />}
      {solution && <SolutionView solution={solution} chosen={answer} type={d.question_type} />}
      {done && (
        <div className="row mt">
          {onNext && (
            <button className="btn btn-primary" onClick={onNext}>
              {nextLabel}
            </button>
          )}
          <button className="btn" onClick={() => void askTutor()}>
            Ask the tutor about this
          </button>
          <NoteBox questionId={questionId} notes={d.notes} />
        </div>
      )}
    </div>
  );

  if (d.group && !hideGroup) {
    return (
      <div className="split">
        <div className="card sticky">
          <div className="row-between">
            <h3>{d.group.title}</h3>
            <OriginBadge origin={d.group.origin} year={d.group.exam_year} slot={d.group.exam_slot} />
          </div>
          <div className="passage-text">
            <Markdown text={d.group.body_md} />
          </div>
          <Link className="small" to={d.group.kind === 'passage' ? `/reading/${d.group.id}` : `/dilr/${d.group.id}`}>
            Open the full {d.group.kind === 'passage' ? 'passage' : 'set'} in the lab
          </Link>
        </div>
        <div className="card">{body}</div>
      </div>
    );
  }
  return <div className="card">{body}</div>;
}

function ResultPanel({ result, elapsed, estimate, questionId }: { result: AttemptResult; elapsed: number; estimate: number; questionId: string }) {
  const [understood, setUnderstood] = useState<boolean | null>(null);
  const [mistake, setMistake] = useState('');
  const [saved, setSaved] = useState(false);
  const save = async () => {
    await api.patch(`/api/questions/attempts/${result.attemptId}`, { understood: understood ?? undefined, mistakeType: mistake || undefined });
    setSaved(true);
  };
  return (
    <div className={`alert mt ${result.correct ? 'alert-good' : 'alert-error'}`} role="status">
      <div className="row-between">
        <strong>{result.correct ? 'Correct' : `Not correct. The answer is ${result.correctAnswer}.`}</strong>
        <span className="small">
          {fmtSec(elapsed)} (target {fmtSec(estimate)})
        </span>
      </div>
      <div className="small mt" style={{ color: 'var(--text)' }}>
        Topic mastery now: <StateBadge state={result.mastery.state} score={result.mastery.score} /> <span className="muted">{result.mastery.reason}</span>
      </div>
      <div className="mt" style={{ color: 'var(--text)' }}>
        <div className="row small">
          <span>After reading the solution, did you understand it?</span>
          <label className="check">
            <input type="radio" name={`u-${questionId}`} checked={understood === true} onChange={() => setUnderstood(true)} /> Yes
          </label>
          <label className="check">
            <input type="radio" name={`u-${questionId}`} checked={understood === false} onChange={() => setUnderstood(false)} /> Not yet
          </label>
        </div>
        {!result.correct && (
          <div className="row small mt">
            <label htmlFor={`m-${questionId}`} style={{ margin: 0 }}>
              What went wrong?
            </label>
            <select id={`m-${questionId}`} value={mistake} onChange={(e) => setMistake(e.target.value)}>
              <option value="">Choose a mistake type</option>
              {Object.entries(ERROR_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="row mt">
          <button className="btn btn-sm" disabled={saved || (understood === null && !mistake)} onClick={() => void save()}>
            {saved ? 'Reflection saved' : 'Save reflection'}
          </button>
          {!result.correct && result.errorLogId && (
            <Link className="small" to="/errors">
              Added to your error log
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

export function SolutionView({ solution, chosen, type }: { solution: any; chosen?: string; type: string }) {
  const [tab, setTab] = useState<'learn' | 'exam' | 'hints'>('learn');
  const s = solution.solution;
  if (!s) return <div className="alert alert-warn mt">No solution has been written for this question yet.</div>;
  return (
    <div className="mt">
      <Tabs
        label="Solution views"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'learn', label: 'Learn mode' },
          { id: 'exam', label: 'Exam method' },
          { id: 'hints', label: 'Hints' },
        ]}
      />
      {tab === 'learn' && (
        <div className="stack">
          {s.concepts_tested && (
            <p className="small">
              <strong>Concepts tested:</strong> {s.concepts_tested}
            </p>
          )}
          {s.prerequisites && (
            <p className="small">
              <strong>Prerequisites:</strong> {s.prerequisites}
            </p>
          )}
          <Markdown text={s.learn_md} />
          {s.verification_md && (
            <div>
              <h4>Check the answer</h4>
              <Markdown text={s.verification_md} />
            </div>
          )}
          {s.common_mistakes_md && (
            <div>
              <h4>Common mistakes</h4>
              <Markdown text={s.common_mistakes_md} />
            </div>
          )}
          {s.alternative_md && (
            <details>
              <summary>Alternative method</summary>
              <Markdown text={s.alternative_md} />
            </details>
          )}
          {s.advanced_md && (
            <details>
              <summary>Advanced insight</summary>
              <Markdown text={s.advanced_md} />
            </details>
          )}
        </div>
      )}
      {tab === 'exam' && (s.exam_method_md ? <Markdown text={s.exam_method_md} /> : <p className="muted">No separate exam method; the learn-mode solution is already the fastest reliable route.</p>)}
      {tab === 'hints' && (
        <ol>
          {s.hints.map((h: string, i: number) => (
            <li key={i}>
              <Markdown text={h} inline />
            </li>
          ))}
        </ol>
      )}
      {type === 'MCQ' && Object.keys(s.distractors ?? {}).length > 0 && (
        <div className="mt">
          <h4>Why the other options are wrong</h4>
          <ul>
            {Object.entries(s.distractors as Record<string, string>).map(([k, v]) => (
              <li key={k} style={{ fontWeight: chosen === k ? 600 : 400 }}>
                <strong>{k}</strong>
                {chosen === k ? ' (your choice)' : ''}: <Markdown text={v} inline />
              </li>
            ))}
          </ul>
        </div>
      )}
      {solution.prerequisiteTopics?.length > 0 && (
        <p className="small">
          Builds on:{' '}
          {solution.prerequisiteTopics.map((t: any, i: number) => (
            <span key={t.id}>
              {i ? ', ' : ''}
              <Link to={`/syllabus/${t.id}`}>{t.name}</Link>
            </span>
          ))}
        </p>
      )}
      {solution.related?.length > 0 && (
        <p className="small">
          Similar questions:{' '}
          {solution.related.map((r: any, i: number) => (
            <span key={r.id}>
              {i ? ' · ' : ''}
              <Link to={`/practice/${r.id}`}>{r.external_id}</Link>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

function NoteBox({ questionId, notes }: { questionId: string; notes: any[] }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [list, setList] = useState(notes ?? []);
  const add = async () => {
    const n = await api.post('/api/notes', { body: text, questionId });
    setList([...list, n]);
    setText('');
  };
  if (!open)
    return (
      <button className="btn" onClick={() => setOpen(true)}>
        Notes ({list.length})
      </button>
    );
  return (
    <div style={{ flexBasis: '100%' }} className="mt">
      {list.map((n) => (
        <div key={n.id} className="small card" style={{ padding: 10, marginBottom: 8 }}>
          {n.body}
        </div>
      ))}
      <label htmlFor={`note-${questionId}`}>Add a note</label>
      <textarea id={`note-${questionId}`} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="row mt">
        <button className="btn btn-sm" disabled={!text.trim()} onClick={() => void add()}>
          Save note
        </button>
        <button className="btn btn-sm btn-ghost" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
    </div>
  );
}
