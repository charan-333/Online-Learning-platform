import { Link } from 'react-router-dom';
import { Badge, Card, Empty, ErrorBox, PageHeader, Progress, Spinner, Stat, StateBadge } from '../components/ui';
import { useAuth } from '../lib/auth';
import { pct } from '../lib/format';
import { useApi } from '../lib/useApi';

export function Dashboard() {
  const { profile } = useAuth();
  const overview = useApi('/api/analytics/overview');
  const today = useApi('/api/plans/today');
  const due = useApi('/api/revision/due');
  const sessions = useApi('/api/study-sessions');
  if (overview.loading && !overview.data) return <Spinner />;
  if (overview.error) return <ErrorBox error={overview.error} onRetry={overview.reload} />;
  const o = overview.data;
  const h = o.headline;
  const tasks = today.data?.tasks ?? [];
  const doneMin = tasks.filter((t: any) => t.status === 'done').reduce((s: number, t: any) => s + t.minutes, 0);
  const totalMin = tasks.reduce((s: number, t: any) => s + t.minutes, 0);

  return (
    <div>
      <PageHeader
        title={`Hello${profile?.display_name ? ', ' + profile.display_name : ''}`}
        subtitle={profile?.exam_date ? `CAT ${profile.exam_year} on ${new Date(profile.exam_date + 'T00:00:00').toLocaleDateString()}` : `Preparing for CAT ${profile?.exam_year ?? ''}`}
        actions={
          <Link className="btn btn-primary" to="/lesson">
            Start today’s lesson
          </Link>
        }
      />
      {o.questionBank && Number(o.questionBank.pyq_total ?? 0) === 0 && (
        <div className="alert alert-warn">
          No verified CAT PYQs are available yet. Practice uses questions written for CAT 100, each labelled as such. Verified PYQs will be picked first once an editor imports and approves them.
        </div>
      )}
      <div className="grid grid-4 mb">
        <Card>
          <Stat label="Syllabus started" value={pct(h.syllabusCompletion)} hint="Topics with at least one attempt" />
        </Card>
        <Card>
          <Stat label="Average concept mastery" value={h.conceptMastery ?? 0} hint="0–100 across all topics" />
        </Card>
        <Card>
          <Stat label="Recent test performance" value={h.testPerformance === null ? '—' : `${h.testPerformance}%`} hint={h.testPerformance === null ? 'Take a mock to see this' : 'Score as % of maximum, last mocks'} />
        </Card>
        <Card>
          <Stat label="Topics exam-ready" value={pct(h.examReadiness)} hint="Not a percentile prediction" />
        </Card>
      </div>
      <div className="grid grid-2">
        <Card
          title="Today’s plan"
          actions={
            <Link className="small" to="/plan">
              Full plan
            </Link>
          }
        >
          {tasks.length === 0 ? (
            <Empty>
              No tasks scheduled today. <Link to="/plan">Open the planner</Link>
            </Empty>
          ) : (
            <>
              <Progress value={doneMin} max={totalMin} label="Today’s plan completion" />
              <ul className="list mt">
                {tasks.map((t: any) => (
                  <li key={t.id} className="row-between">
                    <span>
                      {t.status === 'done' ? '✓ ' : ''}
                      {t.title}
                    </span>
                    <span className="small muted">{t.minutes} min</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {today.data?.minimumViable && (
            <p className="small muted mt">
              Short on time? The minimum session is {today.data.minimumViable.minutes} minutes: {today.data.minimumViable.description}{' '}
              <Link to="/lesson?minutes=20">Start a 20-minute lesson</Link>
            </p>
          )}
        </Card>
        <Card title="What to work on next">
          {(o.nextActions ?? []).length === 0 ? (
            <Empty>Answer a few questions to get recommendations.</Empty>
          ) : (
            <ul className="list">
              {o.nextActions.map((r: any) => (
                <li key={r.topicId}>
                  <div className="row-between">
                    <Link to={`/syllabus/${r.topicId}`}>{r.topicName}</Link>
                    <span className="row">
                      <Badge>{r.sectionId}</Badge>
                      <StateBadge state={r.state} score={r.score} />
                    </span>
                  </div>
                  <div className="small muted">{r.reasons.join(' ')}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card
          title="Revision"
          actions={
            <Link className="small" to="/revision">
              Open queue
            </Link>
          }
        >
          <Stat label="Items due now" value={due.data?.items?.length ?? '—'} hint={due.data?.totalSec ? `About ${Math.ceil(due.data.totalSec / 60)} min` : undefined} />
          <p className="small muted mt">Wrong answers, guesses, low-confidence answers and formulas you add come back on a spaced schedule.</p>
        </Card>
        <Card title="Practice record">
          <div className="grid grid-3">
            <Stat label="Questions answered" value={o.attempts.total} />
            <Stat label="Accuracy" value={pct(o.attempts.accuracy)} />
            <Stat label="Open errors" value={o.errors?.open ?? 0} />
          </div>
          {profile?.gamification_enabled && sessions.data && (
            <p className="small mt">
              Current streak: <strong>{sessions.data.currentStreak}</strong> day(s) · active on {sessions.data.activeDays28} of the last 28 days
            </p>
          )}
          {(o.riskAreas ?? []).length > 0 && (
            <div className="mt">
              <div className="small">Risk areas</div>
              <ul className="small">
                {o.riskAreas.map((r: any) => (
                  <li key={r.id}>
                    <Link to={`/syllabus/${r.id}`}>{r.name}</Link> <StateBadge state={r.state} score={r.score} /> <span className="muted">{r.state_reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
