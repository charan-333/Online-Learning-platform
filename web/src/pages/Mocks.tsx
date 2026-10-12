import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { BarChart } from '../components/Charts';
import { Markdown } from '../components/Markdown';
import { Badge, Card, Empty, ErrorBox, OriginBadge, PageHeader, Spinner, Stat } from '../components/ui';
import { api } from '../lib/api';
import { fmtClock, fmtDate, fmtSec } from '../lib/format';
import { useApi } from '../lib/useApi';

export function Mocks() {
  const list = useApi('/api/mocks');
  const configs = useApi('/api/exam-configs');
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [f, setF] = useState({ kind: params.get('create') ?? 'sectional', sections: ['QA'] as string[], questionCount: 10, durationMin: 20, year: '', slot: '' });
  const [err, setErr] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const cfg = configs.data?.items?.[0];

  const start = useCallback(
    async (testId: string) => {
      setErr(null);
      try {
        const s = await api.post(`/api/mocks/${testId}/start`);
        nav(`/mocks/run/${s.attempt.id}`);
      } catch (e) {
        setErr(e as Error);
      }
    },
    [nav],
  );
  useEffect(() => {
    const s = params.get('started');
    if (s) void start(s);
  }, [params, start]);

  const create = async () => {
    setBusy(true);
    setErr(null);
    try {
      const body: any = { kind: f.kind };
      if (f.kind === 'pyq_paper') Object.assign(body, { year: Number(f.year) || undefined, slot: Number(f.slot) || undefined });
      else if (f.kind !== 'full') Object.assign(body, { sections: f.sections, questionCount: Number(f.questionCount), durationMin: Number(f.durationMin) });
      const t = await api.post('/api/mocks', body);
      await start(t.id);
    } catch (e) {
      setErr(e as Error);
    } finally {
      setBusy(false);
    }
  };

  if (list.loading && !list.data) return <Spinner />;
  const open = (list.data?.attempts ?? []).filter((a: any) => a.status === 'in_progress');
  const done = (list.data?.attempts ?? []).filter((a: any) => a.status === 'submitted');
  return (
    <div>
      <PageHeader title="Mock tests" subtitle="Server-timed tests with sectional locks, autosave, resume and full analysis." />
      <ErrorBox error={err ?? list.error} />
      {cfg && (
        <div className={`alert ${cfg.verification_status === 'verified' ? 'alert-info' : 'alert-warn'}`}>
          Exam pattern in use: {cfg.name} ({cfg.sections.map((s: any) => `${s.section_id} ${s.question_count}Q/${s.duration_min}m`).join(', ')}; MCQ +{cfg.sections[0]?.mcq_correct}/{cfg.sections[0]?.mcq_wrong}, TITA no negative).{' '}
          {cfg.verification_status !== 'verified' && 'This pattern has not been verified against the official notification for your exam year; an admin can update it.'}
        </div>
      )}
      {open.length > 0 && (
        <Card title="In progress">
          {open.map((a: any) => (
            <div key={a.id} className="row-between">
              <span>
                {a.title} <span className="small muted">started {fmtDate(a.started_at)}</span>
              </span>
              <Link className="btn btn-primary btn-sm" to={`/mocks/run/${a.id}`}>
                Resume
              </Link>
            </div>
          ))}
        </Card>
      )}
      <div className="grid grid-2">
        <Card title="Available tests">
          <ul className="list">
            {(list.data?.tests ?? []).map((t: any) => (
              <li key={t.id}>
                <div className="row-between">
                  <div>
                    <strong>{t.title}</strong> {t.platform && <Badge tone="accent">Platform</Badge>}
                    <div className="small muted">
                      {t.question_count} questions · {fmtSec(Number(t.duration_sec))} · {(t.sections ?? []).join(' → ')}
                      {t.sectional_lock ? ' · sectional lock' : ''}
                    </div>
                    {t.description && <div className="tiny muted">{t.description}</div>}
                  </div>
                  <button className="btn btn-sm" onClick={() => void start(t.id)}>
                    Start
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Create a test">
          <div className="field">
            <label htmlFor="mk-kind">Type</label>
            <select id="mk-kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
              <option value="sectional">Sectional</option>
              <option value="custom">Custom (choose sections)</option>
              <option value="full">Full test (all published questions in CAT order)</option>
              <option value="pyq_paper">Previous-year paper</option>
              <option value="error_test">Error retry test</option>
            </select>
          </div>
          {f.kind === 'pyq_paper' ? (
            <div className="row">
              <div className="field">
                <label htmlFor="mk-year">Year</label>
                <input id="mk-year" type="number" value={f.year} onChange={(e) => setF({ ...f, year: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="mk-slot">Slot</label>
                <input id="mk-slot" type="number" min={1} max={3} value={f.slot} onChange={(e) => setF({ ...f, slot: e.target.value })} />
              </div>
            </div>
          ) : f.kind !== 'full' ? (
            <>
              <fieldset>
                <legend>Sections</legend>
                {['VARC', 'DILR', 'QA'].map((s) => (
                  <label key={s} className="check">
                    <input type={f.kind === 'sectional' ? 'radio' : 'checkbox'} name="mk-sec" checked={f.sections.includes(s)} onChange={() => setF({ ...f, sections: f.kind === 'sectional' ? [s] : f.sections.includes(s) ? f.sections.filter((x) => x !== s) : [...f.sections, s] })} /> {s}
                  </label>
                ))}
              </fieldset>
              <div className="row">
                <div className="field">
                  <label htmlFor="mk-n">Questions per section</label>
                  <input id="mk-n" type="number" min={1} max={100} value={f.questionCount} onChange={(e) => setF({ ...f, questionCount: Number(e.target.value) })} />
                </div>
                <div className="field">
                  <label htmlFor="mk-d">Minutes per section</label>
                  <input id="mk-d" type="number" min={1} max={240} value={f.durationMin} onChange={(e) => setF({ ...f, durationMin: Number(e.target.value) })} />
                </div>
              </div>
            </>
          ) : null}
          <button className="btn btn-primary" disabled={busy} onClick={() => void create()}>
            Create and start
          </button>
        </Card>
      </div>
      <Card title="Past attempts">
        {done.length === 0 ? (
          <Empty>No completed tests yet.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Test</th>
                  <th>Date</th>
                  <th>Score</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {done.map((a: any) => (
                  <tr key={a.id}>
                    <td>{a.title}</td>
                    <td>{fmtDate(a.submitted_at)}</td>
                    <td>
                      {a.raw_score} / {a.max_score ?? '—'}
                    </td>
                    <td>
                      <Link to={`/mocks/analysis/${a.id}`}>Analysis</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

export function MockRun() {
  const { attemptId } = useParams();
  const nav = useNavigate();
  const st = useApi(`/api/mocks/attempts/${attemptId}`);
  const [local, setLocal] = useState<Record<string, { answer: string | null; flagged: boolean; visited: boolean }>>({});
  const [cur, setCur] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [saveErr, setSaveErr] = useState<string>('');
  const [confirm, setConfirm] = useState<'' | 'next' | 'submit'>('');
  const enteredAt = useRef(Date.now());
  const offset = useRef(0);

  useEffect(() => {
    if (!st.data) return;
    offset.current = new Date(st.data.attempt.serverNow).getTime() - Date.now();
    const m: typeof local = {};
    for (const r of st.data.responses) m[r.question_id] = { answer: r.answer, flagged: r.flagged, visited: r.visited };
    setLocal(m);
    if (st.data.attempt.status === 'submitted') nav(`/mocks/analysis/${attemptId}`, { replace: true });
  }, [st.data, attemptId, nav]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  const section = st.data?.sections?.[st.data.attempt.currentSection] ?? st.data?.sections?.find((s: any) => !s.locked);
  const visibleQs: any[] = useMemo(() => (st.data ? st.data.sections.filter((s: any) => !s.locked).flatMap((s: any) => s.questions.map((q: any) => ({ ...q, sectionIndex: s.index }))) : []), [st.data]);
  useEffect(() => {
    if (visibleQs.length && (!cur || !visibleQs.some((q) => q.id === cur))) setCur(visibleQs.find((q) => q.sectionIndex === st.data.attempt.currentSection)?.id ?? visibleQs[0].id);
  }, [visibleQs, cur, st.data]);

  const deadline = st.data?.attempt.deadline ? new Date(st.data.attempt.deadline).getTime() : null;
  const remaining = deadline ? Math.floor((deadline - (now + offset.current)) / 1000) : null;
  useEffect(() => {
    // When time runs out the server applies the section change or submission on the next read.
    if (remaining !== null && remaining < -2) void st.reload();
  }, [remaining !== null && remaining < -2]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (qid: string, patch: { answer?: string | null; flagged?: boolean }) => {
    const spent = Math.round((Date.now() - enteredAt.current) / 1000);
    enteredAt.current = Date.now();
    setLocal((l) => ({ ...l, [qid]: { answer: l[qid]?.answer ?? null, flagged: l[qid]?.flagged ?? false, visited: true, ...patch } }));
    try {
      await api.put(`/api/mocks/attempts/${attemptId}/responses/${qid}`, { ...patch, timeSpentSec: spent });
      setSaveErr('');
    } catch (e) {
      setSaveErr((e as Error).message);
      if ((e as any).status === 409 || (e as any).status === 403) void st.reload();
    }
  };
  const goTo = async (qid: string) => {
    if (cur && cur !== qid) await save(cur, {});
    setCur(qid);
  };

  if (st.loading && !st.data) return <Spinner label="Loading test" />;
  if (st.error) return <ErrorBox error={st.error} />;
  const d = st.data;
  const q = visibleQs.find((x) => x.id === cur);
  const sectionIdx = d.attempt.currentSection;
  const lastSection = sectionIdx >= d.sections.length - 1;
  const group = q?.passage_id ? d.passages.find((p: any) => p.id === q.passage_id) : q?.dilr_set_id ? d.sets.find((s: any) => s.id === q.dilr_set_id) : null;
  const r = q ? local[q.id] : undefined;

  const nextSection = async () => {
    if (cur) await save(cur, {});
    await api.post(`/api/mocks/attempts/${attemptId}/next-section`);
    setConfirm('');
    setCur(null);
    st.reload();
  };
  const submit = async () => {
    if (cur) await save(cur, {});
    await api.post(`/api/mocks/attempts/${attemptId}/submit`);
    nav(`/mocks/analysis/${attemptId}`);
  };

  const answerBox = q && (
    <div className="card">
      <div className="row-between mb">
        <div className="row">
          <strong>Q{q.position}</strong>
          <Badge tone="outline">{q.question_type}</Badge>
          <span className="small muted">
            +{q.marksCorrect} / {q.question_type === 'MCQ' ? q.marksWrong : 0}
          </span>
          <OriginBadge origin={q.origin} year={q.exam_year} slot={q.exam_slot} />
        </div>
        <button className="btn btn-sm" aria-pressed={!!r?.flagged} onClick={() => void save(q.id, { flagged: !r?.flagged })}>
          {r?.flagged ? '⚑ Flagged' : '⚐ Flag for review'}
        </button>
      </div>
      <Markdown text={q.stem_md} />
      {q.question_type === 'MCQ' ? (
        <ul className="options" role="radiogroup" aria-label="Answer options">
          {(q.options ?? []).map((o: any) => (
            <li key={o.key}>
              <label className={`option ${r?.answer === o.key ? 'selected' : ''}`}>
                <input type="radio" name={`m-${q.id}`} checked={r?.answer === o.key} onChange={() => void save(q.id, { answer: o.key })} />
                <span className="option-key">{o.key}</span>
                <Markdown text={o.text_md} inline />
              </label>
            </li>
          ))}
        </ul>
      ) : (
        <TitaInput key={q.id} value={r?.answer ?? ''} onCommit={(v) => void save(q.id, { answer: v || null })} />
      )}
      <div className="row">
        <button className="btn btn-sm" onClick={() => void save(q.id, { answer: null })} disabled={!r?.answer}>
          Clear response
        </button>
        {(() => {
          const i = visibleQs.findIndex((x) => x.id === q.id);
          return (
            <>
              <button className="btn btn-sm" disabled={i <= 0} onClick={() => void goTo(visibleQs[i - 1].id)}>
                Previous
              </button>
              <button className="btn btn-sm btn-primary" disabled={i >= visibleQs.length - 1} onClick={() => void goTo(visibleQs[i + 1].id)}>
                Save and next
              </button>
            </>
          );
        })()}
      </div>
    </div>
  );

  return (
    <div>
      <div className="row-between mb">
        <div>
          <h1 style={{ margin: 0 }}>{d.test.title}</h1>
          <div className="small muted">
            Section {sectionIdx + 1} of {d.sections.length}: {section?.sectionId} {d.test.sectionalLock ? '(locked sections)' : ''}
          </div>
        </div>
        <div className="row">
          {remaining !== null && (
            <span className={`timer ${remaining < 300 ? 'low' : ''}`} role="timer" aria-live={remaining < 60 ? 'polite' : 'off'}>
              {fmtClock(Math.max(0, remaining))}
            </span>
          )}
          {d.test.sectionalLock && !lastSection ? (
            <button className="btn" onClick={() => setConfirm('next')}>
              Next section
            </button>
          ) : null}
          <button className="btn btn-danger" onClick={() => setConfirm('submit')}>
            Submit test
          </button>
        </div>
      </div>
      {confirm && (
        <div className="alert alert-warn" role="alertdialog" aria-label="Confirm">
          {confirm === 'next' ? 'Move to the next section? You cannot return to this one.' : 'Submit the whole test now?'}{' '}
          {visibleQs.filter((x) => !local[x.id]?.answer).length} unanswered, {visibleQs.filter((x) => local[x.id]?.flagged).length} flagged in view.
          <div className="row mt">
            <button className="btn btn-sm btn-primary" onClick={() => void (confirm === 'next' ? nextSection() : submit())}>
              Yes
            </button>
            <button className="btn btn-sm" onClick={() => setConfirm('')}>
              Keep working
            </button>
          </div>
        </div>
      )}
      {saveErr && <div className="alert alert-error">Could not save: {saveErr}</div>}
      <div className="card">
        <div className="small muted mb">
          Question palette · <span style={{ color: 'var(--good)' }}>green</span> answered · <span style={{ color: 'var(--bad)' }}>red</span> visited, not answered · dot = flagged
        </div>
        <div className="palette">
          {visibleQs.map((x, n) => (
            <button
              key={x.id}
              className={`${local[x.id]?.answer ? 'answered' : ''} ${local[x.id]?.flagged ? 'flagged' : ''} ${local[x.id]?.visited ? 'visited' : ''} ${x.id === cur ? 'current' : ''}`}
              onClick={() => void goTo(x.id)}
              aria-label={`Question ${n + 1}${local[x.id]?.answer ? ', answered' : ''}${local[x.id]?.flagged ? ', flagged' : ''}`}
            >
              {n + 1}
            </button>
          ))}
        </div>
      </div>
      {group ? (
        <div className="split">
          <div className="card sticky">
            <h3>{group.title}</h3>
            <Markdown text={group.body_md} />
          </div>
          {answerBox}
        </div>
      ) : (
        answerBox
      )}
    </div>
  );
}

function TitaInput({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [v, setV] = useState(value);
  return (
    <div className="field mt">
      <label htmlFor="tita-mock">Type your answer</label>
      <div className="row">
        <input id="tita-mock" inputMode="decimal" autoComplete="off" value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onCommit(v.trim())} style={{ maxWidth: 220 }} />
        <button className="btn btn-sm" onClick={() => onCommit(v.trim())}>
          Save answer
        </button>
      </div>
    </div>
  );
}

const CLASS_TONE: Record<string, any> = {
  correct_efficient: 'good',
  correct_slow: 'warn',
  incorrect_adequate_time: 'bad',
  incorrect_conceptual_gap: 'bad',
  incorrect_careless: 'bad',
  skipped_appropriately: 'info',
  skipped_despite_ability: 'warn',
  attempted_low_expected_value: 'bad',
};

export function MockAnalysis() {
  const { attemptId } = useParams();
  const a = useApi(`/api/mocks/attempts/${attemptId}/analysis`);
  const [filter, setFilter] = useState('');
  if (a.loading && !a.data) return <Spinner />;
  if (a.error) return <ErrorBox error={a.error} />;
  const s = a.data.summary;
  const t = s.totals;
  const qs = (s.questions as any[]).filter((q) => !filter || q.classification === filter);
  return (
    <div>
      <PageHeader title={`Analysis: ${a.data.title}`} subtitle={`${fmtDate(a.data.submitted_at)} · ${a.data.submit_reason === 'timeout' ? 'submitted automatically when time ran out' : 'submitted by you'}`} />
      <div className="grid grid-4 mb">
        <Card>
          <Stat label="Score" value={`${t.rawScore} / ${t.maxScore}`} />
        </Card>
        <Card>
          <Stat label="Accuracy" value={t.accuracy === null ? '—' : `${t.accuracy}%`} hint={`${t.correct} correct, ${t.wrong} wrong, ${t.unanswered} skipped`} />
        </Card>
        <Card>
          <Stat label="Negative marks" value={t.negativeMarks} />
        </Card>
        <Card>
          <Stat label="Selection quality" value={t.selectionQuality === null ? '—' : `${t.selectionQuality}%`} hint="Attempts with positive expected value" />
        </Card>
      </div>
      <div className="alert alert-info">{s.percentileNote}</div>
      <div className="grid grid-2">
        <Card title="By section">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Section</th>
                  <th>Score</th>
                  <th>Accuracy</th>
                  <th>Attempt rate</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {s.sections.map((x: any) => (
                  <tr key={x.sectionId}>
                    <td>{x.sectionId}</td>
                    <td>
                      {x.score} / {x.max}
                    </td>
                    <td>{x.accuracy === null ? '—' : `${x.accuracy}%`}</td>
                    <td>{x.attemptRate}%</td>
                    <td>{fmtSec(x.timeSec)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="Recommendations">
          {s.recommendations.length === 0 ? (
            <p className="small">No specific changes suggested from this attempt.</p>
          ) : (
            <ul>
              {s.recommendations.map((r: any) => (
                <li key={r.id} className="small">
                  {r.text}
                </li>
              ))}
            </ul>
          )}
          {s.followUp?.length > 0 && (
            <>
              <h4>Did last time’s advice work?</h4>
              <ul>
                {s.followUp.map((r: any) => (
                  <li key={r.id} className="small">
                    {r.text} — before {r.before ?? '—'}, now {r.after ?? '—'}{' '}
                    <Badge tone={r.improved ? 'good' : r.improved === false ? 'bad' : ''}>{r.improved ? 'improved' : r.improved === false ? 'not yet' : 'n/a'}</Badge>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </div>
      <Card title="Question types in this attempt">
        <BarChart label="Questions by classification" data={Object.entries(s.classificationCounts).map(([k, v]) => ({ label: k.replace(/_/g, ' '), value: Number(v) }))} />
      </Card>
      <Card
        title="Every question"
        actions={
          <select aria-label="Filter by classification" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">All</option>
            {Object.keys(s.classificationCounts).map((k) => (
              <option key={k} value={k}>
                {k.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        }
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Question</th>
                <th>Topic</th>
                <th>You</th>
                <th>Answer</th>
                <th>Marks</th>
                <th>Time</th>
                <th>Classification</th>
              </tr>
            </thead>
            <tbody>
              {qs.map((q: any) => (
                <tr key={q.questionId}>
                  <td>
                    <Link to={`/practice/${q.questionId}`}>{q.externalId}</Link>
                    {q.flagged && ' ⚑'}
                  </td>
                  <td className="small">{q.topicName}</td>
                  <td>{q.answer ?? '—'}</td>
                  <td>{q.correctAnswer}</td>
                  <td>{q.marks}</td>
                  <td className="small">
                    {fmtSec(q.timeSec)} / {fmtSec(q.estimatedSec)}
                  </td>
                  <td>
                    <Badge tone={CLASS_TONE[q.classification] ?? ''}>{q.classificationLabel}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="grid grid-2">
        <Card title="Strengths">{s.strengths.length ? <p className="small">{s.strengths.join(', ')}</p> : <p className="small muted">None with full accuracy in this attempt.</p>}</Card>
        <Card title="Weak areas">{s.weaknesses.length ? <p className="small">{s.weaknesses.join(', ')}</p> : <p className="small muted">No wrong answers.</p>}</Card>
      </div>
    </div>
  );
}
