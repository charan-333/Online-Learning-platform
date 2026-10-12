import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart, LineChart } from '../components/Charts';
import { Card, Empty, ErrorBox, PageHeader, Spinner, Stat, StateBadge, Tabs } from '../components/ui';
import { fmtDate, fmtSec, pct } from '../lib/format';

const attemptsLabel = (n: number) => `${n} attempt${n === 1 ? '' : 's'}`;
import { useApi } from '../lib/useApi';

export function Analytics() {
  const o = useApi('/api/analytics/overview');
  const topics = useApi('/api/analytics/topics');
  const errs = useApi('/api/analytics/errors');
  const [sec, setSec] = useState<'QA' | 'VARC' | 'DILR'>('QA');
  if (o.loading && !o.data) return <Spinner />;
  if (o.error) return <ErrorBox error={o.error} />;
  const d = o.data;
  const h = d.headline;
  return (
    <div>
      <PageHeader title="Analytics" subtitle="Four different measures, kept separate on purpose: what you have covered, what you have mastered, how you score in tests, and how many topics are exam-ready." />
      <div className="grid grid-4 mb">
        <Card>
          <Stat label="Syllabus started" value={pct(h.syllabusCompletion)} hint="Topics with any attempt" />
        </Card>
        <Card>
          <Stat label="Concept mastery" value={h.conceptMastery ?? 0} hint="Average 0–100 score over all topics" />
        </Card>
        <Card>
          <Stat label="Test performance" value={h.testPerformance === null ? '—' : `${h.testPerformance}%`} hint="Mean score % over last 5 tests" />
        </Card>
        <Card>
          <Stat label="Exam-ready topics" value={pct(h.examReadiness)} hint="Proficient or exam-ready" />
        </Card>
      </div>
      <p className="small muted mb">No percentile or admission prediction is shown: CAT 100 has no calibrated data that maps these numbers to percentiles.</p>
      {d.attempts.total === 0 ? (
        <Empty>No attempts yet. Analytics appear once you start answering questions.</Empty>
      ) : (
        <>
          <div className="grid grid-2">
            <Card title="Accuracy">
              <div className="grid grid-3">
                <Stat label="Overall" value={pct(d.attempts.accuracy)} hint={attemptsLabel(d.attempts.total)} />
                <Stat label="Timed" value={pct(d.attempts.timedAccuracy)} hint={attemptsLabel(d.attempts.timedCount)} />
                <Stat label="Untimed" value={pct(d.attempts.untimedAccuracy)} hint={attemptsLabel(d.attempts.untimedCount)} />
              </div>
              <div className="mt">
                <BarChart label="Accuracy by difficulty (%)" unit="%" max={100} data={d.byDifficulty.map((x: any) => ({ label: x.difficulty, value: x.accuracy }))} />
              </div>
            </Card>
            <Card title="Sections">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Section</th>
                      <th>Mastery</th>
                      <th>Ready topics</th>
                      <th>Attempts</th>
                      <th>Accuracy</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.sections.map((s: any) => (
                      <tr key={s.section_id}>
                        <td>{s.section_id}</td>
                        <td>{s.mastery}</td>
                        <td>
                          {s.ready} / {s.topics}
                        </td>
                        <td>{s.attempts}</td>
                        <td>{pct(s.accuracy)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="small mt">
                Median time per question {fmtSec(d.timing.medianSec)} · active {d.consistency.active_days_7} of last 7 days, {d.consistency.active_days_28} of last 28
              </p>
              <p className="small">
                Revision: {d.revision.due} due of {d.revision.active} active · Errors: {d.errors.open} open, {d.errors.resolved} resolved, {d.errors.recurred} recurred after review
              </p>
              <p className="small">
                Question bank coverage: {d.questionBank.all_done} of {d.questionBank.all_total} attempted · authentic PYQs {d.questionBank.pyq_done} of {d.questionBank.pyq_total} ({d.questionBank.pyq_verified} with verified source)
              </p>
            </Card>
          </div>
          <Card title="Mock test trend">
            {d.mockTrend.length === 0 ? (
              <p className="small muted">Take a test to see a trend.</p>
            ) : (
              <LineChart label="Mock score as % of maximum" unit="%" max={100} data={d.mockTrend.map((m: any) => ({ label: fmtDate(m.submitted_at).replace(/ \d{4}$/, ''), value: m.percent ?? 0 }))} />
            )}
          </Card>
          {(errs.data?.items ?? []).length > 0 && (
            <Card title="Mistakes by type">
              <BarChart label="Error log entries by type" data={errs.data.items.slice(0, 10).map((e: any) => ({ label: `${e.label} (${e.section_id})`, value: Number(e.n) }))} />
            </Card>
          )}
        </>
      )}
      <Card title="Topics">
        <Tabs label="Section" value={sec} onChange={setSec} tabs={(['QA', 'VARC', 'DILR'] as const).map((s) => ({ id: s, label: s }))} />
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Topic</th>
                <th>State</th>
                <th>Attempts</th>
                <th>Accuracy</th>
                <th>Timed accuracy</th>
                <th>Avg time / target</th>
              </tr>
            </thead>
            <tbody>
              {(topics.data?.items ?? [])
                .filter((t: any) => t.section_id === sec)
                .map((t: any) => (
                  <tr key={t.id}>
                    <td>
                      <Link to={`/syllabus/${t.id}`}>{t.name}</Link>
                    </td>
                    <td>
                      <StateBadge state={t.state} score={t.mastery} />
                    </td>
                    <td>{t.attempts}</td>
                    <td>{t.attempts ? pct((t.correct / t.attempts) * 100) : '—'}</td>
                    <td>{t.timed ? pct((t.timed_correct / t.timed) * 100) : '—'}</td>
                    <td className="small">{t.attempts ? `${fmtSec(t.avg_time)} / ${fmtSec(t.avg_estimate)}` : '—'}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
