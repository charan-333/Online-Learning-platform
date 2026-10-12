import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { fmtDate } from '../lib/format';
import { Markdown } from './Markdown';
import { Badge } from './ui';

const REASON: Record<string, string> = {
  incorrect: 'Answered incorrectly',
  low_confidence: 'Low confidence',
  guessed: 'Guessed',
  first_exposure: 'New material',
  high_value_formula: 'High-value formula',
};
const GRADES = [
  [0, 'Forgot', 'Back to the start: seen again tomorrow'],
  [1, 'Hard', 'Shorter interval'],
  [2, 'Good', 'Normal interval'],
  [3, 'Easy', 'Longer interval'],
] as const;

/** One revision card: recall first, then reveal and self-grade. */
export function RevisionItem({ item, onReviewed }: { item: any; onReviewed: (id: string, result: any) => void }) {
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const grade = async (g: number) => {
    setBusy(true);
    try {
      onReviewed(item.id, await api.post(`/api/revision/${item.id}/review`, { grade: g }));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="row-between">
        <div className="row">
          <Badge tone="accent">{item.itemType === 'error' ? 'Mistake' : item.itemType}</Badge>
          {item.topicName && <span className="small">{item.topicName}</span>}
          <Badge tone="outline">{REASON[item.reason] ?? item.reason}</Badge>
        </div>
        <span className="tiny muted">
          Reviewed {item.reps}× · lapses {item.lapses}
        </span>
      </div>
      <div className="mt">
        {item.formula ? (
          <>
            <strong>{item.formula.title}</strong>
            {shown ? (
              <>
                <Markdown text={`$$${item.formula.tex}$$`} />
                <Markdown text={item.formula.explanation} />
              </>
            ) : (
              <p className="small muted">Write the formula and when it applies, then reveal.</p>
            )}
          </>
        ) : item.question ? (
          <>
            <Markdown text={item.question.stem.length > 600 ? item.question.stem.slice(0, 600) + '…' : item.question.stem} />
            <p className="small">
              Solve it again, then <Link to={`/practice/${item.question.id}?context=revision`}>open the full question</Link> to check, or grade your recall here.
            </p>
          </>
        ) : (
          <p>
            Review the topic notes: <Link to={`/syllabus/${item.topicId}`}>{item.topicName}</Link>
          </p>
        )}
      </div>
      {!shown && item.formula ? (
        <button className="btn btn-sm" onClick={() => setShown(true)}>
          Reveal
        </button>
      ) : (
        <div className="row mt" role="group" aria-label="How well did you recall it?">
          {GRADES.map(([g, label, hint]) => (
            <button key={g} className="btn btn-sm" title={hint} disabled={busy} onClick={() => void grade(g)}>
              {label}
            </button>
          ))}
        </div>
      )}
      {item.dueAt && <div className="tiny muted mt">Due {fmtDate(item.dueAt)}</div>}
    </div>
  );
}
