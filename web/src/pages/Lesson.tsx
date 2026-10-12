import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Markdown } from '../components/Markdown';
import { QuestionPlayer, SolutionView } from '../components/QuestionPlayer';
import { RevisionItem } from '../components/RevisionItem';
import { Badge, Card, ErrorBox, PageHeader, Progress, Spinner, StateBadge } from '../components/ui';
import { api } from '../lib/api';
import { fmtSec, pct } from '../lib/format';
import { useApi } from '../lib/useApi';

const LENGTHS = [20, 30, 60, 90];

export function LessonPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const minutes = params.get('minutes');
  const url = id ? `/api/lessons/${id}` : `/api/lessons/daily${minutes ? `?minutes=${minutes}` : ''}${params.get('topic') ? `${minutes ? '&' : '?'}topic=${params.get('topic')}` : ''}`;
  const lesson = useApi(url);
  const [active, setActive] = useState(0);
  const [msg, setMsg] = useState('');
  const [report, setReport] = useState<any>(null);

  useEffect(() => {
    if (!lesson.data) return;
    const doneKeys = new Set(lesson.data.progress.map((p: any) => p.block_key));
    const first = lesson.data.plan.blocks.findIndex((b: any) => !doneKeys.has(b.key));
    setActive(first < 0 ? lesson.data.plan.blocks.length - 1 : first);
    setReport(lesson.data.report);
  }, [lesson.data?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (lesson.loading && !lesson.data) return <Spinner label="Preparing your lesson" />;
  if (lesson.error) return <ErrorBox error={lesson.error} onRetry={lesson.reload} />;
  const L = lesson.data;
  const blocks = L.plan.blocks as any[];
  const doneKeys = new Set(L.progress.map((p: any) => p.block_key));
  const block = blocks[active];

  const complete = async () => {
    setMsg('');
    const r = await api.post(`/api/lessons/${L.id}/progress`, { blockKey: block.key });
    if (!r.blockDone) return setMsg(r.message);
    if (r.report) setReport(r.report);
    await lesson.reload();
    if (active < blocks.length - 1) setActive(active + 1);
  };

  return (
    <div>
      <PageHeader
        title={`Lesson: ${L.topic.name}`}
        subtitle={
          <>
            {L.minutes} minutes · {L.plan.objective} {L.rationale && <span className="small">Why this topic: {L.rationale}</span>}
          </>
        }
        actions={
          !id && (
            <label className="row small" style={{ margin: 0 }}>
              Length
              <select value={minutes ?? String(L.minutes)} onChange={(e) => setParams({ minutes: e.target.value })}>
                {LENGTHS.map((m) => (
                  <option key={m} value={m}>
                    {m} min
                  </option>
                ))}
              </select>
            </label>
          )
        }
      />
      <Progress value={doneKeys.size} max={blocks.length} label="Lesson progress" />
      <ol className="row mt mb" style={{ listStyle: 'none', padding: 0 }} aria-label="Lesson blocks">
        {blocks.map((b, i) => (
          <li key={b.key}>
            <button className={`btn btn-sm ${i === active ? 'btn-primary' : ''}`} onClick={() => setActive(i)} aria-current={i === active ? 'step' : undefined}>
              {doneKeys.has(b.key) ? '✓ ' : ''}
              {b.title} · {b.minutes}m
            </button>
          </li>
        ))}
      </ol>
      {report && <LessonReport report={report} />}
      {block && (
        <div>
          {block.note && <div className="alert alert-info">{block.note}</div>}
          <BlockBody lesson={L} block={block} onChange={() => void lesson.reload()} />
          <ErrorBox error={msg ? new Error(msg) : null} />
          {!doneKeys.has(block.key) && (
            <button className="btn btn-primary mt" onClick={() => void complete()}>
              {block.type === 'practice' || block.type === 'timed_challenge' ? 'Finish this block' : 'Mark block done'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function BlockBody({ lesson, block, onChange }: { lesson: any; block: any; onChange: () => void }) {
  const [qi, setQi] = useState(0);
  useEffect(() => setQi(0), [block.key]);
  if (block.type === 'revision') return <LessonRevision ids={block.revisionItemIds ?? []} />;
  if (block.type === 'concept')
    return (
      <Card title={lesson.topic.name}>
        <Markdown text={lesson.topic.concept_md} />
        {lesson.topic.traps_md && (
          <>
            <h3 className="mt">Traps to avoid</h3>
            <Markdown text={lesson.topic.traps_md} />
          </>
        )}
        {lesson.formulas.length > 0 && (
          <>
            <h3 className="mt">Formulas</h3>
            {lesson.formulas.map((f: any) => (
              <div key={f.id} className="mb">
                <strong>{f.title}</strong>
                <Markdown text={`$$${f.formula_tex}$$`} />
                <Markdown text={f.explanation_md} />
              </div>
            ))}
          </>
        )}
        {lesson.prerequisites.length > 0 && (
          <p className="small muted">
            Builds on: {lesson.prerequisites.map((p: any) => p.name).join(', ')}
          </p>
        )}
      </Card>
    );
  if (block.type === 'worked_example') return block.questionIds?.length ? <WorkedExample id={block.questionIds[0]} /> : null;
  if (block.type === 'review') return <LessonReview lesson={lesson} />;
  const ids: string[] = block.questionIds ?? [];
  if (!ids.length) return null;
  const answered = new Set(lesson.attempts.map((a: any) => a.question_id));
  return (
    <div>
      <div className="row mb">
        {ids.map((id, i) => (
          <button key={id} className={`btn btn-sm ${i === qi ? 'btn-primary' : ''}`} onClick={() => setQi(i)} aria-label={`Question ${i + 1}${answered.has(id) ? ', answered' : ''}`}>
            {answered.has(id) ? '✓' : ''} Q{i + 1}
          </button>
        ))}
        {block.type === 'timed_challenge' && <Badge tone="warn">Timed: aim for the target time on each question</Badge>}
      </div>
      <QuestionPlayer
        questionId={ids[qi]}
        context="lesson"
        contextId={lesson.id}
        timed={block.type === 'timed_challenge'}
        onAnswered={onChange}
        onNext={qi < ids.length - 1 ? () => setQi(qi + 1) : undefined}
      />
    </div>
  );
}

function WorkedExample({ id }: { id: string }) {
  const q = useApi(`/api/questions/${id}`);
  const s = useApi(`/api/questions/${id}/solution`);
  if (!q.data || !s.data) return <Spinner />;
  return (
    <Card title="Worked example">
      <p className="small muted">Read the question, try the first step yourself, then follow the full method. This question will not count toward your mastery score because you have seen its solution.</p>
      <Markdown text={q.data.stem_md} />
      {q.data.options?.length > 0 && (
        <ul>
          {q.data.options.map((o: any) => (
            <li key={o.key}>
              <strong>{o.key}.</strong> <Markdown text={o.text_md} inline />
            </li>
          ))}
        </ul>
      )}
      <p>
        <strong>Answer: {s.data.correct_answer}</strong>
      </p>
      <SolutionView solution={s.data} type={q.data.question_type} />
    </Card>
  );
}

function LessonRevision({ ids }: { ids: string[] }) {
  const due = useApi('/api/revision/due');
  const [done, setDone] = useState<Set<string>>(new Set());
  if (!ids.length) return null;
  if (!due.data) return <Spinner />;
  const items = due.data.items.filter((i: any) => ids.includes(i.id) && !done.has(i.id));
  if (!items.length) return <div className="alert alert-good">Revision for this lesson is done.</div>;
  return (
    <div>
      {items.map((it: any) => (
        <RevisionItem key={it.id} item={it} onReviewed={(id) => setDone(new Set([...done, id]))} />
      ))}
    </div>
  );
}

function LessonReview({ lesson }: { lesson: any }) {
  const wrong = lesson.attempts.filter((a: any) => !a.is_correct);
  return (
    <Card title="Review your mistakes">
      {wrong.length === 0 ? (
        <p>No incorrect answers in this lesson. Check the solutions of questions you guessed or answered slowly.</p>
      ) : (
        <>
          <p>Open each incorrect question, read the solution, and record what went wrong. Each is already in your error log and revision queue.</p>
          <ul>
            {wrong.map((a: any) => {
              const q = lesson.questions.find((x: any) => x.id === a.question_id);
              return (
                <li key={a.question_id}>
                  <Link to={`/practice/${a.question_id}`}>{q?.external_id ?? 'Question'}</Link> <span className="small muted">({fmtSec(a.time_taken_sec)})</span>
                </li>
              );
            })}
          </ul>
          <Link to="/errors">Open the error log</Link>
        </>
      )}
    </Card>
  );
}

function LessonReport({ report }: { report: any }) {
  return (
    <Card title="Lesson report">
      <div className="grid grid-4">
        <div>
          <div className="stat-label">Questions</div>
          <div className="stat-value">{report.questions}</div>
        </div>
        <div>
          <div className="stat-label">Accuracy</div>
          <div className="stat-value">{pct(report.accuracy)}</div>
        </div>
        <div>
          <div className="stat-label">Time efficiency</div>
          <div className="stat-value">{pct(report.timeEfficiency)}</div>
          <div className="tiny muted">Target time ÷ time taken</div>
        </div>
        <div>
          <div className="stat-label">Time spent</div>
          <div className="stat-value">{fmtSec(report.timeSpentSec)}</div>
        </div>
      </div>
      <p className="mt">{report.learned}</p>
      {report.mistakes && Object.keys(report.mistakes).length > 0 && <p className="small">Mistakes: {Object.entries(report.mistakes).map(([k, v]) => `${k.replace(/_/g, ' ')} ×${v}`).join(', ')}</p>}
      {report.conceptsNeedingRevision?.length > 0 && <p className="small">Needs revision: {report.conceptsNeedingRevision.join(', ')}</p>}
      {report.masteryAfter && (
        <p className="small">
          Mastery now: <StateBadge state={report.masteryAfter.state} score={report.masteryAfter.score} />
        </p>
      )}
      {report.nextAction && (
        <p>
          Next: <Link to={`/syllabus/${report.nextAction.topicId}`}>{report.nextAction.topicName}</Link> <span className="small muted">{report.nextAction.why}</span>
        </p>
      )}
    </Card>
  );
}
