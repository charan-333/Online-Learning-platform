import { useState } from 'react';
import { Badge, Card, DifficultyBadge, ErrorBox, PageHeader } from '../components/ui';
import { api } from '../lib/api';
import { fmtDate, fmtSec } from '../lib/format';
import { useApi } from '../lib/useApi';

export function Strategy() {
  const history = useApi('/api/strategy/drills');
  const [section, setSection] = useState('QA');
  const [drill, setDrill] = useState<any>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState<Error | null>(null);

  const create = async () => {
    setErr(null);
    setResult(null);
    setChosen([]);
    try {
      setDrill(await api.post('/api/strategy/drills', { section, count: 10 }));
    } catch (e) {
      setErr(e as Error);
    }
  };
  const submit = async () => {
    try {
      setResult(await api.post(`/api/strategy/drills/${drill.id}/submit`, { chosen }));
      history.reload();
    } catch (e) {
      setErr(e as Error);
    }
  };
  const toggle = (id: string) => setChosen(chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id]);
  const planned = drill ? drill.items.filter((i: any) => chosen.includes(i.id)).reduce((s: number, i: any) => s + i.estimatedSec, 0) : 0;

  return (
    <div>
      <PageHeader title="Strategy drills" subtitle="Practise choosing what to attempt. You see only each question’s topic, difficulty, format and marking, with less time than it takes to do them all." />
      <ErrorBox error={err} />
      <Card>
        <div className="row">
          <label htmlFor="sd-sec" style={{ margin: 0 }}>
            Section
          </label>
          <select id="sd-sec" value={section} onChange={(e) => setSection(e.target.value)}>
            <option>QA</option>
            <option>DILR</option>
            <option>VARC</option>
          </select>
          <button className="btn btn-primary" onClick={() => void create()}>
            New drill
          </button>
        </div>
        <p className="small muted mt">Scoring uses expected marks from your own accuracy history in each topic (with a prior by difficulty when you have little data), so the “best” choice is personal to you.</p>
      </Card>
      {drill && (
        <Card title={`Budget: ${fmtSec(drill.budgetSec)}`} actions={<span className={`small ${planned > drill.budgetSec ? 'muted' : ''}`}>Planned {fmtSec(planned)}</span>}>
          <p className="small">{drill.instructions}</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Topic</th>
                  <th>Difficulty</th>
                  <th>Format</th>
                  <th>Marks</th>
                  <th>Typical time</th>
                  {result && (
                    <>
                      <th>Your chance</th>
                      <th>Expected marks</th>
                      <th>Optimal?</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {drill.items.map((it: any) => {
                  const r = result?.items.find((x: any) => x.id === it.id);
                  const order = chosen.indexOf(it.id);
                  return (
                    <tr key={it.id}>
                      <td>
                        <label className="check">
                          <input type="checkbox" checked={order >= 0} disabled={!!result} onChange={() => toggle(it.id)} aria-label={`Attempt ${it.topicName}`} />
                          {order >= 0 ? order + 1 : ''}
                        </label>
                      </td>
                      <td>{it.topicName}</td>
                      <td>
                        <DifficultyBadge d={it.difficulty} />
                      </td>
                      <td>{it.type}</td>
                      <td className="small">
                        +{it.marksCorrect} / {it.type === 'MCQ' ? it.marksWrong : 0}
                      </td>
                      <td>{fmtSec(it.estimatedSec)}</td>
                      {r && (
                        <>
                          <td>{Math.round(r.p * 100)}%</td>
                          <td>{r.ev}</td>
                          <td>{r.inOptimal ? <Badge tone="good">Yes</Badge> : <Badge>No</Badge>}</td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!result ? (
            <button className="btn btn-primary mt" disabled={!chosen.length} onClick={() => void submit()}>
              Submit my selection
            </button>
          ) : (
            <div className="alert alert-info mt">
              Your plan is worth <strong>{result.chosenEv}</strong> expected marks; the best plan for your record is worth <strong>{result.optimal.ev}</strong> (efficiency {result.efficiency}%).
              {result.overBudget && ' Your plan ran over the time budget, so only the questions that fit (in your order) were counted.'}
              {result.negativeEvChosen.length > 0 && ` ${result.negativeEvChosen.length} chosen question(s) had negative expected marks: skipping them is better than guessing.`}
            </div>
          )}
        </Card>
      )}
      {(history.data?.items ?? []).filter((h: any) => h.submitted_at).length > 0 && (
        <Card title="Past drills">
          <ul className="list">
            {history.data.items
              .filter((h: any) => h.submitted_at)
              .map((h: any) => (
                <li key={h.id} className="row-between small">
                  <span>
                    {fmtDate(h.created_at)} · {h.section_id}
                  </span>
                  <span>Efficiency {h.efficiency}%</span>
                </li>
              ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
