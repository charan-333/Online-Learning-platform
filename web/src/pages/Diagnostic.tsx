import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Markdown } from '../components/Markdown';
import { Badge, Card, ErrorBox, PageHeader, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtClock } from '../lib/format';
import { useApi } from '../lib/useApi';

export function Diagnostic() {
  const d = useApi('/api/diagnostic');
  const { refresh } = useAuth();
  const [started, setStarted] = useState(false);
  const [i, setI] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [times, setTimes] = useState<Record<string, number>>({});
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const [clock, setClock] = useState(0);
  const enteredAt = useRef(Date.now());
  const startedAt = useRef(Date.now());

  useEffect(() => {
    if (!started || result) return;
    const t = setInterval(() => setClock(Math.floor((Date.now() - startedAt.current) / 1000)), 1000);
    return () => clearInterval(t);
  }, [started, result]);

  if (d.loading && !d.data) return <Spinner />;
  if (d.error) return <ErrorBox error={d.error} />;
  const qs = d.data.questions as any[];
  const q = qs[i];

  const leave = () => {
    const spent = Math.round((Date.now() - enteredAt.current) / 1000);
    setTimes((t) => ({ ...t, [q.id]: (t[q.id] ?? 0) + spent }));
    enteredAt.current = Date.now();
  };
  const go = (n: number) => {
    leave();
    setI(n);
  };
  const submit = async () => {
    leave();
    setBusy(true);
    setErr(null);
    try {
      const spent = Math.round((Date.now() - enteredAt.current) / 1000);
      const r = await api.post('/api/diagnostic/submit', {
        responses: qs.map((x) => ({ questionId: x.id, answer: answers[x.id]?.trim() || null, timeTakenSec: (times[x.id] ?? 0) + (x.id === q.id ? spent : 0) })),
      });
      setResult(r);
      await refresh();
    } catch (e) {
      setErr(e as Error);
    } finally {
      setBusy(false);
    }
  };

  if (result)
    return (
      <div>
        <PageHeader title="Diagnostic results" subtitle={result.caveat} />
        <div className="grid grid-3">
          {result.sections.map((s: any) => (
            <Card key={s.sectionId} title={s.sectionId}>
              <div className="stat-value">{s.accuracy}%</div>
              <div className="small muted">
                {s.correct} of {s.attempted} correct · pace {s.speed ?? '—'}% of target
              </div>
              <p className="small mt">{s.interpretation}</p>
              <Badge tone={s.suggestedMode === 'B' ? 'good' : 'accent'}>{s.suggestedMode === 'B' ? 'Mode B: high-performance practice' : 'Mode A: foundation first'}</Badge>
            </Card>
          ))}
        </div>
        <Card>
          <p>Your study plan has been built from these results. Every question is now in your history, and wrong answers are in your error log.</p>
          <div className="row">
            <Link className="btn btn-primary" to="/plan">
              See my plan
            </Link>
            <Link className="btn" to="/errors">
              Review mistakes
            </Link>
          </div>
        </Card>
      </div>
    );

  if (!started)
    return (
      <div>
        <PageHeader title="Diagnostic" />
        <Card>
          <p>
            {qs.length} questions, about {d.data.estimatedMinutes} minutes: QA across areas, one reading passage, one verbal item and one complete DILR set. Answers and solutions are shown only after you submit.
          </p>
          <p className="small muted">{d.data.note}</p>
          {d.data.completedAt && <div className="alert alert-info">You completed the diagnostic on {new Date(d.data.completedAt).toLocaleDateString()}. You can retake it a week after the last attempt.</div>}
          <button className="btn btn-primary" onClick={() => ((startedAt.current = enteredAt.current = Date.now()), setStarted(true))}>
            Start
          </button>
        </Card>
      </div>
    );

  const group = q.passage_id ? d.data.passages.find((p: any) => p.id === q.passage_id) : q.dilr_set_id ? d.data.sets.find((s: any) => s.id === q.dilr_set_id) : null;
  const body = (
    <div className="card">
      <div className="row-between mb">
        <div className="row">
          <Badge tone="accent">{q.section_id}</Badge>
          <span className="small">{q.topic_name}</span>
          <Badge tone="outline">Original practice</Badge>
        </div>
        <span className="timer">{fmtClock(clock)}</span>
      </div>
      <Markdown text={q.stem_md} />
      {q.question_type === 'MCQ' ? (
        <ul className="options" role="radiogroup" aria-label="Answer options">
          {(q.options ?? []).map((o: any) => (
            <li key={o.key}>
              <label className={`option ${answers[q.id] === o.key ? 'selected' : ''}`}>
                <input type="radio" name={`d-${q.id}`} checked={answers[q.id] === o.key} onChange={() => setAnswers({ ...answers, [q.id]: o.key })} />
                <span className="option-key">{o.key}</span>
                <Markdown text={o.text_md} inline />
              </label>
            </li>
          ))}
        </ul>
      ) : (
        <div className="field mt">
          <label htmlFor={`d-${q.id}`}>Your answer</label>
          <input id={`d-${q.id}`} inputMode="decimal" value={answers[q.id] ?? ''} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} style={{ maxWidth: 220 }} />
        </div>
      )}
      <ErrorBox error={err} />
      <div className="row">
        <button className="btn" disabled={i === 0} onClick={() => go(i - 1)}>
          Previous
        </button>
        {i < qs.length - 1 ? (
          <button className="btn btn-primary" onClick={() => go(i + 1)}>
            Next
          </button>
        ) : (
          <button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>
            Submit diagnostic
          </button>
        )}
        <span className="small muted">
          {Object.values(answers).filter((a) => a.trim()).length} of {qs.length} answered
        </span>
      </div>
    </div>
  );
  return (
    <div>
      <div className="palette mb" style={{ maxWidth: 600 }}>
        {qs.map((x, n) => (
          <button key={x.id} className={`${answers[x.id] ? 'answered' : ''} ${n === i ? 'current' : ''}`} onClick={() => go(n)} aria-label={`Question ${n + 1}`}>
            {n + 1}
          </button>
        ))}
      </div>
      {group ? (
        <div className="split">
          <div className="card sticky">
            <h3>{group.title}</h3>
            <Markdown text={group.body_md} />
          </div>
          {body}
        </div>
      ) : (
        body
      )}
    </div>
  );
}
