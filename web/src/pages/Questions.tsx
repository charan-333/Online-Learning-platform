import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Markdown } from '../components/Markdown';
import { QuestionPlayer, type AttemptResult } from '../components/QuestionPlayer';
import { Badge, Card, DifficultyBadge, Empty, ErrorBox, OriginBadge, PageHeader, Spinner, StateBadge } from '../components/ui';
import { api, qs } from '../lib/api';
import { fmtSec, ORIGIN_LABEL, STATE_LABEL } from '../lib/format';
import { useApi } from '../lib/useApi';

const FILTER_KEYS = ['q', 'section', 'topic', 'difficulty', 'type', 'origin', 'year', 'slot', 'sourceVerification', 'attempted', 'result', 'previouslyIncorrect', 'bookmarked', 'mastery', 'minTimeSec', 'maxTimeSec', 'sort'] as const;

function useFilters() {
  const [params, setParams] = useSearchParams();
  const f = Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) ?? ''])) as Record<(typeof FILTER_KEYS)[number], string>;
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    p.delete('page');
    setParams(p, { replace: true });
  };
  return { f, set, params, setParams };
}

export function QuestionBank() {
  const { f, set, params, setParams } = useFilters();
  const page = Number(params.get('page') ?? 1);
  const topics = useApi('/api/topics');
  const facets = useApi('/api/questions/facets');
  const list = useApi(`/api/questions${qs({ ...f, page, pageSize: 25 })}`);
  const [search, setSearch] = useState(f.q);
  const filterQs = qs(f);
  const topicOpts = (topics.data?.items ?? []).filter((t: any) => !f.section || t.section_id === f.section);
  const pyqCount = (facets.data?.origins ?? []).filter((o: any) => o.origin === 'authentic_pyq').reduce((s: number, o: any) => s + Number(o.n), 0);

  const sel = (k: (typeof FILTER_KEYS)[number], label: string, opts: [string, string][]) => (
    <div className="field" style={{ minWidth: 150 }}>
      <label htmlFor={`f-${k}`}>{label}</label>
      <select id={`f-${k}`} value={f[k]} onChange={(e) => set(k, e.target.value)}>
        <option value="">Any</option>
        {opts.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <div>
      <PageHeader
        title="Question bank"
        subtitle={`${list.data?.total ?? '…'} matching question(s)`}
        actions={
          <Link className="btn btn-primary" to={`/practice${filterQs}`}>
            Practise these
          </Link>
        }
      />
      {facets.data && pyqCount === 0 && (
        <div className="alert alert-warn">
          The bank has no authentic CAT PYQs yet. All {facets.data.sections.reduce((s: number, x: any) => s + Number(x.n), 0)} questions are CAT 100 original practice, labelled on every card. Year and slot filters will work once verified PYQs are imported.
        </div>
      )}
      <Card>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            set('q', search);
          }}
        >
          <label htmlFor="qb-search" className="sr-only">
            Search questions
          </label>
          <input id="qb-search" type="search" placeholder="Search question text or ID" value={search} onChange={(e) => setSearch(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
          <button className="btn">Search</button>
          <button type="button" className="btn btn-ghost" onClick={() => (setSearch(''), setParams({}))}>
            Clear filters
          </button>
        </form>
        <div className="row mt" style={{ alignItems: 'flex-end' }}>
          {sel('section', 'Section', [
            ['QA', 'QA'],
            ['VARC', 'VARC'],
            ['DILR', 'DILR'],
          ])}
          {sel('topic', 'Topic', topicOpts.map((t: any) => [t.id, t.name]))}
          {sel('difficulty', 'Difficulty', [
            ['easy', 'Easy'],
            ['medium', 'Medium'],
            ['difficult', 'Difficult'],
            ['advanced', 'Advanced'],
          ])}
          {sel('type', 'Format', [
            ['MCQ', 'MCQ'],
            ['TITA', 'TITA'],
          ])}
          {sel('origin', 'Source type', Object.entries(ORIGIN_LABEL))}
          {sel('year', 'Year', [...new Set((facets.data?.years ?? []).map((y: any) => String(y.year)))].map((y) => [y, y] as [string, string]))}
          {sel('slot', 'Slot', [
            ['1', 'Slot 1'],
            ['2', 'Slot 2'],
            ['3', 'Slot 3'],
          ])}
          {sel('sourceVerification', 'Source check', [
            ['verified', 'Verified'],
            ['unverified', 'Unverified'],
            ['not_applicable', 'Not a PYQ'],
          ])}
          {sel('attempted', 'Attempted', [
            ['true', 'Attempted'],
            ['false', 'Not attempted'],
          ])}
          {sel('result', 'Last result', [
            ['correct', 'Correct'],
            ['incorrect', 'Incorrect'],
          ])}
          {sel('previouslyIncorrect', 'Ever wrong', [['true', 'Previously incorrect']])}
          {sel('bookmarked', 'Bookmarked', [['true', 'Bookmarked']])}
          {sel('mastery', 'Topic mastery', Object.entries(STATE_LABEL))}
          {sel('maxTimeSec', 'Your avg time', [
            ['60', 'Under 1 min'],
            ['120', 'Under 2 min'],
            ['180', 'Under 3 min'],
          ])}
          {sel('minTimeSec', 'Slow (avg time)', [
            ['120', 'Over 2 min'],
            ['180', 'Over 3 min'],
          ])}
          {sel('sort', 'Sort', [
            ['difficulty', 'Hardest first'],
            ['year', 'Newest paper'],
            ['recent', 'Recently attempted'],
          ])}
        </div>
      </Card>
      <ErrorBox error={list.error} />
      {list.loading && !list.data ? (
        <Spinner />
      ) : list.data?.items.length === 0 ? (
        <Empty>No questions match these filters.</Empty>
      ) : (
        <>
          <ul className="list card">
            {list.data?.items.map((q: any) => (
              <li key={q.id}>
                <div className="row-between">
                  <div className="row">
                    <Link to={`/practice/${q.id}`}>
                      <strong>{q.external_id}</strong>
                    </Link>
                    <Badge tone="accent">{q.section_id}</Badge>
                    <span className="small">{q.topic_name}</span>
                    <DifficultyBadge d={q.difficulty} />
                    <Badge tone="outline">{q.question_type}</Badge>
                    <OriginBadge origin={q.origin} year={q.exam_year} slot={q.exam_slot} verification={q.source_verification} />
                    {q.bookmarked && <Badge tone="warn">★</Badge>}
                  </div>
                  <div className="row small">
                    {q.attempts > 0 ? (
                      <Badge tone={q.last_correct ? 'good' : 'bad'}>
                        {q.last_correct ? 'Last: correct' : 'Last: wrong'} · {q.attempts}×
                      </Badge>
                    ) : (
                      <span className="muted">Not attempted</span>
                    )}
                    {q.avg_time && <span className="muted">{fmtSec(q.avg_time)}</span>}
                    <StateBadge state={q.topic_state} />
                  </div>
                </div>
                <div className="small muted mt">
                  <Markdown text={q.stem_preview + (q.stem_preview.length >= 220 ? '…' : '')} inline />
                </div>
              </li>
            ))}
          </ul>
          <div className="row">
            <button className="btn btn-sm" disabled={page <= 1} onClick={() => setParams({ ...Object.fromEntries(params), page: String(page - 1) })}>
              Previous
            </button>
            <span className="small">
              Page {page} of {Math.max(1, Math.ceil((list.data?.total ?? 0) / 25))}
            </span>
            <button className="btn btn-sm" disabled={page * 25 >= (list.data?.total ?? 0)} onClick={() => setParams({ ...Object.fromEntries(params), page: String(page + 1) })}>
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** Deterministic shuffle (seeded) so a mixed session keeps its order on reload. */
function shuffle<T>(arr: T[], seed: number) {
  const a = [...arr];
  let s = seed || 1;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280;
    const j = Math.floor((s / 233280) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const DIFF_ORDER = ['easy', 'medium', 'difficult', 'advanced'];

export function Practice() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const mode = params.get('mode') ?? '';
  const timed = params.get('timed') === 'true' || mode === 'timed';
  const context = (params.get('context') as any) ?? 'practice';
  const filters = Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) ?? '']));
  const listUrl = id ? null : `/api/questions${qs({ ...filters, pageSize: 100 })}`;
  const list = useApi(listUrl);
  const [idx, setIdx] = useState(0);
  const [results, setResults] = useState<Record<string, boolean>>({});
  const seed = useMemo(() => Number(params.get('seed') ?? Date.now() % 100000), [params]);

  const ids: string[] = useMemo(() => {
    if (!list.data) return [];
    let items = list.data.items as any[];
    if (mode === 'ladder') items = [...items].sort((a, b) => DIFF_ORDER.indexOf(a.difficulty) - DIFF_ORDER.indexOf(b.difficulty));
    if (mode === 'mixed') items = shuffle(items, seed);
    // keep passages and sets together, in order
    const seen = new Set<string>();
    const out: string[] = [];
    for (const q of items) {
      const g = q.passage_id ?? q.dilr_set_id;
      if (g) {
        if (seen.has(g)) continue;
        seen.add(g);
        for (const x of items.filter((y) => (y.passage_id ?? y.dilr_set_id) === g)) out.push(x.id);
      } else out.push(q.id);
    }
    return out;
  }, [list.data, mode, seed]);

  useEffect(() => setIdx(0), [listUrl]);

  if (id) {
    return (
      <div>
        <div className="row mb">
          <button className="btn btn-sm btn-ghost" onClick={() => nav(-1)}>
            ← Back
          </button>
        </div>
        <QuestionPlayer questionId={id} context={context} timed={timed} />
      </div>
    );
  }
  if (list.loading && !list.data) return <Spinner label="Loading practice set" />;
  if (list.error) return <ErrorBox error={list.error} />;
  if (!ids.length)
    return (
      <Card title="Nothing to practise">
        <p>No questions match this practice set.</p>
        {params.get('origin') === 'authentic_pyq' && <p className="small">No authentic CAT PYQs have been imported yet. Try the same mode with “All practice questions”.</p>}
        <Link to="/modes">Back to practice modes</Link>
      </Card>
    );
  const done = Object.keys(results).length;
  const correct = Object.values(results).filter(Boolean).length;
  const finished = idx >= ids.length;
  return (
    <div>
      <div className="row-between mb">
        <div className="row">
          <strong>
            Question {Math.min(idx + 1, ids.length)} of {ids.length}
          </strong>
          {timed && <Badge tone="warn">Timed</Badge>}
          {mode && <Badge tone="outline">{mode}</Badge>}
        </div>
        <span className="small">
          {correct} correct of {done} answered
        </span>
      </div>
      {finished ? (
        <Card title="Session complete">
          <p>
            You answered {done} question(s), {correct} correctly. Wrong answers are in your <Link to="/errors">error log</Link> and <Link to="/revision">revision queue</Link>.
          </p>
          <Link className="btn" to="/modes">
            Choose another mode
          </Link>
        </Card>
      ) : (
        <QuestionPlayer
          key={ids[idx]}
          questionId={ids[idx]}
          context={context}
          timed={timed}
          onAnswered={(r: AttemptResult) => setResults((x) => ({ ...x, [ids[idx]]: r.correct }))}
          onNext={() => setIdx(idx + 1)}
          nextLabel={idx === ids.length - 1 ? 'Finish' : 'Next question'}
        />
      )}
    </div>
  );
}

const MODES: { id: string; title: string; text: string; build: (o: { origin: string; topic: string; year: string; slot: string; section: string }) => string | null; needs?: ('topic' | 'year' | 'slot' | 'section')[] }[] = [
  { id: 'topic', title: 'Topic-wise', text: 'All questions from one topic, easiest first.', needs: ['topic'], build: (o) => (o.topic ? `/practice${qs({ topic: o.topic, origin: o.origin, mode: 'ladder' })}` : null) },
  { id: 'year', title: 'Year-wise', text: 'Questions from one CAT year, in paper order.', needs: ['year'], build: (o) => (o.year ? `/practice${qs({ year: o.year, origin: 'authentic_pyq', sort: 'year' })}` : null) },
  { id: 'slot', title: 'Slot-wise', text: 'One year and slot.', needs: ['year', 'slot'], build: (o) => (o.year && o.slot ? `/practice${qs({ year: o.year, slot: o.slot, origin: 'authentic_pyq' })}` : null) },
  { id: 'ladder', title: 'Difficulty ladder', text: 'Easy → medium → difficult within a section.', needs: ['section'], build: (o) => `/practice${qs({ section: o.section, origin: o.origin, mode: 'ladder' })}` },
  { id: 'timed', title: 'Timed practice', text: 'Each question counts down from its target time.', needs: ['section'], build: (o) => `/practice${qs({ section: o.section, origin: o.origin, mode: 'timed' })}` },
  { id: 'untimed', title: 'Untimed learning', text: 'No countdown; use hints and full solutions.', needs: ['section'], build: (o) => `/practice${qs({ section: o.section, origin: o.origin })}` },
  { id: 'mixed', title: 'Mixed', text: 'Random order across topics, like the exam.', needs: ['section'], build: (o) => `/practice${qs({ section: o.section, origin: o.origin, mode: 'mixed' })}` },
  { id: 'incorrect', title: 'Previously incorrect', text: 'Questions you have got wrong before.', build: (o) => `/practice${qs({ previouslyIncorrect: 'true', origin: o.origin, section: o.section })}` },
  { id: 'unattempted', title: 'Unattempted', text: 'Questions you have never answered.', build: (o) => `/practice${qs({ attempted: 'false', origin: o.origin, section: o.section })}` },
  { id: 'bookmarked', title: 'Bookmarked', text: 'Your saved questions.', build: (o) => `/practice${qs({ bookmarked: 'true', origin: o.origin })}` },
  { id: 'weak', title: 'Weak topics', text: 'Questions from topics marked weak or still learning.', build: (o) => `/practice${qs({ mastery: ['weak', 'learning'], origin: o.origin, section: o.section })}` },
  { id: 'paper', title: 'Full paper simulation', text: 'A complete previous-year paper with sectional timing.', build: () => '/mocks?create=pyq_paper' },
];

export function PracticeModes() {
  const facets = useApi('/api/questions/facets');
  const topics = useApi('/api/topics');
  const pyq = (facets.data?.origins ?? []).filter((o: any) => o.origin === 'authentic_pyq').reduce((s: number, o: any) => s + Number(o.n), 0);
  const [o, setO] = useState({ origin: '', topic: '', year: '', slot: '', section: 'QA' });
  useEffect(() => {
    if (pyq > 0) setO((x) => ({ ...x, origin: 'authentic_pyq' }));
  }, [pyq]);
  const nav = useNavigate();
  const years: string[] = [...new Set<string>((facets.data?.years ?? []).map((y: any) => String(y.year)))];
  const start = async (m: (typeof MODES)[number]) => {
    const url = m.build(o);
    if (url) nav(url);
  };
  const errorTest = async () => {
    try {
      const t = await api.post('/api/mocks', { kind: 'error_test', title: 'Error retry test', durationMin: 30, questionCount: 20 });
      nav(`/mocks?started=${t.id}`);
    } catch (e) {
      alert((e as Error).message);
    }
  };
  return (
    <div>
      <PageHeader title="Practice modes" subtitle="Choose how to practise. Every mode records attempts, updates mastery and feeds the error log." />
      <Card>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div className="field">
            <label htmlFor="m-origin">Questions</label>
            <select id="m-origin" value={o.origin} onChange={(e) => setO({ ...o, origin: e.target.value })}>
              <option value="authentic_pyq">Authentic CAT PYQs only ({pyq})</option>
              <option value="">All practice questions</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="m-section">Section</label>
            <select id="m-section" value={o.section} onChange={(e) => setO({ ...o, section: e.target.value })}>
              <option value="QA">QA</option>
              <option value="VARC">VARC</option>
              <option value="DILR">DILR</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="m-topic">Topic</label>
            <select id="m-topic" value={o.topic} onChange={(e) => setO({ ...o, topic: e.target.value })}>
              <option value="">Choose…</option>
              {(topics.data?.items ?? [])
                .filter((t: any) => t.section_id === o.section && Number(t.question_count) > 0)
                .map((t: any) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.question_count})
                  </option>
                ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="m-year">Year</label>
            <select id="m-year" value={o.year} onChange={(e) => setO({ ...o, year: e.target.value })} disabled={!years.length}>
              <option value="">{years.length ? 'Choose…' : 'No PYQ years yet'}</option>
              {years.map((y) => (
                <option key={y}>{y}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="m-slot">Slot</label>
            <select id="m-slot" value={o.slot} onChange={(e) => setO({ ...o, slot: e.target.value })} disabled={!years.length}>
              <option value="">Any</option>
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3</option>
            </select>
          </div>
        </div>
        {pyq === 0 && <p className="small muted">No authentic PYQs are in the bank yet, so year and slot modes are unavailable and other modes use labelled original practice questions.</p>}
      </Card>
      <div className="grid grid-3">
        {MODES.map((m) => {
          const url = m.build(o);
          const pyqOnly = m.id === 'year' || m.id === 'slot' || m.id === 'paper';
          const disabled = !url || (pyqOnly && pyq === 0);
          return (
            <Card key={m.id} title={<h3 style={{ margin: 0 }}>{m.title}</h3>}>
              <p className="small">{m.text}</p>
              <button className="btn" disabled={disabled} onClick={() => void start(m)}>
                Start
              </button>
              {pyqOnly && pyq === 0 && <div className="tiny muted mt">Needs imported PYQs</div>}
              {!url && !pyqOnly && <div className="tiny muted mt">Choose a {m.needs?.join(' and ')}</div>}
            </Card>
          );
        })}
        <Card title={<h3 style={{ margin: 0 }}>Error-retry test</h3>}>
          <p className="small">A timed test built from your unresolved mistakes.</p>
          <button className="btn" onClick={() => void errorTest()}>
            Create test
          </button>
        </Card>
      </div>
    </div>
  );
}
