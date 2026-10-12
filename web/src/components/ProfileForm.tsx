import { type FormEvent, useState } from 'react';
import { api } from '../lib/api';
import type { Profile } from '../lib/auth';
import { ErrorBox, Field } from './ui';

const RATINGS = [
  ['weak', 'Weak'],
  ['needs_improvement', 'Needs improvement'],
  ['average', 'Average'],
  ['strong', 'Strong'],
];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function ProfileForm({ profile, onSaved, submitLabel = 'Save' }: { profile: Profile; onSaved: (p: Profile) => void; submitLabel?: string }) {
  const [f, setF] = useState({
    displayName: profile.display_name ?? '',
    education: profile.education ?? '',
    currentStatus: profile.current_status ?? '',
    qaSelfRating: profile.qa_self_rating,
    varcSelfRating: profile.varc_self_rating,
    dilrSelfRating: profile.dilr_self_rating,
    workdayMinutes: profile.workday_minutes,
    weekendMinutes: profile.weekend_minutes,
    offDays: (profile.off_days ?? []) as number[],
    weekendDays: (profile.weekend_days ?? [0, 6]) as number[],
    examYear: profile.exam_year,
    examDate: profile.exam_date ?? '',
    goal: profile.goal ?? '',
    lowTimeMode: !!profile.low_time_mode,
    gamificationEnabled: !!profile.gamification_enabled,
  });
  const [err, setErr] = useState<Error | null>(null);
  const [saved, setSaved] = useState(false);
  const set = (k: string, v: unknown) => (setSaved(false), setF((x) => ({ ...x, [k]: v })));
  const toggleDay = (k: 'offDays' | 'weekendDays', d: number) => set(k, f[k].includes(d) ? f[k].filter((x) => x !== d) : [...f[k], d].sort());

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      const p = await api.patch('/api/profile', { ...f, examDate: f.examDate || null, workdayMinutes: Number(f.workdayMinutes), weekendMinutes: Number(f.weekendMinutes), examYear: Number(f.examYear) });
      setSaved(true);
      onSaved(p);
    } catch (x) {
      setErr(x as Error);
    }
  };

  return (
    <form onSubmit={submit}>
      <ErrorBox error={err} />
      <div className="grid grid-2">
        <Field label="Name">{(id) => <input id={id} value={f.displayName} onChange={(e) => set('displayName', e.target.value)} />}</Field>
        <Field label="Goal">{(id) => <input id={id} value={f.goal} onChange={(e) => set('goal', e.target.value)} />}</Field>
        <Field label="Education">{(id) => <input id={id} value={f.education} onChange={(e) => set('education', e.target.value)} />}</Field>
        <Field label="Current status">{(id) => <input id={id} value={f.currentStatus} onChange={(e) => set('currentStatus', e.target.value)} />}</Field>
      </div>
      <fieldset>
        <legend>How do you rate yourself today?</legend>
        <div className="grid grid-3">
          {(
            [
              ['qaSelfRating', 'Quant (QA)'],
              ['varcSelfRating', 'Verbal & RC (VARC)'],
              ['dilrSelfRating', 'DI & LR (DILR)'],
            ] as const
          ).map(([k, label]) => (
            <Field key={k} label={label}>
              {(id) => (
                <select id={id} value={f[k]} onChange={(e) => set(k, e.target.value)}>
                  {RATINGS.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Study time</legend>
        <div className="grid grid-3">
          <Field label="Minutes on a working day">{(id) => <input id={id} type="number" min={10} max={600} value={f.workdayMinutes} onChange={(e) => set('workdayMinutes', e.target.value)} />}</Field>
          <Field label="Minutes on a weekend day">{(id) => <input id={id} type="number" min={0} max={720} value={f.weekendMinutes} onChange={(e) => set('weekendMinutes', e.target.value)} />}</Field>
          <Field label="CAT year">{(id) => <input id={id} type="number" min={2015} max={2100} value={f.examYear} onChange={(e) => set('examYear', e.target.value)} />}</Field>
          <Field label="Exam date (if known)" hint="Used to cap revision intervals and plan length.">
            {(id) => <input id={id} type="date" value={f.examDate} onChange={(e) => set('examDate', e.target.value)} />}
          </Field>
        </div>
        <div className="small mb">Weekend days</div>
        <div className="row mb">
          {DAYS.map((d, i) => (
            <label key={d} className="check">
              <input type="checkbox" checked={f.weekendDays.includes(i)} onChange={() => toggleDay('weekendDays', i)} /> {d}
            </label>
          ))}
        </div>
        <div className="small mb">Days off (no study scheduled)</div>
        <div className="row mb">
          {DAYS.map((d, i) => (
            <label key={d} className="check">
              <input type="checkbox" checked={f.offDays.includes(i)} onChange={() => toggleDay('offDays', i)} /> {d}
            </label>
          ))}
        </div>
        <label className="check">
          <input type="checkbox" checked={f.lowTimeMode} onChange={(e) => set('lowTimeMode', e.target.checked)} /> Low-time mode (20-minute daily sessions)
        </label>
        <label className="check">
          <input type="checkbox" checked={f.gamificationEnabled} onChange={(e) => set('gamificationEnabled', e.target.checked)} /> Show streaks
        </label>
      </fieldset>
      <div className="row">
        <button className="btn btn-primary">{submitLabel}</button>
        {saved && <span className="small muted">Saved.</span>}
      </div>
    </form>
  );
}
