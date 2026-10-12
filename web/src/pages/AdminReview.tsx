import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Card, Empty, ErrorBox, OriginBadge, PageHeader, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { fmtDate } from '../lib/format';
import { useApi } from '../lib/useApi';

type Status = 'pending' | 'rejected' | 'approved';

/**
 * Review queue for questions submitted as authentic CAT PYQs. Nothing reaches learners as a
 * verified PYQ until an admin approves it here, after the automated checks pass.
 */
export function AdminReview() {
  const [status, setStatus] = useState<Status>('pending');
  const q = useApi(`/api/admin/review?status=${status}`);
  const units: any[] = q.data?.units ?? [];
  return (
    <div>
      <PageHeader
        title="PYQ review queue"
        subtitle="Compare each submission with the cited question paper and answer key. Passages and DILR sets are approved as a whole."
      />
      <div className="row mb" role="radiogroup" aria-label="Show">
        {(['pending', 'rejected', 'approved'] as Status[]).map((s) => (
          <button key={s} className={`btn btn-sm ${status === s ? 'btn-primary' : ''}`} aria-pressed={status === s} onClick={() => setStatus(s)}>
            {s === 'pending' ? 'Awaiting review' : s === 'rejected' ? 'Rejected' : 'Approved'}
          </button>
        ))}
      </div>
      <ErrorBox error={q.error} onRetry={q.reload} />
      {q.loading && !q.data ? (
        <Spinner />
      ) : units.length === 0 ? (
        <Empty>
          {status === 'pending'
            ? 'Nothing is waiting for review. Questions imported as authentic PYQs appear here.'
            : status === 'rejected'
              ? 'No rejected submissions.'
              : 'No PYQs have been approved yet.'}
        </Empty>
      ) : (
        units.map((u) => <ReviewUnit key={`${u.kind}-${u.id}`} unit={u} status={status} onDone={q.reload} />)
      )}
    </div>
  );
}

function CheckList({ checks }: { checks: any[] }) {
  return (
    <ul className="checks small" aria-label="Automated checks">
      {checks.map((c) => (
        <li key={c.code} className={c.ok ? 'ok' : c.blocking ? 'fail' : 'warn'}>
          <span aria-hidden="true">{c.ok ? '✓' : c.blocking ? '✗' : '!'}</span> <span className="sr-only">{c.ok ? 'Passed:' : c.blocking ? 'Failed:' : 'Warning:'}</span> {c.message}
        </li>
      ))}
    </ul>
  );
}

function ReviewUnit({ unit, status, onDone }: { unit: any; status: Status; onDone: () => void }) {
  const [confirm, setConfirm] = useState({ paperSource: false, answerKey: false, solution: false });
  const [note, setNote] = useState('');
  const [publish, setPublish] = useState(true);
  const [err, setErr] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const g = unit.group;
  const confirmed = confirm.paperSource && confirm.answerKey && confirm.solution;
  const run = async (fn: () => Promise<unknown>) => {
    setErr(null);
    setBusy(true);
    try {
      await fn();
      onDone();
    } catch (e) {
      setErr(e as Error);
    } finally {
      setBusy(false);
    }
  };
  const approve = () =>
    run(() =>
      api.post(unit.kind === 'question' ? `/api/admin/review/questions/${unit.id}/approve` : `/api/admin/review/groups/${unit.kind}/${unit.id}/approve`, { confirm, note, publish }),
    );
  const reject = () => run(() => api.post('/api/admin/review/reject', { questionIds: unit.questions.map((q: any) => q.id), note }));
  const first = unit.questions[0];
  const title = g
    ? `${unit.kind === 'passage' ? 'Passage' : 'DILR set'}: ${g.title}`
    : `CAT ${first.exam_year ?? '?'}${first.exam_slot ? ` slot ${first.exam_slot}` : ''}, ${first.section_id} Q${first.question_number ?? '?'}`;

  return (
    <Card
      title={
        <span className="row">
          <h2 style={{ margin: 0 }}>{title}</h2>
          {status === 'pending' && <Badge tone={unit.ready ? 'good' : 'bad'}>{unit.ready ? 'checks pass' : 'checks fail'}</Badge>}
        </span>
      }
    >
      {g && (
        <div className="mb">
          <div className="small">
            {g.external_id} · CAT {g.exam_year ?? '?'}
            {g.exam_slot ? ` slot ${g.exam_slot}` : ''} · source: {g.source_name ? `${g.source_name}, ${g.source_reference}` : <Badge tone="bad">missing</Badge>}
            {g.source_url && (
              <>
                {' '}
                · <a href={g.source_url} target="_blank" rel="noreferrer noopener">link</a>
              </>
            )}
          </div>
          <details className="small">
            <summary>Show the {unit.kind === 'passage' ? 'passage' : 'set'} text</summary>
            <p style={{ whiteSpace: 'pre-wrap' }}>{g.body_preview}…</p>
          </details>
        </div>
      )}
      {unit.questions.map((q: any) => (
        <div key={q.id} className="review-q">
          <div className="row-between">
            <span className="row">
              <Link to={`/admin/questions/${q.id}`}>{q.external_id}</Link>
              <OriginBadge origin="authentic_pyq" review_status={q.review_status} year={q.exam_year} slot={q.exam_slot} number={q.question_number} />
              <span className="tiny muted">
                {q.section_id} · {q.question_type}
                {q.import_filename ? ` · from ${q.import_filename}` : ''}
              </span>
            </span>
            <span className="tiny muted">updated {fmtDate(q.updated_at)}</span>
          </div>
          <p className="small">{q.stem_preview}</p>
          {q.review_note && status !== 'pending' && <p className="small muted">Review note: {q.review_note}</p>}
          <CheckList checks={q.checks} />
        </div>
      ))}
      {status === 'pending' && (
        <fieldset className="mt stack">
          <legend>Your review</legend>
          <label className="check">
            <input type="checkbox" checked={confirm.paperSource} onChange={(e) => setConfirm({ ...confirm, paperSource: e.target.checked })} /> I compared the text, options and numbering with the cited question paper
          </label>
          <label className="check">
            <input type="checkbox" checked={confirm.answerKey} onChange={(e) => setConfirm({ ...confirm, answerKey: e.target.checked })} /> I checked the stored answer against the cited answer key
          </label>
          <label className="check">
            <input type="checkbox" checked={confirm.solution} onChange={(e) => setConfirm({ ...confirm, solution: e.target.checked })} /> I worked through the solution and it reaches that answer
          </label>
          <label className="check">
            <input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} /> Publish to learners when approved
          </label>
          <div className="field">
            <label htmlFor={`rv-note-${unit.id}`}>Note (required to reject)</label>
            <textarea id={`rv-note-${unit.id}`} value={note} onChange={(e) => setNote(e.target.value)} style={{ minHeight: 60 }} />
          </div>
          <ErrorBox error={err} />
          <div className="row">
            <button className="btn btn-primary" disabled={busy || !unit.ready || !confirmed} onClick={() => void approve()}>
              Approve{unit.questions.length > 1 ? ` all ${unit.questions.length}` : ''}
            </button>
            <button className="btn" disabled={busy || !note.trim()} onClick={() => void reject()}>
              Reject
            </button>
          </div>
          {!unit.ready && <p className="small muted">Fix the failed checks first: open the question, correct it, and save. It stays in this queue.</p>}
        </fieldset>
      )}
    </Card>
  );
}
