import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useParams } from 'react-router-dom';
import { Markdown } from '../components/Markdown';
import { Badge, Card, Empty, ErrorBox, OriginBadge, PageHeader, Spinner, Stat } from '../components/ui';
import { api, qs } from '../lib/api';
import { fmtDate, ORIGIN_LABEL } from '../lib/format';
import { useApi } from '../lib/useApi';

export function AdminLayout() {
  return (
    <div>
      <div className="tabs" role="navigation" aria-label="Admin">
        {[
          ['/admin', 'Overview'],
          ['/admin/import', 'Import'],
          ['/admin/review', 'PYQ review'],
          ['/admin/questions', 'Questions'],
          ['/admin/exam-pattern', 'Exam pattern'],
          ['/admin/email', 'Email'],
          ['/admin/audit', 'Audit log'],
        ].map(([to, l]) => (
          <NavLink key={to} to={to} end={to === '/admin'} style={({ isActive }) => ({ padding: '8px 12px', textDecoration: 'none', fontWeight: isActive ? 700 : 400, borderBottom: isActive ? '2px solid var(--accent)' : '2px solid transparent' })}>
            {l}
          </NavLink>
        ))}
      </div>
      <Outlet />
    </div>
  );
}

export function AdminOverview() {
  const q = useApi('/api/admin/quality');
  const jobs = useApi('/api/admin/import-jobs');
  const email = useApi('/api/admin/email');
  if (!q.data) return <Spinner />;
  const d = q.data;
  return (
    <div>
      <PageHeader title="Content admin" subtitle="Import, edit, verify and publish questions. Every change is versioned and audited." />
      {email.data && !email.data.configured && (
        <div className="alert alert-warn">
          {email.data.summary} <Link to="/admin/email">Email settings</Link>
        </div>
      )}
      {Number(d.pyq_pending_review) > 0 && (
        <div className="alert alert-info">
          {d.pyq_pending_review} question(s) submitted as CAT PYQs are waiting for review. <Link to="/admin/review">Open the review queue</Link>
        </div>
      )}
      <div className="grid grid-4 mb">
        <Card>
          <Stat label="Questions" value={d.total} hint={`${d.published} published`} />
        </Card>
        <Card>
          <Stat label="Verified PYQs" value={d.pyq_verified} hint={`${d.pyq_pending_review} awaiting review · ${d.unverified_historical} unverified historical`} />
        </Card>
        <Card>
          <Stat label="Solutions unverified" value={d.solution_unverified} />
        </Card>
        <Card>
          <Stat label="Quality issues" value={Number(d.missing_solution) + Number(d.pyq_no_source) + Number(d.dilr_unlinked)} hint={`${d.missing_solution} no solution · ${d.pyq_no_source} PYQs without source · ${d.dilr_unlinked} DILR without set`} />
        </Card>
      </div>
      <Card title="Recent imports">
        {(jobs.data?.items ?? []).length === 0 ? (
          <Empty>No imports yet.</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>File</th>
                <th>Status</th>
                <th>Accepted / total</th>
              </tr>
            </thead>
            <tbody>
              {jobs.data.items.map((j: any) => (
                <tr key={j.id}>
                  <td>{fmtDate(j.created_at)}</td>
                  <td>{j.filename || '—'}</td>
                  <td>
                    <Badge tone={j.status === 'imported' ? 'good' : j.status === 'failed' ? 'bad' : ''}>{j.dry_run ? 'dry run' : j.status}</Badge>
                  </td>
                  <td>
                    {j.accepted} / {j.total}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

const EXAMPLE = `{
  "items": [
    {
      "kind": "question",
      "externalId": "cat2023-s1-qa-01",
      "section": "QA",
      "topic": "qa-percentages",
      "type": "MCQ",
      "difficulty": "medium",
      "stem": "…question text exactly as printed in the paper…",
      "options": { "A": "…", "B": "…", "C": "…", "D": "…" },
      "answer": "C",
      "estimatedTimeSec": 120,
      "origin": "authentic_pyq",
      "examYear": 2023,
      "examSlot": 1,
      "questionNumber": 1,
      "sources": [{ "name": "…official question paper…", "reference": "Slot 1, QA, Q1", "url": "https://…", "accessedOn": "2026-01-31" }],
      "answerKey": { "name": "…official answer key…", "reference": "Slot 1, QA, Q1", "answer": "C" },
      "solution": { "learn": "…", "hints": ["…"], "verification": "…", "distractors": { "A": "…", "B": "…", "D": "…" } }
    }
  ]
}`;

type Format = 'json' | 'jsonl' | 'csv';
const formatOf = (name: string): Format => (/\.csv$/i.test(name) ? 'csv' : /\.(jsonl|ndjson)$/i.test(name) ? 'jsonl' : 'json');

export function AdminImport() {
  const [text, setText] = useState('');
  const [format, setFormat] = useState<Format>('json');
  const [filename, setFilename] = useState('');
  const [publish, setPublish] = useState(false);
  const [report, setReport] = useState<any>(null);
  const [err, setErr] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (dryRun: boolean) => {
    setErr(null);
    setBusy(true);
    try {
      setReport(await api.post('/api/admin/questions/import-file', { format, content: text, dryRun, publish, filename }));
    } catch (e) {
      setErr(e as Error);
      setReport(null);
    } finally {
      setBusy(false);
    }
  };
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 4 * 1024 * 1024) return setErr(new Error('File is larger than 4 MB; split it into smaller batches.'));
    setFilename(f.name);
    setFormat(formatOf(f.name));
    setText(await f.text());
  };
  const issues: any[] = report ? (typeof report.report === 'string' ? JSON.parse(report.report) : report.report) : [];
  return (
    <div>
      <PageHeader title="Import questions" subtitle="JSON, JSON Lines or CSV batches of questions, RC passages and DILR sets. Always validate first." />
      <div className="alert alert-warn">
        Label an item <code>authentic_pyq</code> only when it is copied from an actual CAT paper you can cite, with its question number and the official answer key. Imports never publish these: each one goes to
        the <Link to="/admin/review">review queue</Link>, where an admin compares it with the paper and the key. Use <code>reconstructed</code> for questions recalled from memory or taken from an unofficial
        source; learners see those as unverified historical questions.
      </div>
      <Card>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div className="field">
            <label htmlFor="imp-file">File (.json, .jsonl or .csv)</label>
            <input id="imp-file" type="file" accept=".json,.jsonl,.ndjson,.csv,application/json,text/csv" onChange={(e) => void onFile(e.target.files?.[0])} />
          </div>
          <div className="field">
            <label htmlFor="imp-format">Format</label>
            <select id="imp-format" value={format} onChange={(e) => setFormat(e.target.value as Format)}>
              <option value="json">JSON</option>
              <option value="jsonl">JSON Lines</option>
              <option value="csv">CSV</option>
            </select>
          </div>
          <a className="btn btn-sm" href="/api/admin/import-template.csv" download>
            Download CSV template
          </a>
        </div>
        <div className="field">
          <label htmlFor="imp-text">Or paste the file contents</label>
          <textarea id="imp-text" style={{ minHeight: 220, fontFamily: 'var(--mono)', fontSize: 13 }} value={text} onChange={(e) => setText(e.target.value)} placeholder={format === 'json' ? EXAMPLE : ''} />
        </div>
        <label className="check mb">
          <input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} /> Publish valid practice items immediately (never applies to authentic PYQs)
        </label>
        <div className="row">
          <button className="btn" disabled={busy || !text.trim()} onClick={() => void run(true)}>
            Validate (dry run)
          </button>
          <button className="btn btn-primary" disabled={busy || !text.trim()} onClick={() => void run(false)}>
            Import
          </button>
        </div>
      </Card>
      <ErrorBox error={err} />
      {report && (
        <Card title={report.dry_run ? 'Validation report' : `Import ${report.status}`}>
          <p>
            {report.accepted} of {report.total} item(s) {report.dry_run ? 'would be accepted' : 'accepted'}; {report.rejected} rejected.
            {report.file_sha256 && <span className="tiny muted"> File SHA-256 {report.file_sha256.slice(0, 16)}…</span>}
          </p>
          {issues.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Line / item</th>
                    <th>ID</th>
                    <th>Severity</th>
                    <th>Issue</th>
                  </tr>
                </thead>
                <tbody>
                  {issues.map((i, n) => (
                    <tr key={n}>
                      <td>{i.line ? `line ${i.line}` : i.index >= 0 ? `item ${i.index + 1}` : '—'}</td>
                      <td className="small">{i.externalId ?? ''}</td>
                      <td>
                        <Badge tone={i.severity === 'error' ? 'bad' : 'warn'}>{i.severity}</Badge>
                      </td>
                      <td className="small">
                        <code>{i.code}</code> {i.message}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

export function AdminQuestions() {
  const [f, setF] = useState({ status: '', origin: '', reviewStatus: '', sourceVerification: '', solutionVerification: '', q: '' });
  const [page, setPage] = useState(1);
  const list = useApi(`/api/admin/questions${qs({ ...f, page, pageSize: 50 })}`);
  const sel = (k: keyof typeof f, label: string, opts: [string, string][]) => (
    <div className="field">
      <label htmlFor={`aq-${k}`}>{label}</label>
      <select id={`aq-${k}`} value={f[k]} onChange={(e) => (setPage(1), setF({ ...f, [k]: e.target.value }))}>
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
      <PageHeader title="Questions" subtitle={`${list.data?.total ?? '…'} total`} />
      <Card>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div className="field">
            <label htmlFor="aq-q">Search</label>
            <input id="aq-q" type="search" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
          </div>
          {sel('status', 'Status', [
            ['draft', 'Draft'],
            ['published', 'Published'],
            ['unpublished', 'Unpublished'],
          ])}
          {sel('origin', 'Origin', Object.entries(ORIGIN_LABEL))}
          {sel('reviewStatus', 'PYQ review', [
            ['pending', 'Awaiting review'],
            ['approved', 'Approved'],
            ['rejected', 'Rejected'],
          ])}
          {sel('sourceVerification', 'Source', [
            ['verified', 'Verified'],
            ['unverified', 'Unverified'],
            ['not_applicable', 'N/A'],
          ])}
          {sel('solutionVerification', 'Solution', [
            ['verified', 'Verified'],
            ['unverified', 'Unverified'],
          ])}
        </div>
      </Card>
      <ErrorBox error={list.error} />
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Section</th>
              <th>Origin</th>
              <th>Status</th>
              <th>Solution</th>
              <th>Version</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {(list.data?.items ?? []).map((q: any) => (
              <tr key={q.id}>
                <td>
                  <Link to={`/admin/questions/${q.id}`}>{q.external_id}</Link>
                  <div className="tiny muted">{q.stem_preview.slice(0, 80)}</div>
                </td>
                <td>
                  {q.section_id}
                  <div className="tiny muted">{q.topic_id}</div>
                </td>
                <td>
                  <OriginBadge {...q} year={q.exam_year} slot={q.exam_slot} number={q.question_number} />
                </td>
                <td>
                  <Badge tone={q.status === 'published' ? 'good' : ''}>{q.status}</Badge>
                </td>
                <td>{q.missing_solution ? <Badge tone="bad">missing</Badge> : <Badge tone={q.solution_verification === 'verified' ? 'good' : 'warn'}>{q.solution_verification}</Badge>}</td>
                <td>v{q.version}</td>
                <td className="small">{fmtDate(q.updated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row">
        <button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
          Previous
        </button>
        <span className="small">Page {page}</span>
        <button className="btn btn-sm" disabled={page * 50 >= (list.data?.total ?? 0)} onClick={() => setPage(page + 1)}>
          Next
        </button>
      </div>
    </div>
  );
}

export function AdminQuestionEdit() {
  const { id } = useParams();
  const q = useApi(`/api/admin/questions/${id}`);
  const topics = useApi('/api/topics');
  const [f, setF] = useState<any>(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState<Error | null>(null);
  const [src, setSrc] = useState({ name: '', reference: '', url: '' });
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    if (!q.data) return;
    const d = q.data;
    const s = d.solution ?? {};
    setF({
      topicId: d.topic_id,
      difficulty: d.difficulty,
      stem: d.stem_md,
      options: Object.fromEntries(d.options.map((o: any) => [o.key, o.text_md])),
      answer: d.correct_answer,
      estimatedTimeSec: d.estimated_time_sec,
      examYear: d.exam_year ?? '',
      examSlot: d.exam_slot ?? '',
      questionNumber: d.question_number ?? '',
      solution: {
        learn: s.learn_md ?? '',
        examMethod: s.exam_method_md ?? '',
        hints: (s.hints ?? []).join('\n'),
        verification: s.verification_md ?? '',
        commonMistakes: s.common_mistakes_md ?? '',
        conceptsTested: s.concepts_tested ?? '',
        prerequisites: s.prerequisites ?? '',
        alternative: s.alternative_md ?? '',
        advanced: s.advanced_md ?? '',
        distractors: JSON.stringify(s.distractors ?? {}, null, 2),
      },
    });
  }, [q.data]);

  if (q.loading && !q.data) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} />;
  if (!f) return null;
  const d = q.data;
  const isPyq = d.origin === 'authentic_pyq';
  const isHistorical = isPyq || d.origin === 'reconstructed';
  const set = (k: string, v: any) => setF({ ...f, [k]: v });
  const setS = (k: string, v: any) => setF({ ...f, solution: { ...f.solution, [k]: v } });

  const act = async (fn: () => Promise<unknown>, ok: string | (() => string)) => {
    setErr(null);
    setMsg('');
    try {
      await fn();
      setMsg(typeof ok === 'function' ? ok() : ok);
      q.reload();
    } catch (e) {
      setErr(e as Error);
    }
  };
  const save = () => {
    let reviewRequired = false;
    return act(async () => {
      const body: any = {
        topicId: f.topicId,
        difficulty: f.difficulty,
        stem: f.stem,
        answer: f.answer,
        estimatedTimeSec: Number(f.estimatedTimeSec),
        solution: { ...f.solution, hints: f.solution.hints.split('\n').map((h: string) => h.trim()).filter(Boolean), distractors: JSON.parse(f.solution.distractors || '{}') },
      };
      if (d.question_type === 'MCQ') body.options = f.options;
      if (isHistorical) Object.assign(body, { examYear: f.examYear ? Number(f.examYear) : null, examSlot: f.examSlot ? Number(f.examSlot) : null, questionNumber: f.questionNumber ? Number(f.questionNumber) : null });
      reviewRequired = (await api.patch(`/api/admin/questions/${id}`, body)).reviewRequired;
    }, () =>
      reviewRequired
        ? 'Saved as a new version. Because this is a PYQ, it is unpublished and back in the review queue.'
        : 'Saved as a new version. Solution verification was reset if the content changed.',
    );
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    const buf = await file.arrayBuffer();
    let bin = '';
    new Uint8Array(buf).forEach((b) => (bin += String.fromCharCode(b)));
    await act(async () => {
      const r = await api.post('/api/admin/uploads', { filename: file.name, dataBase64: btoa(bin) });
      set('stem', `${f.stem}\n\n${r.markdown}`);
    }, 'Image uploaded and inserted into the stem. Save to keep it.');
  };

  return (
    <div>
      <PageHeader
        title={d.external_id}
        subtitle={
          <span className="row">
            <OriginBadge {...d} year={d.exam_year} slot={d.exam_slot} number={d.question_number} />
            <Badge tone={d.status === 'published' ? 'good' : ''}>{d.status}</Badge>
            <Badge tone={d.solution_verification === 'verified' ? 'good' : 'warn'}>solution {d.solution_verification}</Badge>
            <span className="small">v{d.version}</span>
          </span>
        }
        actions={
          <>
            {d.status !== 'published' ? (
              <button
                className="btn btn-primary"
                disabled={isPyq && d.review_status !== 'approved'}
                title={isPyq && d.review_status !== 'approved' ? 'Approve it in the PYQ review queue first' : undefined}
                onClick={() => void act(() => api.post(`/api/admin/questions/${id}/status`, { status: 'published' }), 'Published.')}
              >
                Publish
              </button>
            ) : (
              <button className="btn" onClick={() => void act(() => api.post(`/api/admin/questions/${id}/status`, { status: 'unpublished' }), 'Unpublished.')}>
                Unpublish
              </button>
            )}
          </>
        }
      />
      <ErrorBox error={err} />
      {msg && <div className="alert alert-good">{msg}</div>}
      <div className="grid grid-2">
        {isPyq ? (
          <Card title="PYQ review">
            <p className="small">
              Review status: <Badge tone={d.review_status === 'approved' ? 'good' : d.review_status === 'rejected' ? 'bad' : 'warn'}>{d.review_status}</Badge>
              {d.reviewed_at && ` · ${fmtDate(d.reviewed_at)}`}
              {d.review_note && ` · ${d.review_note}`}
            </p>
            <ul className="small">
              {d.sources.map((s: any) => (
                <li key={s.id}>
                  {s.kind === 'answer_key' ? 'Answer key' : s.kind === 'solution' ? 'Solution source' : s.kind === 'other' ? 'Other' : 'Question paper'}: {s.source_name}, {s.reference}
                  {s.recorded_answer && ` (answer ${s.recorded_answer})`} {s.url && <a href={s.url} target="_blank" rel="noreferrer noopener">link</a>}
                </li>
              ))}
            </ul>
            {d.checks && (
              <ul className="checks small" aria-label="Automated checks">
                {d.checks.map((c: any) => (
                  <li key={c.code} className={c.ok ? 'ok' : c.blocking ? 'fail' : 'warn'}>
                    <span aria-hidden="true">{c.ok ? '✓' : c.blocking ? '✗' : '!'}</span> {c.message}
                  </li>
                ))}
              </ul>
            )}
            <p className="small muted">
              Approve PYQs in the <Link to="/admin/review">review queue</Link>. Changing the text, options, answer, solution, year, slot or number sends it back there and unpublishes it.
            </p>
          </Card>
        ) : (
          <Card title="Verification">
            <div className="row mb">
              <button className="btn btn-sm" onClick={() => void act(() => api.post(`/api/admin/questions/${id}/verify`, { solution: 'verified' }), 'Solution marked verified.')}>
                Mark solution verified
              </button>
              <button className="btn btn-sm" onClick={() => void act(() => api.post(`/api/admin/questions/${id}/verify`, { solution: 'unverified' }), 'Solution marked unverified.')}>
                Mark solution unverified
              </button>
            </div>
            {d.origin === 'reconstructed' ? (
              <>
                <p className="small">
                  Learners always see this as an unverified historical question. Recording where the recollection came from still helps editors.
                </p>
                <ul className="small">
                  {d.sources.map((s: any) => (
                    <li key={s.id}>
                      {s.source_name}, {s.reference} {s.url && <a href={s.url}>link</a>} {s.verified_at ? <Badge tone="good">checked {fmtDate(s.verified_at)}</Badge> : <Badge tone="warn">not checked</Badge>}
                    </li>
                  ))}
                </ul>
                <div className="grid grid-3">
                  <input aria-label="Source name" placeholder="Where it was recalled from" value={src.name} onChange={(e) => setSrc({ ...src, name: e.target.value })} />
                  <input aria-label="Reference" placeholder="Section and question number" value={src.reference} onChange={(e) => setSrc({ ...src, reference: e.target.value })} />
                  <input aria-label="URL" placeholder="https://…" value={src.url} onChange={(e) => setSrc({ ...src, url: e.target.value })} />
                </div>
                <div className="row mt">
                  <button
                    className="btn btn-sm"
                    onClick={() =>
                      void act(
                        () => api.post(`/api/admin/questions/${id}/verify`, { source: 'verified', sourceRef: src.name ? { name: src.name, reference: src.reference, url: src.url || undefined } : undefined }),
                        'Recollection source recorded as checked.',
                      )
                    }
                  >
                    I checked this recollection source
                  </button>
                </div>
              </>
            ) : (
              <p className="small muted">This item is labelled “{ORIGIN_LABEL[d.origin]}” and is not from a CAT paper.</p>
            )}
          </Card>
        )}
        <Card title="History">
          <ul className="small">
            {d.versions.map((v: any) => (
              <li key={v.id}>
                v{v.version} snapshot · {fmtDate(v.created_at)}
              </li>
            ))}
          </ul>
          <ul className="small">
            {d.audit.slice(0, 10).map((a: any) => (
              <li key={a.id}>
                {fmtDate(a.created_at)} · {a.action}
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <Card title="Content" actions={<button className="btn btn-sm" onClick={() => setPreview(!preview)}>{preview ? 'Edit' : 'Preview'}</button>}>
        {preview ? (
          <>
            <Markdown text={f.stem} />
            {d.question_type === 'MCQ' && (
              <ul>
                {Object.entries(f.options).map(([k, v]) => (
                  <li key={k}>
                    <strong>{k}</strong> <Markdown text={v as string} inline />
                  </li>
                ))}
              </ul>
            )}
            <p>
              <strong>Answer:</strong> {f.answer}
            </p>
            <Markdown text={f.solution.learn} />
          </>
        ) : (
          <>
            <div className="grid grid-3">
              <div className="field">
                <label htmlFor="ae-topic">Topic</label>
                <select id="ae-topic" value={f.topicId} onChange={(e) => set('topicId', e.target.value)}>
                  {(topics.data?.items ?? [])
                    .filter((t: any) => t.section_id === d.section_id)
                    .map((t: any) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="ae-diff">Difficulty</label>
                <select id="ae-diff" value={f.difficulty} onChange={(e) => set('difficulty', e.target.value)}>
                  {['easy', 'medium', 'difficult', 'advanced'].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="ae-time">Target time (s)</label>
                <input id="ae-time" type="number" value={f.estimatedTimeSec} onChange={(e) => set('estimatedTimeSec', e.target.value)} />
              </div>
              {isHistorical && (
                <>
                  <div className="field">
                    <label htmlFor="ae-year">Exam year</label>
                    <input id="ae-year" type="number" value={f.examYear} onChange={(e) => set('examYear', e.target.value)} />
                  </div>
                  <div className="field">
                    <label htmlFor="ae-slot">Slot</label>
                    <input id="ae-slot" type="number" min={1} max={3} value={f.examSlot} onChange={(e) => set('examSlot', e.target.value)} />
                  </div>
                  <div className="field">
                    <label htmlFor="ae-num">Question number in the paper</label>
                    <input id="ae-num" type="number" min={1} value={f.questionNumber} onChange={(e) => set('questionNumber', e.target.value)} />
                  </div>
                </>
              )}
            </div>
            <div className="field">
              <label htmlFor="ae-stem">Question (markdown, $…$ for math)</label>
              <textarea id="ae-stem" style={{ minHeight: 140 }} value={f.stem} onChange={(e) => set('stem', e.target.value)} />
              <label htmlFor="ae-img" className="small mt">
                Insert diagram (PNG, JPEG or WebP, up to 2 MB)
              </label>
              <input id="ae-img" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => void upload(e.target.files?.[0])} />
            </div>
            {d.question_type === 'MCQ' &&
              Object.keys(f.options).map((k) => (
                <div className="field" key={k}>
                  <label htmlFor={`ae-o-${k}`}>Option {k}</label>
                  <input id={`ae-o-${k}`} style={{ width: '100%' }} value={f.options[k]} onChange={(e) => set('options', { ...f.options, [k]: e.target.value })} />
                </div>
              ))}
            <div className="field">
              <label htmlFor="ae-ans">Correct answer</label>
              <input id="ae-ans" value={f.answer} onChange={(e) => set('answer', e.target.value)} />
            </div>
            <h3>Solution</h3>
            {(
              [
                ['learn', 'Step-by-step (learn mode)', 160],
                ['examMethod', 'Exam method', 80],
                ['hints', 'Hints (one per line)', 80],
                ['verification', 'Answer check', 60],
                ['commonMistakes', 'Common mistakes', 60],
                ['conceptsTested', 'Concepts tested', 40],
                ['prerequisites', 'Prerequisites', 40],
                ['alternative', 'Alternative method', 60],
                ['advanced', 'Advanced insight', 60],
                ['distractors', 'Distractor analysis (JSON: option → why wrong)', 100],
              ] as const
            ).map(([k, l, h]) => (
              <div className="field" key={k}>
                <label htmlFor={`ae-s-${k}`}>{l}</label>
                <textarea id={`ae-s-${k}`} style={{ minHeight: h, fontFamily: k === 'distractors' ? 'var(--mono)' : undefined }} value={f.solution[k]} onChange={(e) => setS(k, e.target.value)} />
              </div>
            ))}
          </>
        )}
        <button className="btn btn-primary" onClick={() => void save()}>
          Save new version
        </button>
      </Card>
    </div>
  );
}

export function AdminAudit() {
  const a = useApi('/api/admin/audit?pageSize=100');
  return (
    <div>
      <PageHeader title="Audit log" />
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>Action</th>
              <th>Entity</th>
            </tr>
          </thead>
          <tbody>
            {(a.data?.items ?? []).map((r: any) => (
              <tr key={r.id}>
                <td className="small nowrap">{new Date(r.created_at).toLocaleString()}</td>
                <td className="small">{r.actor_email ?? 'system'}</td>
                <td>
                  <code>{r.action}</code>
                </td>
                <td className="small">
                  {r.entity_type === 'question' ? <Link to={`/admin/questions/${r.entity_id}`}>{r.entity_id}</Link> : `${r.entity_type} ${r.entity_id}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
