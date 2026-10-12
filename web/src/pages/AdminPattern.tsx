import { useEffect, useState } from 'react';
import { Badge, Card, Empty, ErrorBox, PageHeader, Spinner, Stat } from '../components/ui';
import { api } from '../lib/api';
import { fmtDate } from '../lib/format';
import { useApi } from '../lib/useApi';

const STATUS_TONE: Record<string, 'good' | 'warn' | 'bad'> = { verified: 'good', partially_verified: 'warn', unverified: 'bad' };
const STATUS_TEXT: Record<string, string> = { verified: 'verified', partially_verified: 'partly verified', unverified: 'unverified' };
const SECTION_KEYS = ['position', 'durationMin', 'questionCount', 'mcqCorrect', 'mcqWrong', 'titaCorrect', 'titaWrong'] as const;

const toForm = (c: any) => ({
  year: c.year,
  name: c.name,
  totalDurationMin: c.total_duration_min,
  sectionalLock: c.sectional_lock,
  sourceNote: c.source_note ?? '',
  sections: c.sections.map((s: any) => ({
    sectionId: s.section_id,
    position: s.position,
    durationMin: s.duration_min,
    questionCount: s.question_count,
    mcqCorrect: Number(s.mcq_correct),
    mcqWrong: Number(s.mcq_wrong),
    titaCorrect: Number(s.tita_correct),
    titaWrong: Number(s.tita_wrong),
  })),
});
const asBody = (f: any) => ({ ...f, year: Number(f.year), totalDurationMin: Number(f.totalDurationMin), sections: f.sections.map((s: any) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, k === 'sectionId' ? v : Number(v)]))) });

/**
 * Exam pattern versions. A version that is active, verified in any part, or used by a test is
 * frozen; changes become a new version. Settings are verified one by one, only against an
 * official source attached to that version.
 */
