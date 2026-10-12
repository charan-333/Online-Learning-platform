import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Card, Empty, ErrorBox, PageHeader, Progress, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { fmtDate, fmtDay, todayStr } from '../lib/format';
import { useApi } from '../lib/useApi';

const TYPE_TONE: Record<string, any> = { learn: 'accent', practice: 'info', revision: 'warn', mock: 'bad', mock_review: 'bad', catch_up: '' };

export function Plan() {
  const cur = useApi('/api/plans/current');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Error | null>(null);
  if (cur.loading && !cur.data) return <Spinner />;
  if (cur.error) return <ErrorBox error={cur.error} />;
  const generate = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.post('/api/plans/generate', {});
      await cur.reload();
    } catch (e) {
      setErr(e as Error);
    } finally {
      setBusy(false);
    }
  };
  const setStatus = async (taskId: string, status: string) => {
    await api.patch(`/api/plans/${cur.data.plan.id}`, { taskId, status });
    cur.reload();
  };
  const reflow = async () => {
    await api.patch(`/api/plans/${cur.data.plan.id}`, { action: 'reallocate' });
    cur.reload();
  };
  if (!cur.data?.plan)
    return (
      <div>
        <PageHeader title="Study plan" />
        <ErrorBox error={err} />
        <Card>
          <p>You do not have a plan yet. It is built from your available time, off days, self-ratings or diagnostic, and topic prerequisites.</p>
          <button className="btn btn-primary" disabled={busy} onClick={() => void generate()}>
            Build my plan
          </button>
        </Card>
      </div>
    );
  const { plan, tasks, totals, reallocation } = cur.data;
  const byDay = new Map<string, any[]>();
  for (const t of tasks) byDay.set(t.scheduled_date, [...(byDay.get(t.scheduled_date) ?? []), t]);
  const days = [...byDay.keys()].slice(0, 21);
  const total = Number(totals.done) + Number(totals.pending) + Number(totals.skipped);
  return (
    <div>
      <PageHeader
        title="Study plan"
        subtitle={`${fmtDate(plan.start_date)} to ${fmtDate(plan.end_date)}`}
        actions={
          <>
            <button className="btn" onClick={() => void reflow()}>
              Re-plan missed tasks
            </button>
            <button className="btn" disabled={busy} onClick={() => void generate()}>
              Rebuild plan
            </button>
          </>
        }
      />
      <ErrorBox error={err} />
      {reallocation?.moved > 0 && <div className="alert alert-info">{reallocation.moved} unfinished task(s) from earlier days were moved forward. Nothing was duplicated.</div>}
      {reallocation?.skipped > 0 && <div className="alert alert-info">{reallocation.skipped} overdue revision task(s) were dropped; the revision queue already tracks those items.</div>}
      <Card>
        <Progress value={Number(totals.done)} max={total} label="Plan progress" />
        <p className="small mt">
          {totals.done} done · {totals.pending} pending ({Math.round(Number(totals.pending_minutes) / 60)} h) · {totals.skipped} skipped
        </p>
        {plan.rationale && <p className="small muted">{plan.rationale}</p>}
      </Card>
      {days.length === 0 ? (
        <Empty>No tasks in the next few weeks.</Empty>
      ) : (
        days.map((day) => {
          const list = byDay.get(day)!;
          const mins = list.reduce((s, t) => s + t.minutes, 0);
          return (
            <Card key={day} title={<h3 style={{ margin: 0 }}>{day === todayStr() ? `Today · ${fmtDay(day)}` : fmtDay(day)}</h3>} actions={<span className="small muted">{mins} min</span>}>
              <ul className="list">
                {list.map((t) => (
                  <li key={t.id} className="row-between">
                    <div className="row">
                      <Badge tone={TYPE_TONE[t.task_type]}>{t.task_type.replace('_', ' ')}</Badge>
                      <span style={{ textDecoration: t.status === 'skipped' ? 'line-through' : undefined }}>
                        {t.status === 'done' ? '✓ ' : ''}
                        {t.topic_id ? <Link to={`/syllabus/${t.topic_id}`}>{t.title}</Link> : t.title}
                      </span>
                      {t.original_date !== t.scheduled_date && <span className="tiny muted">moved from {fmtDay(t.original_date)}</span>}
                    </div>
                    <div className="row">
                      <span className="small muted">{t.minutes} min</span>
                      {t.status === 'pending' ? (
                        <>
                          {(t.task_type === 'learn' || t.task_type === 'practice') && t.topic_id && day === todayStr() && (
                            <Link className="btn btn-sm" to={`/lesson?topic=${t.topic_id}&minutes=${Math.min(90, Math.max(20, t.minutes))}`}>
                              Start
                            </Link>
                          )}
                          <button className="btn btn-sm" onClick={() => void setStatus(t.id, 'done')}>
                            Done
                          </button>
                          <button className="btn btn-sm btn-ghost" onClick={() => void setStatus(t.id, 'skipped')}>
                            Skip
                          </button>
                        </>
                      ) : (
                        <button className="btn btn-sm btn-ghost" onClick={() => void setStatus(t.id, 'pending')}>
                          Undo
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          );
        })
      )}
    </div>
  );
}
