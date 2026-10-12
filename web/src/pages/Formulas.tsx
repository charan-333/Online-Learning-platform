import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Markdown } from '../components/Markdown';
import { Badge, Card, Empty, PageHeader, Spinner, Stat } from '../components/ui';
import { api, qs } from '../lib/api';
import { useApi } from '../lib/useApi';

export function Formulas() {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const list = useApi(`/api/formulas${qs({ q: query })}`);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const add = async (id: string) => {
    await api.post('/api/revision/items', { itemType: 'formula', refId: id });
    setAdded(new Set([...added, id]));
  };
  const items = list.data?.items ?? [];
  const byTopic = new Map<string, any[]>();
  for (const f of items) byTopic.set(f.topic_name, [...(byTopic.get(f.topic_name) ?? []), f]);
  return (
    <div>
      <PageHeader title="Formula book" subtitle="Each formula with what it means, a derivation where useful, and when a shortcut is safe or misleading." actions={<button className="btn no-print" onClick={() => window.print()}>Print</button>} />
      <form
        className="row mb no-print"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(q);
        }}
      >
        <label htmlFor="f-q" className="sr-only">
          Search formulas
        </label>
        <input id="f-q" type="search" placeholder="Search formulas" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn">Search</button>
      </form>
      {list.loading && !list.data ? (
        <Spinner />
      ) : items.length === 0 ? (
        <Empty>No formulas match.</Empty>
      ) : (
        [...byTopic.entries()].map(([topic, fs]) => (
          <Card key={topic} title={<Link to={`/syllabus/${fs[0].topic_id}`}>{topic}</Link>}>
            {fs.map((f) => (
              <div key={f.id} className="mb">
                <div className="row-between">
                  <div className="row">
                    <strong>{f.title}</strong>
                    {f.high_value && <Badge tone="accent">High value</Badge>}
                    {f.is_shortcut && <Badge tone="warn">Shortcut</Badge>}
                  </div>
                  <button className="btn btn-sm no-print" disabled={added.has(f.id)} onClick={() => void add(f.id)}>
                    {added.has(f.id) ? 'In revision' : 'Add to revision'}
                  </button>
                </div>
                <Markdown text={`$$${f.formula_tex}$$`} />
                <Markdown text={f.explanation_md} />
                {f.derivation_md && (
                  <details>
                    <summary className="small">Derivation</summary>
                    <Markdown text={f.derivation_md} />
                  </details>
                )}
                {(f.safe_when_md || f.fails_when_md) && (
                  <p className="small">
                    {f.safe_when_md && (
                      <>
                        <strong>Safe when:</strong> {f.safe_when_md}{' '}
                      </>
                    )}
                    {f.fails_when_md && (
                      <>
                        <strong>Misleading when:</strong> {f.fails_when_md}
                      </>
                    )}
                  </p>
                )}
              </div>
            ))}
          </Card>
        ))
      )}
    </div>
  );
}

/** Calculation gym: generated arithmetic drills (not CAT questions), checked exactly in the browser. */
type Drill = { prompt: string; answer: number; tolerance: number };
const GYMS: Record<string, { title: string; make: (r: () => number) => Drill }> = {
  squares: { title: 'Squares to 50', make: (r) => { const n = 11 + Math.floor(r() * 40); return { prompt: `${n}²`, answer: n * n, tolerance: 0 }; } },
  multiply: { title: '2-digit × 2-digit', make: (r) => { const a = 12 + Math.floor(r() * 88), b = 12 + Math.floor(r() * 88); return { prompt: `${a} × ${b}`, answer: a * b, tolerance: 0 }; } },
  percent: { title: 'Percent of a number', make: (r) => { const p = [5, 12.5, 15, 16.66, 20, 25, 33.33, 37.5, 40, 62.5, 75, 87.5][Math.floor(r() * 12)]; const n = 40 + Math.floor(r() * 960); return { prompt: `${p}% of ${n}`, answer: Math.round((p / 100) * n * 100) / 100, tolerance: 0.6 }; } },
  fractions: { title: 'Fraction ↔ percent', make: (r) => { const d = [3, 6, 7, 8, 9, 11, 12, 16][Math.floor(r() * 8)]; const n = 1 + Math.floor(r() * (d - 1)); return { prompt: `${n}/${d} as a percent (2 dp)`, answer: Math.round((n / d) * 10000) / 100, tolerance: 0.02 }; } },
  divide: { title: 'Division (2 dp)', make: (r) => { const a = 100 + Math.floor(r() * 900), b = 7 + Math.floor(r() * 23); return { prompt: `${a} ÷ ${b} (2 dp)`, answer: Math.round((a / b) * 100) / 100, tolerance: 0.011 }; } },
  growth: { title: 'Successive % change', make: (r) => { const a = [10, 20, 25, 30, 40][Math.floor(r() * 5)], b = -[10, 20, 25][Math.floor(r() * 3)]; return { prompt: `Net % change of +${a}% then ${b}%`, answer: a + b + (a * b) / 100, tolerance: 0.01 }; } },
};