export function AdminExamPattern() {
  const list = useApi('/api/admin/exam-configs');
  const [selected, setSelected] = useState<string | null>(null);
  const [f, setF] = useState<any>(null);
  const [newYear, setNewYear] = useState('');
  const [src, setSrc] = useState({ kind: 'official', title: '', publisher: '', url: '', accessedOn: '', supports: '', note: '' });
  const [pick, setPick] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState<Error | null>(null);
  const items: any[] = list.data?.items ?? [];
  const c = items.find((x) => x.id === selected) ?? items.find((x) => x.is_active) ?? items[0];

  useEffect(() => {
    if (c) {
      setF(toForm(c));
      setNewYear(String(c.year));
    }
  }, [c?.id, c?.version, list.data]);

  if (list.loading && !list.data) return <Spinner />;
  if (!c || !f) return <Empty>No exam pattern recorded.</Empty>;

  const act = async (fn: () => Promise<any>, ok: string) => {
    setErr(null);
    setMsg('');
    try {
      const r = await fn();
      setMsg(ok);
      if (r?.id) setSelected(r.id);
      list.reload();
    } catch (e) {
      setErr(e as Error);
    }
  };
  const official = c.sources.filter((s: any) => s.kind === 'official');
  const setSec = (i: number, k: string, v: string) => setF({ ...f, sections: f.sections.map((s: any, j: number) => (j === i ? { ...s, [k]: v } : s)) });

  return (
    <div>
      <PageHeader title="Exam pattern" subtitle="Timing and marking that mock tests use. Each version keeps its own sources and per-setting verification." />
      <ErrorBox error={err ?? list.error} />
      {msg && <div className="alert alert-good">{msg}</div>}
      <Card title="Versions">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Pattern</th>
                <th>Status</th>
                <th>Tests using it</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((x) => (
                <tr key={x.id} aria-selected={x.id === c.id}>
                  <td>
                    <strong>CAT {x.year}</strong> · version {x.version} · {x.name} {x.is_active && <Badge tone="accent">used for new tests</Badge>}
                  </td>
                  <td>
                    <Badge tone={STATUS_TONE[x.status]}>{STATUS_TEXT[x.status]}</Badge>
                  </td>
                  <td>{x.testsUsing}</td>
                  <td>
                    <button className="btn btn-sm" disabled={x.id === c.id} onClick={() => setSelected(x.id)}>
                      {x.id === c.id ? 'Showing' : 'Show'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        title={`CAT ${c.year}, version ${c.version}`}
        actions={
          !c.is_active && (
            <button className="btn btn-primary btn-sm" onClick={() => void act(() => api.post(`/api/admin/exam-configs/${c.id}/activate`), 'This version is now used for new tests. Existing tests keep the version they were built with.')}>
              Use for new tests
            </button>
          )
        }
      >
        <div className="grid grid-4 mb">
          <Stat label="Status" value={STATUS_TEXT[c.status]} hint={`${c.fields.filter((x: any) => x.status === 'verified').length} of ${c.fields.length} settings verified`} />
          <Stat label="Total time" value={`${c.total_duration_min} min`} hint={c.sectional_lock ? 'sections locked' : 'free navigation'} />
          <Stat label="Tests using it" value={c.testsUsing} />
          <Stat label="Editable" value={c.editable ? 'yes' : 'no'} hint={c.editable ? 'draft' : 'create a new version to change it'} />
        </div>
        {c.status !== 'verified' && (
          <div className="alert alert-warn">
            Learners see this pattern labelled as {STATUS_TEXT[c.status]}. Verify each setting only after reading it in an official CAT document attached below.
          </div>
        )}
        <div className="grid grid-3">
          <div className="field">
            <label htmlFor="ep-name">Name</label>
            <input id="ep-name" disabled={!c.editable} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="ep-total">Total minutes</label>
            <input id="ep-total" type="number" disabled={!c.editable} value={f.totalDurationMin} onChange={(e) => setF({ ...f, totalDurationMin: e.target.value })} />
          </div>
          <label className="check">
            <input type="checkbox" disabled={!c.editable} checked={f.sectionalLock} onChange={(e) => setF({ ...f, sectionalLock: e.target.checked })} /> Sections locked (no switching)
          </label>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Section</th>
                <th>Order</th>
                <th>Minutes</th>
                <th>Questions</th>
                <th>MCQ +</th>
                <th>MCQ −</th>
                <th>TITA +</th>
                <th>TITA −</th>
              </tr>
            </thead>
            <tbody>
              {f.sections.map((s: any, i: number) => (
                <tr key={s.sectionId}>
                  <td>{s.sectionId}</td>
                  {SECTION_KEYS.map((k) => (
                    <td key={k}>
                      <input aria-label={`${s.sectionId} ${k}`} type="number" style={{ width: 70 }} disabled={!c.editable} value={s[k]} onChange={(e) => setSec(i, k, e.target.value)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="field">
          <label htmlFor="ep-note">Notes</label>
          <textarea id="ep-note" disabled={!c.editable} value={f.sourceNote} onChange={(e) => setF({ ...f, sourceNote: e.target.value })} />
        </div>
        <div className="row">
          {c.editable && (
            <button className="btn btn-primary" onClick={() => void act(() => api.patch(`/api/admin/exam-configs/${c.id}`, asBody(f)), 'Draft saved.')}>
              Save draft
            </button>
          )}
          <label htmlFor="ep-newyear" className="small">
            New version for year
          </label>
          <input id="ep-newyear" type="number" style={{ width: 90 }} value={newYear} onChange={(e) => setNewYear(e.target.value)} />
          <button
            className="btn"
            onClick={() =>
              void act(
                () => api.post('/api/admin/exam-configs', { ...asBody(f), year: Number(newYear), supersedesId: Number(newYear) === c.year ? c.id : undefined }),
                `Created an unverified draft for CAT ${newYear}. It is not used until you choose “Use for new tests”.`,
              )
            }
          >
            Copy into a new version
          </button>
        </div>
      </Card>

      <div className="grid grid-2">
        <Card title="Sources">
          {c.sources.length === 0 ? (
            <Empty>No sources recorded for this version.</Empty>
          ) : (
            <ul className="list">
              {c.sources.map((s: any) => (
                <li key={s.id}>
                  <div className="row-between">
                    <span>
                      <Badge tone={s.kind === 'official' ? 'good' : 'outline'}>{s.kind}</Badge> {s.url ? <a href={s.url} target="_blank" rel="noreferrer noopener">{s.title}</a> : s.title}
                      {s.publisher && <span className="small muted"> · {s.publisher}</span>}
                      {s.accessed_on && <span className="small muted"> · accessed {String(s.accessed_on).slice(0, 10)}</span>}
                    </span>
                    <button className="btn btn-sm btn-ghost" aria-label={`Remove source ${s.title}`} onClick={() => void act(() => api.del(`/api/admin/exam-configs/${c.id}/sources/${s.id}`), 'Source removed.')}>
                      Remove
                    </button>
                  </div>
                  {s.supports && <div className="small">{s.supports}</div>}
                  {s.note && <div className="small muted">{s.note}</div>}
                </li>
              ))}
            </ul>
          )}
          <h3>Add a source</h3>
          <div className="grid grid-2">
            <div className="field">
              <label htmlFor="src-kind">Kind</label>
              <select id="src-kind" value={src.kind} onChange={(e) => setSrc({ ...src, kind: e.target.value })}>
                <option value="official">Official (IIM / iimcat.ac.in)</option>
                <option value="secondary">Secondary (cannot verify settings)</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="src-title">Title</label>
              <input id="src-title" value={src.title} onChange={(e) => setSrc({ ...src, title: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="src-pub">Publisher</label>
              <input id="src-pub" value={src.publisher} onChange={(e) => setSrc({ ...src, publisher: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="src-url">URL</label>
              <input id="src-url" type="url" value={src.url} onChange={(e) => setSrc({ ...src, url: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="src-date">Accessed on</label>
              <input id="src-date" type="date" value={src.accessedOn} onChange={(e) => setSrc({ ...src, accessedOn: e.target.value })} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="src-supports">What it states (quote or summarise the relevant lines)</label>
            <textarea id="src-supports" value={src.supports} onChange={(e) => setSrc({ ...src, supports: e.target.value })} />
          </div>
          <button
            className="btn"
            disabled={!src.title.trim()}
            onClick={() =>
              void act(async () => {
                await api.post(`/api/admin/exam-configs/${c.id}/sources`, { ...src, url: src.url || undefined, accessedOn: src.accessedOn || undefined });
                setSrc({ kind: 'official', title: '', publisher: '', url: '', accessedOn: '', supports: '', note: '' });
              }, 'Source added.')
            }
          >
            Add source
          </button>
        </Card>

        <Card title="Settings verification">
          {official.length === 0 && <div className="alert alert-warn">No official source is attached, so no setting can be verified yet.</div>}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Setting</th>
                  <th>Status</th>
                  <th>Official source</th>
                </tr>
              </thead>
              <tbody>
                {c.fields.map((fl: any) => (
                  <tr key={fl.key}>
                    <td>{fl.label}</td>
                    <td>
                      <Badge tone={fl.status === 'verified' ? 'good' : 'warn'}>{fl.status}</Badge>
                      {fl.verifiedAt && <div className="tiny muted">{fmtDate(fl.verifiedAt)}</div>}
                    </td>
                    <td>
                      {fl.status === 'verified' ? (
                        <span className="row">
                          <span className="small">{c.sources.find((s: any) => s.id === fl.sourceId)?.title ?? 'source'}</span>
                          <button className="btn btn-sm btn-ghost" onClick={() => void act(() => api.post(`/api/admin/exam-configs/${c.id}/verify`, { unverify: [fl.key] }), `${fl.label}: marked unverified.`)}>
                            Unverify
                          </button>
                        </span>
                      ) : (
                        <span className="row">
                          <select aria-label={`Official source for ${fl.label}`} value={pick[fl.key] ?? ''} onChange={(e) => setPick({ ...pick, [fl.key]: e.target.value })} disabled={!official.length}>
                            <option value="">Choose…</option>
                            {official.map((s: any) => (
                              <option key={s.id} value={s.id}>
                                {s.title}
                              </option>
                            ))}
                          </select>
                          <button
                            className="btn btn-sm"
                            disabled={!pick[fl.key]}
                            onClick={() => void act(() => api.post(`/api/admin/exam-configs/${c.id}/verify`, { verify: { [fl.key]: pick[fl.key] } }), `${fl.label}: verified.`)}
                          >
                            Verify
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted">Verifying a setting freezes this version. Later changes go into a new version, so tests already taken keep the timing and marking they were scored with.</p>
        </Card>
      </div>
    </div>
  );
}
