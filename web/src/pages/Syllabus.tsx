import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Markdown } from '../components/Markdown';
import { Badge, Card, DifficultyBadge, Empty, ErrorBox, PageHeader, Progress, Spinner, StateBadge, Tabs } from '../components/ui';
import { api } from '../lib/api';
import { fmtSec, ORIGIN_LABEL, SECTION_NAMES } from '../lib/format';
import { useApi } from '../lib/useApi';

export function Syllabus() {
  const [section, setSection] = useState<'QA' | 'VARC' | 'DILR'>('QA');
  const sections = useApi('/api/sections');
  const topics = useApi(`/api/topics?section=${section}`);
  return (
    <div>
      <PageHeader title="Syllabus" subtitle="Every topic with its prerequisites, your mastery state and how much practice content exists." />
      <div className="grid grid-3 mb">
        {(sections.data?.items ?? []).map((s: any) => (
          <Card key={s.id}>
            <div className="row-between">
              <strong>{s.id}</strong>
              <span className="small muted">{s.topic_count} topics</span>
            </div>
            <div className="small muted mb">{s.name}</div>
            <Progress value={Number(s.avg_mastery)} label={`${s.id} average mastery`} />
            <div className="tiny muted mt">
              Average mastery {s.avg_mastery} · {s.proficient_topics} proficient or exam-ready
            </div>
          </Card>
        ))}
      </div>
      <Tabs
        label="Section"
        value={section}
        onChange={setSection}
        tabs={(['QA', 'VARC', 'DILR'] as const).map((s) => ({ id: s, label: SECTION_NAMES[s] }))}
      />
      <ErrorBox error={topics.error} />
      {topics.loading && !topics.data ? (
        <Spinner />
      ) : (
        <TopicTable items={topics.data?.items ?? []} />
      )}
    </div>
  );
}