export function CalcGym() {
  const [gym, setGym] = useState<string>('squares');
  const [running, setRunning] = useState(false);
  const [drill, setDrill] = useState<Drill | null>(null);
  const [input, setInput] = useState('');
  const [stats, setStats] = useState({ n: 0, correct: 0, ms: 0 });
  const [last, setLast] = useState<string>('');
  const shownAt = useRef(0);
  const sessionId = useRef<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const next = () => {
    setDrill(GYMS[gym].make(Math.random));
    setInput('');
    shownAt.current = Date.now();
    setTimeout(() => inputRef.current?.focus(), 0);
  };
  const start = async () => {
    setStats({ n: 0, correct: 0, ms: 0 });
    setLast('');
    setRunning(true);
    next();
    try {
      sessionId.current = (await api.post('/api/study-sessions', { kind: 'calc_gym', refId: gym })).id;
    } catch {
      sessionId.current = null;
    }
  };
  const stop = async () => {
    setRunning(false);
    if (sessionId.current) await api.patch(`/api/study-sessions/${sessionId.current}`, { activeSeconds: Math.round(stats.ms / 1000), ended: true }).catch(() => undefined);
  };
  useEffect(() => () => void (sessionId.current && api.patch(`/api/study-sessions/${sessionId.current}`, { activeSeconds: 0, ended: true }).catch(() => undefined)), []);
  const check = (e: React.FormEvent) => {
    e.preventDefault();
    if (!drill) return;
    const v = Number(input.replace(/,/g, ''));
    const ok = Number.isFinite(v) && Math.abs(v - drill.answer) <= drill.tolerance + 1e-9;
    const ms = Date.now() - shownAt.current;
    setStats((s) => ({ n: s.n + 1, correct: s.correct + (ok ? 1 : 0), ms: s.ms + ms }));
    setLast(ok ? `✓ ${drill.prompt} = ${drill.answer} (${(ms / 1000).toFixed(1)}s)` : `✗ ${drill.prompt} = ${drill.answer}, you wrote ${input}`);
    next();
  };
  return (
    <div>
      <PageHeader title="Calculation gym" subtitle="Short arithmetic drills for speed and accuracy. These are generated exercises, not CAT questions." />
      <Card>
        <div className="row mb">
          {Object.entries(GYMS).map(([k, g]) => (
            <button key={k} className={`btn btn-sm ${gym === k ? 'btn-primary' : ''}`} disabled={running} onClick={() => setGym(k)}>
              {g.title}
            </button>
          ))}
        </div>
        {!running ? (
          <button className="btn btn-primary" onClick={() => void start()}>
            Start
          </button>
        ) : (
          drill && (
            <form onSubmit={check} className="stack">
              <div style={{ fontSize: '2rem', fontWeight: 700 }} aria-live="polite">
                {drill.prompt}
              </div>
              <div className="row">
                <label htmlFor="gym-in" className="sr-only">
                  Answer
                </label>
                <input id="gym-in" ref={inputRef} inputMode="decimal" autoComplete="off" value={input} onChange={(e) => setInput(e.target.value)} />
                <button className="btn">Check</button>
                <button type="button" className="btn btn-ghost" onClick={() => void stop()}>
                  Stop
                </button>
              </div>
              {last && <div className="small">{last}</div>}
            </form>
          )
        )}
      </Card>
      {stats.n > 0 && (
        <div className="grid grid-3">
          <Card>
            <Stat label="Answered" value={stats.n} />
          </Card>
          <Card>
            <Stat label="Accuracy" value={`${Math.round((stats.correct / stats.n) * 100)}%`} />
          </Card>
          <Card>
            <Stat label="Average time" value={`${(stats.ms / stats.n / 1000).toFixed(1)}s`} />
          </Card>
        </div>
      )}
    </div>
  );
}
