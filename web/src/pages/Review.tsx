import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Markdown } from '../components/Markdown';
import { RevisionItem } from '../components/RevisionItem';
import { Badge, Card, Empty, ErrorBox, PageHeader, Spinner, Stat } from '../components/ui';
import { api, qs } from '../lib/api';
import { ERROR_LABEL, fmtDate, fmtDay } from '../lib/format';
import { useApi } from '../lib/useApi';

export function ErrorLog() {
  const [params, setParams] = useSearchParams();
  const f = { status: params.get('status') ?? 'open', category: params.get('category') ?? '', section: params.get('section') ?? '', q: params.get('q') ?? '' };
  const list = useApi(`/api/errors${qs({ ...f, pageSize: 50 })}`);
  const trends = useApi('/api/errors/trends');
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    setParams(p, { replace: true });
  };
  return (
    <div>
      <PageHeader
        title="Error log"
        subtitle="Every wrong answer, with its cause and fix. An entry closes when you later answer the question correctly."
        actions={
          <Link className="btn" to="/modes">
            Retry mistakes
          </Link>
        }
      />
      {trends.data?.byCategory?.length > 0 && (
        <Card title="Patterns">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Mistake type</th>
                  <th>Total</th>
                  <th>Resolved</th>
                  <th>Last 14 days</th>
                  <th>Trend</th>
                </tr>
              </thead>
              <tbody>
                {trends.data.byCategory.map((c: any) => (
                  <tr key={c.category}>
                    <td>
                      {c.label} {c.recurring && <Badge tone="bad">Recurring</Badge>}
                    </td>
                    <td>{c.total}</td>
                    <td>{c.resolved}</td>
                    <td>{c.last_14d}</td>
                    <td>
                      <Badge tone={c.trend === 'improving' ? 'good' : c.trend === 'worsening' ? 'bad' : ''}>{c.trend}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <Card>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div className="field">
            <label htmlFor="e-status">Status</label>
            <select id="e-status" value={f.status} onChange={(e) => set('status', e.target.value)}>
              <option value="open">Open</option>
              <option value="resolved">Resolved</option>
              <option value="all">All</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="e-cat">Type</label>
            <select id="e-cat" value={f.category} onChange={(e) => set('category', e.target.value)}>
              <option value="">Any</option>
              <option value="unclassified">Not yet classified</option>
              {Object.entries(ERROR_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="e-sec">Section</label>
            <select id="e-sec" value={f.section} onChange={(e) => set('section', e.target.value)}>
              <option value="">Any</option>
              <option>QA</option>
              <option>VARC</option>
              <option>DILR</option>
            </select>
          </div>
        </div>
      </Card>
      <ErrorBox error={list.error} />
      {list.loading && !list.data ? <Spinner /> : list.data?.items.length === 0 ? <Empty>No entries here.</Empty> : list.data?.items.map((e: any) => <ErrorEntry key={e.id} e={e} onSaved={list.reload} />)}
    </div>
  );
}

function ErrorEntry({ e, onSaved }: { e: any; onSaved: () => void }) {
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ category: e.category === 'unclassified' ? '' : e.category, rootCause: e.root_cause ?? '', correctApproach: e.correct_approach ?? '' });
  const save = async () => {
    await api.patch(`/api/errors/${e.id}`, { category: f.category || undefined, rootCause: f.rootCause, correctApproach: f.correctApproach });
    setEdit(false);
    onSaved();
  };
  return (
    <Card>
      <div className="row-between">
        <div className="row">
          <Link to={`/practice/${e.question_id}`}>
            <strong>{e.external_id}</strong>
          </Link>
          <Badge tone="accent">{e.section_id}</Badge>
          <span className="small">{e.topic_name}</span>
          <Badge tone={e.category === 'unclassified' ? 'warn' : 'bad'}>{e.guide?.label ?? e.category}</Badge>
          {e.resolved_at ? <Badge tone="good">Resolved {fmtDate(e.resolved_at)}</Badge> : <Badge>Open</Badge>}
        </div>
        <span className="tiny muted">{fmtDate(e.created_at)}</span>
      </div>
      <div className="small muted mt">
        <Markdown text={e.stem_preview} inline />
      </div>
      <p className="small mt">
        You answered <strong>{e.learner_answer ?? 'nothing'}</strong>; correct answer <strong>{e.correct_answer}</strong>.
        {e.subsequent?.length > 0 && <> Later attempts: {e.subsequent.map((s: any) => (s.correct ? '✓' : '✗')).join(' ')}</>}
      </p>
      {e.guide && (
        <p className="small">
          <strong>Likely misconception:</strong> {e.guide.misconception} <strong>Remedy:</strong> {e.guide.remedy}
          {e.remediation_topic_name && (
            <>
              {' '}
              Review <Link to={`/syllabus/${e.remediation_topic_id}`}>{e.remediation_topic_name}</Link>.
            </>
          )}
        </p>
      )}
      {!edit ? (
        <>
          {e.root_cause && (
            <p className="small">
              <strong>Root cause:</strong> {e.root_cause}
            </p>
          )}
          {e.correct_approach && (
            <p className="small">
              <strong>Correct approach:</strong> {e.correct_approach}
            </p>
          )}
          <button className="btn btn-sm" onClick={() => setEdit(true)}>
            {e.root_cause ? 'Edit analysis' : 'Write analysis'}
          </button>
        </>
      ) : (
        <div className="mt">
          <div className="field">
            <label htmlFor={`c-${e.id}`}>Mistake type</label>
            <select id={`c-${e.id}`} value={f.category} onChange={(x) => setF({ ...f, category: x.target.value })}>
              <option value="">Choose</option>
              {Object.entries(ERROR_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor={`r-${e.id}`}>Root cause</label>
            <textarea id={`r-${e.id}`} value={f.rootCause} onChange={(x) => setF({ ...f, rootCause: x.target.value })} />
          </div>
          <div className="field">
            <label htmlFor={`a-${e.id}`}>Correct approach</label>
            <textarea id={`a-${e.id}`} value={f.correctApproach} onChange={(x) => setF({ ...f, correctApproach: x.target.value })} />
          </div>
          <div className="row">
            <button className="btn btn-sm btn-primary" onClick={() => void save()}>
              Save
            </button>
            <button className="btn btn-sm" onClick={() => setEdit(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

export function Revision() {
  const due = useApi('/api/revision/due');
  const upcoming = useApi('/api/revision/upcoming');
  const [done, setDone] = useState<Record<string, any>>({});
  if (due.loading && !due.data) return <Spinner />;
  const items = (due.data?.items ?? []).filter((i: any) => !done[i.id]);
  return (
    <div>
      <PageHeader title="Revision" subtitle="Spaced repetition: recall first, then grade yourself honestly. Harder items come back sooner." />
      <ErrorBox error={due.error} />
      <div className="grid grid-3 mb">
        <Card>
          <Stat label="Due now" value={items.length} />
        </Card>
        <Card>
          <Stat label="Reviewed this session" value={Object.keys(done).length} />
        </Card>
        <Card>
          <Stat label="Estimated time" value={`${Math.ceil(items.reduce((s: number, i: any) => s + i.estimatedSec, 0) / 60)} min`} />
        </Card>
      </div>
      {items.length === 0 ? (
        <Empty>Nothing is due. New items appear when you answer incorrectly, guess, answer with low confidence, or add formulas.</Empty>
      ) : (
        items.map((it: any) => <RevisionItem key={it.id} item={it} onReviewed={(id, r) => setDone({ ...done, [id]: r })} />)
      )}
      {(upcoming.data?.items ?? []).length > 0 && (
        <Card title="Coming up">
          <ul className="list">
            {upcoming.data.items.map((u: any) => (
              <li key={u.day} className="row-between">
                <span>{fmtDay(u.day)}</span>
                <span className="small">{u.n} item(s)</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
