import { useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Markdown } from '../components/Markdown';
import { QuestionPlayer, useElapsed } from '../components/QuestionPlayer';
import { Badge, Card, DifficultyBadge, Empty, ErrorBox, OriginBadge, PageHeader, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { fmtSec } from '../lib/format';
import { useApi } from '../lib/useApi';

export function ReadingList() {
  const list = useApi('/api/passages');
  return (
    <div>
      <PageHeader title="Reading lab" subtitle="Read a passage, highlight and annotate it, answer its questions, then study the argument map." />
      <ErrorBox error={list.error} />
      {list.data?.items.length === 0 && <Empty>No passages yet.</Empty>}
      <div className="grid grid-2">
        {(list.data?.items ?? []).map((p: any) => (
          <Card key={p.id}>
            <div className="row-between">
              <Link to={`/reading/${p.id}`}>
                <strong>{p.title}</strong>
              </Link>
              <OriginBadge origin={p.origin} year={p.exam_year} slot={p.exam_slot} />
            </div>
            <div className="row small mt">
              <Badge tone="outline">{p.domain}</Badge>
              <DifficultyBadge d={p.difficulty} />
              <span className="muted">
                {p.word_count} words · {p.question_count} questions
              </span>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

export function DilrList() {
  const list = useApi('/api/dilr-sets');
  return (
    <div>
      <PageHeader title="DILR lab" subtitle="Solve complete sets with a scratch grid, then compare your set-up with the deduction walkthrough." />
      <ErrorBox error={list.error} />
      {list.data?.items.length === 0 && <Empty>No DILR sets yet.</Empty>}
      <div className="grid grid-2">
        {(list.data?.items ?? []).map((s: any) => (
          <Card key={s.id}>
            <div className="row-between">
              <Link to={`/dilr/${s.id}`}>
                <strong>{s.title}</strong>
              </Link>
              <OriginBadge origin={s.origin} year={s.exam_year} slot={s.exam_slot} />
            </div>
            <div className="row small mt">
              <Badge tone="outline">{s.set_type}</Badge>
              <DifficultyBadge d={s.difficulty} />
              <span className="muted">
                {s.question_count} questions · target {fmtSec(s.estimated_time_sec)}
              </span>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

/** Character offset of a DOM point within an element's text. */
function offsetIn(el: HTMLElement, node: Node, offset: number) {
  const r = document.createRange();
  r.setStart(el, 0);
  r.setEnd(node, offset);
  return r.toString().length;
}

function HighlightedParagraph({ text, index, marks }: { text: string; index: number; marks: { start: number; end: number; id: string }[] }) {
  const parts: React.ReactNode[] = [];
  let pos = 0;
  for (const m of [...marks].sort((a, b) => a.start - b.start)) {
    if (m.start < pos) continue;
    parts.push(text.slice(pos, m.start));
    parts.push(
      <mark key={m.id} className="hl">
        {text.slice(m.start, m.end)}
      </mark>,
    );
    pos = m.end;
  }
  parts.push(text.slice(pos));
  return <p data-p={index}>{parts}</p>;
}

export function PassagePage() {
  const { id } = useParams();
  const [reveal, setReveal] = useState(false);
  const g = useApi(`/api/passages/${id}${reveal ? '?reveal=true' : ''}`);
  const [qi, setQi] = useState(0);
  const [sel, setSel] = useState<{ paragraph: number; start: number; end: number; text: string } | null>(null);
  const [comment, setComment] = useState('');
  const textRef = useRef<HTMLDivElement>(null);
  const [readingSec] = useElapsed(true);

  const paragraphs = useMemo(() => (g.data?.body_md ?? '').split(/\n\s*\n/).map((p: string) => p.trim()).filter(Boolean), [g.data?.body_md]);
  if (g.loading && !g.data) return <Spinner />;
  if (g.error) return <ErrorBox error={g.error} />;
  const d = g.data;
  const highlights = d.notes.filter((n: any) => n.kind === 'highlight' || n.kind === 'annotation');

  const onMouseUp = () => {
    const s = window.getSelection();
    if (!s || s.isCollapsed || !s.rangeCount) return setSel(null);
    const range = s.getRangeAt(0);
    const startP = (range.startContainer.parentElement as HTMLElement)?.closest('[data-p]') as HTMLElement | null;
    const endP = (range.endContainer.parentElement as HTMLElement)?.closest('[data-p]') as HTMLElement | null;
    if (!startP || startP !== endP) return setSel(null);
    const start = offsetIn(startP, range.startContainer, range.startOffset);
    const end = offsetIn(startP, range.endContainer, range.endOffset);
    if (end - start < 2) return setSel(null);
    setSel({ paragraph: Number(startP.dataset.p), start, end, text: range.toString().slice(0, 2000) });
  };

  const save = async (kind: 'highlight' | 'annotation') => {
    if (!sel) return;
    await api.post('/api/notes', { kind, passageId: d.id, anchor: sel, body: kind === 'annotation' ? comment : sel.text });
    setSel(null);
    setComment('');
    window.getSelection()?.removeAllRanges();
    g.reload();
  };
  const remove = async (noteId: string) => {
    await api.del(`/api/notes/${noteId}`);
    g.reload();
  };

  return (
    <div>
      <PageHeader title={d.title} subtitle={<span className="row"><Badge tone="outline">{d.domain}</Badge><OriginBadge origin={d.origin} year={d.exam_year} slot={d.exam_slot} /><span className="small">{d.word_count} words · reading for {fmtSec(readingSec)}</span></span>} />
      <div className="split">
        <div className="card sticky">
          <div className="small muted mb">Select text to highlight or annotate it.</div>
          <div ref={textRef} className="passage-text" onMouseUp={onMouseUp} onKeyUp={onMouseUp}>
            {paragraphs.map((p: string, i: number) => (
              <HighlightedParagraph key={i} text={p} index={i} marks={highlights.filter((h: any) => h.anchor?.paragraph === i).map((h: any) => ({ start: h.anchor.start, end: h.anchor.end, id: h.id }))} />
            ))}
          </div>
          {sel && (
            <div className="card" style={{ padding: 10 }}>
              <div className="small mb">“{sel.text.slice(0, 120)}{sel.text.length > 120 ? '…' : ''}”</div>
              <div className="row">
                <button className="btn btn-sm" onClick={() => void save('highlight')}>
                  Highlight
                </button>
                <input aria-label="Annotation" placeholder="Add a comment" value={comment} onChange={(e) => setComment(e.target.value)} style={{ flex: 1 }} />
                <button className="btn btn-sm" disabled={!comment.trim()} onClick={() => void save('annotation')}>
                  Annotate
                </button>
              </div>
            </div>
          )}
          {highlights.length > 0 && (
            <details className="mt">
              <summary>Your highlights and annotations ({highlights.length})</summary>
              <ul className="small">
                {highlights.map((h: any) => (
                  <li key={h.id}>
                    {h.kind === 'annotation' ? (
                      <>
                        <em>“{h.anchor?.text?.slice(0, 60)}”</em> — {h.body}
                      </>
                    ) : (
                      <em>“{h.body.slice(0, 100)}”</em>
                    )}{' '}
                    <button className="btn btn-ghost btn-sm" onClick={() => void remove(h.id)} aria-label="Remove">
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
        <div>
          <GroupQuestions d={d} qi={qi} setQi={setQi} onAnswered={() => g.reload()} />
          <Analysis d={d} onReveal={() => setReveal(true)} kind="passage" />
        </div>
      </div>
    </div>
  );
}

function GroupQuestions({ d, qi, setQi, onAnswered }: { d: any; qi: number; setQi: (n: number) => void; onAnswered: () => void }) {
  const qs = d.questions as any[];
  if (!qs.length) return <Empty>No published questions for this item.</Empty>;
  return (
    <div>
      <div className="row mb">
        {qs.map((q, i) => (
          <button key={q.id} className={`btn btn-sm ${i === qi ? 'btn-primary' : ''}`} onClick={() => setQi(i)}>
            {q.last_correct === true ? '✓ ' : q.last_correct === false ? '✗ ' : ''}Q{i + 1}
          </button>
        ))}
      </div>
      <QuestionPlayer key={qs[qi].id} questionId={qs[qi].id} hideGroup onAnswered={onAnswered} onNext={qi < qs.length - 1 ? () => setQi(qi + 1) : undefined} />
    </div>
  );
}

function Analysis({ d, onReveal, kind }: { d: any; onReveal: () => void; kind: 'passage' | 'set' }) {
  if (!d.analysisUnlocked)
    return (
      <Card title={kind === 'passage' ? 'Passage analysis' : 'Set walkthrough'}>
        <p className="small">Unlocks after you answer every question{kind === 'set' ? ' in the set' : ''}.</p>
        <button className="btn btn-sm" onClick={onReveal}>
          Show it now
        </button>
      </Card>
    );
  const a = d.analysis;
  return kind === 'passage' ? (
    <Card title="Passage analysis">
      {a.central_argument && (
        <>
          <h3>Central argument</h3>
          <Markdown text={a.central_argument} />
        </>
      )}
      {a.structure_md && (
        <>
          <h3>Structure</h3>
          <Markdown text={a.structure_md} />
        </>
      )}
      {a.purpose_tone && (
        <>
          <h3>Purpose and tone</h3>
          <Markdown text={a.purpose_tone} />
        </>
      )}
      {a.vocabulary_md && (
        <>
          <h3>Vocabulary in context</h3>
          <Markdown text={a.vocabulary_md} />
        </>
      )}
    </Card>
  ) : (
    <Card title="Set walkthrough">
      {a.structure_md && (
        <>
          <h3>Structure</h3>
          <Markdown text={a.structure_md} />
        </>
      )}
      {a.deductions_md && (
        <>
          <h3>Deductions</h3>
          <Markdown text={a.deductions_md} />
        </>
      )}
      {a.selection_md && (
        <>
          <h3>Should you pick this set?</h3>
          <Markdown text={a.selection_md} />
        </>
      )}
    </Card>
  );
}

function ScratchGrid({ setId, saved, onSaved }: { setId: string; saved: any; onSaved: () => void }) {
  const init: string[][] = saved?.anchor?.grid ?? Array.from({ length: 5 }, () => Array(5).fill(''));
  const [grid, setGrid] = useState<string[][]>(init);
  const [status, setStatus] = useState('');
  const setCell = (r: number, c: number, v: string) => setGrid(grid.map((row, i) => (i === r ? row.map((x, j) => (j === c ? v.slice(0, 40) : x)) : row)));
  const save = async () => {
    if (saved) await api.patch(`/api/notes/${saved.id}`, { body: 'Scratch grid', anchor: { grid } });
    else await api.post('/api/notes', { kind: 'workspace', dilrSetId: setId, body: 'Scratch grid', anchor: { grid } });
    setStatus('Saved');
    onSaved();
  };
  return (
    <Card title="Scratch grid" actions={<span className="tiny muted">{status}</span>}>
      <div className="table-wrap">
        <table className="grid-scratch">
          <tbody>
            {grid.map((row, r) => (
              <tr key={r}>
                {row.map((v, c) => (
                  <td key={c}>
                    <input aria-label={`Row ${r + 1} column ${c + 1}`} value={v} onChange={(e) => (setStatus(''), setCell(r, c, e.target.value))} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row mt">
        <button className="btn btn-sm" disabled={grid.length >= 20} onClick={() => setGrid([...grid, Array(grid[0].length).fill('')])}>
          + Row
        </button>
        <button className="btn btn-sm" disabled={grid[0].length >= 20} onClick={() => setGrid(grid.map((r) => [...r, '']))}>
          + Column
        </button>
        <button className="btn btn-sm btn-primary" onClick={() => void save()}>
          Save grid
        </button>
      </div>
    </Card>
  );
}

export function DilrSetPage() {
  const { id } = useParams();
  const [reveal, setReveal] = useState(false);
  const g = useApi(`/api/dilr-sets/${id}${reveal ? '?reveal=true' : ''}`);
  const [qi, setQi] = useState(0);
  if (g.loading && !g.data) return <Spinner />;
  if (g.error) return <ErrorBox error={g.error} />;
  const d = g.data;
  const workspace = d.notes.find((n: any) => n.kind === 'workspace');
  return (
    <div>
      <PageHeader title={d.title} subtitle={<span className="row"><Badge tone="outline">{d.set_type}</Badge><DifficultyBadge d={d.difficulty} /><OriginBadge origin={d.origin} year={d.exam_year} slot={d.exam_slot} /><span className="small">Target {fmtSec(d.estimated_time_sec)}</span></span>} />
      <div className="split">
        <div className="sticky">
          <div className="card">
            <Markdown text={d.body_md} />
          </div>
          <ScratchGrid setId={d.id} saved={workspace} onSaved={() => g.reload()} />
        </div>
        <div>
          <GroupQuestions d={d} qi={qi} setQi={setQi} onAnswered={() => g.reload()} />
          <Analysis d={d} onReveal={() => setReveal(true)} kind="set" />
        </div>
      </div>
    </div>
  );
}