function TopicTable({ items }: { items: any[] }) {
  const areas = [...new Set(items.map((t) => t.area))];
  const names = Object.fromEntries(items.map((t) => [t.id, t.name]));
  return (
    <>
      {areas.map((a) => (
        <Card key={a} title={a}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Topic</th>
                  <th>Mastery</th>
                  <th>Questions</th>
                  <th>Builds on</th>
                </tr>
              </thead>
              <tbody>
                {items
                  .filter((t) => t.area === a)
                  .map((t) => (
                    <tr key={t.id}>
                      <td>
                        <Link to={`/syllabus/${t.id}`}>{t.name}</Link>
                        {t.content_status !== 'complete' && (
                          <div className="tiny muted">Concept notes: {t.content_status === 'outline' ? 'outline only' : t.content_status}</div>
                        )}
                      </td>
                      <td>
                        <StateBadge state={t.mastery_state} score={t.mastery_score} />
                      </td>
                      <td className="small">
                        {t.question_count}
                        {Number(t.pyq_count) > 0 && <span className="muted"> ({t.pyq_count} PYQ)</span>}
                      </td>
                      <td className="small muted">{(t.prerequisites ?? []).map((p: string) => names[p] ?? p).join(', ') || '—'}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
    </>
  );
}

export function TopicPage() {
  const { id } = useParams();
  const t = useApi(`/api/topics/${id}`);
  const progress = useApi(`/api/topics/${id}/progress`);
  const chain = useApi(`/api/topics/${id}/prerequisites`);
  const [note, setNote] = useState('');
  if (t.loading && !t.data) return <Spinner />;
  if (t.error) return <ErrorBox error={t.error} />;
  const d = t.data;
  const m = d.mastery;
  const weakPrereqs = (chain.data?.items ?? []).filter((p: any) => Number(p.mastery_score) < 40);
  const addNote = async () => {
    await api.post('/api/notes', { body: note, topicId: d.id });
    setNote('');
    t.reload();
  };
  const addRevision = async () => {
    await api.post('/api/revision/items', { itemType: 'topic', refId: d.id });
    alert('Added to your revision queue.');
  };
  const totalQ = d.questionCounts.reduce((s: number, c: any) => s + Number(c.n), 0);
  return (
    <div>
      <PageHeader
        title={d.name}
        subtitle={`${d.section_id} · ${d.area}`}
        actions={
          <>
            <Link className="btn btn-primary" to={`/lesson?topic=${d.id}&minutes=30`}>
              30-minute lesson
            </Link>
            <Link className="btn" to={`/practice?topic=${d.id}`}>
              Practise
            </Link>
            <button className="btn" onClick={() => void addRevision()}>
              Add to revision
            </button>
          </>
        }
      />
      {weakPrereqs.length > 0 && (
        <div className="alert alert-warn">
          Prerequisites with low mastery:{' '}
          {weakPrereqs.map((p: any, i: number) => (
            <span key={p.id}>
              {i ? ', ' : ''}
              <Link to={`/syllabus/${p.id}`}>{p.name}</Link>
            </span>
          ))}
          . Strengthening these first usually makes this topic faster.
        </div>
      )}
      <div className="grid grid-2">
        <Card title="Your mastery">
          {m ? (
            <>
              <div className="row mb">
                <StateBadge state={m.state} score={m.score} />
                <Badge tone="outline">Mode {m.mode === 'B' ? 'B: high performance' : 'A: foundation'}</Badge>
              </div>
              <Progress value={Number(m.score)} label="Mastery score" />
              <p className="small mt">{m.state_reason}</p>
              <div className="grid grid-3 small">
                <div>
                  Correct {m.correct_count} of {m.attempts_count}
                </div>
                <div>Distinct questions {m.distinct_questions}</div>
                <div>Last practised {m.last_practiced_at ? new Date(m.last_practiced_at).toLocaleDateString() : '—'}</div>
              </div>
              <p className="tiny muted mt">
                How this is calculated: <Link to="/help/mastery">mastery formula</Link>
              </p>
            </>
          ) : (
            <Empty>Not started. Answer a few questions to get a mastery estimate.</Empty>
          )}
          {progress.data?.byDifficulty?.length > 0 && (
            <table className="mt small">
              <thead>
                <tr>
                  <th>Difficulty</th>
                  <th>Attempts</th>
                  <th>Correct</th>
                  <th>Avg time</th>
                </tr>
              </thead>
              <tbody>
                {progress.data.byDifficulty.map((r: any) => (
                  <tr key={r.difficulty}>
                    <td>
                      <DifficultyBadge d={r.difficulty} />
                    </td>
                    <td>{r.attempts}</td>
                    <td>{r.correct}</td>
                    <td>{fmtSec(Number(r.avg_time))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="Content available">
          <p className="small">{totalQ} published question(s).</p>
          <ul className="small">
            {d.questionCounts.map((c: any, i: number) => (
              <li key={i}>
                {c.n} × {c.difficulty}, {ORIGIN_LABEL[c.origin] ?? c.origin}
              </li>
            ))}
          </ul>
          <p className="small">
            <strong>Mastery criteria:</strong> {d.mastery_criteria || 'Default criteria.'}
          </p>
          {d.prerequisites.length > 0 && (
            <p className="small">
              <strong>Builds on:</strong>{' '}
              {d.prerequisites.map((p: any, i: number) => (
                <span key={p.id}>
                  {i ? ', ' : ''}
                  <Link to={`/syllabus/${p.id}`}>{p.name}</Link>
                </span>
              ))}
            </p>
          )}
          {d.dependents.length > 0 && (
            <p className="small">
              <strong>Leads to:</strong>{' '}
              {d.dependents.map((p: any, i: number) => (
                <span key={p.id}>
                  {i ? ', ' : ''}
                  <Link to={`/syllabus/${p.id}`}>{p.name}</Link>
                </span>
              ))}
            </p>
          )}
        </Card>
      </div>
      <Card title="Concept">
        {d.content_status !== 'complete' && <div className="alert alert-info">These concept notes are an outline. Full worked examples for this topic have not been written yet.</div>}
        <Markdown text={d.concept_md} />
        {d.traps_md && (
          <>
            <h3 className="mt">Traps</h3>
            <Markdown text={d.traps_md} />
          </>
        )}
        {d.revision_md && (
          <>
            <h3 className="mt">Quick revision</h3>
            <Markdown text={d.revision_md} />
          </>
        )}
      </Card>
      {d.formulas.length > 0 && (
        <Card title="Formulas">
          {d.formulas.map((f: any) => (
            <div key={f.id} className="mb">
              <strong>{f.title}</strong> {f.high_value && <Badge tone="accent">High value</Badge>}
              <Markdown text={`$$${f.formula_tex}$$`} />
              <Markdown text={f.explanation_md} />
            </div>
          ))}
        </Card>
      )}
      {d.workedExamples.length > 0 && (
        <Card title="Worked examples">
          {d.workedExamples.map((w: any) => (
            <details key={w.id} className="mb">
              <summary>
                <Markdown text={w.problem_md} inline />
              </summary>
              <Markdown text={w.solution_md} />
            </details>
          ))}
        </Card>
      )}
      <Card title="Your notes">
        {d.notes.map((n: any) => (
          <p key={n.id} className="small">
            {n.body}
          </p>
        ))}
        <label htmlFor="topic-note">Add a note</label>
        <textarea id="topic-note" value={note} onChange={(e) => setNote(e.target.value)} />
        <button className="btn btn-sm mt" disabled={!note.trim()} onClick={() => void addNote()}>
          Save note
        </button>
      </Card>
    </div>
  );
}
