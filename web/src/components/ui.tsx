import { type ReactNode, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ApiError } from '../lib/api';
import { DIFFICULTY_LABEL, ORIGIN_LABEL, STATE_LABEL } from '../lib/format';

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="empty" role="status" aria-live="polite">
      {label}…
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: ApiError | Error | null | undefined; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <div className="alert alert-error" role="alert">
      {error.message}
      {onRetry && (
        <button className="btn btn-sm" style={{ marginLeft: 8 }} onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Card({ title, actions, children, className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="card-title">
          {typeof title === 'string' ? <h2 style={{ margin: 0 }}>{title}</h2> : title}
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Badge({ tone = '', children, title }: { tone?: '' | 'good' | 'bad' | 'warn' | 'info' | 'accent' | 'outline'; children: ReactNode; title?: string }) {
  return (
    <span className={`badge ${tone ? 'badge-' + tone : ''}`} title={title}>
      {children}
    </span>
  );
}

/** Content provenance is always visible: learners must never mistake practice for a real CAT question. */
export function OriginBadge({ origin, year, slot, verification }: { origin: string; year?: number | null; slot?: number | null; verification?: string }) {
  if (origin === 'authentic_pyq') {
    return (
      <Badge tone={verification === 'verified' ? 'good' : 'warn'} title={verification === 'verified' ? 'Source checked by an editor' : 'Source not yet verified'}>
        CAT {year ?? ''}
        {slot ? ` · Slot ${slot}` : ''} · {verification === 'verified' ? 'verified source' : 'source unverified'}
      </Badge>
    );
  }
  const tone = origin === 'ai_generated' ? 'info' : 'outline';
  return <Badge tone={tone}>{ORIGIN_LABEL[origin] ?? origin}</Badge>;
}

const STATE_TONE: Record<string, '' | 'good' | 'bad' | 'warn' | 'info' | 'accent'> = {
  not_started: '',
  learning: 'info',
  practicing: 'accent',
  weak: 'bad',
  revision_due: 'warn',
  proficient: 'good',
  exam_ready: 'good',
};
export function StateBadge({ state, score }: { state: string; score?: number | null }) {
  return (
    <Badge tone={STATE_TONE[state] ?? ''}>
      {STATE_LABEL[state] ?? state}
      {score !== undefined && score !== null && state !== 'not_started' ? ` · ${Math.round(score)}` : ''}
    </Badge>
  );
}

export function DifficultyBadge({ d }: { d: string }) {
  return <Badge tone="outline">{DIFFICULTY_LABEL[d] ?? d}</Badge>;
}

export function Progress({ value, max = 100, label }: { value: number; max?: number; label: string }) {
  const p = max ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className="progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
      <span style={{ width: `${p}%` }} />
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="stat">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
      {hint && <span className="tiny muted">{hint}</span>}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: { id: T; label: string }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: (id: string) => ReactNode; hint?: string }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {hint && <div className="tiny muted">{hint}</div>}
    </div>
  );
}

export function Confirm({ label, onConfirm, children, className = 'btn btn-danger' }: { label: string; onConfirm: () => void; children: ReactNode; className?: string }) {
  const [asking, setAsking] = useState(false);
  if (!asking)
    return (
      <button className={className} onClick={() => setAsking(true)}>
        {children}
      </button>
    );
  return (
    <span className="row">
      <span className="small">{label}</span>
      <button className="btn btn-danger btn-sm" onClick={() => (setAsking(false), onConfirm())}>
        Yes
      </button>
      <button className="btn btn-sm" onClick={() => setAsking(false)}>
        No
      </button>
    </span>
  );
}

export function TopicLink({ id, name }: { id: string; name: string }) {
  return <Link to={`/syllabus/${id}`}>{name}</Link>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="row-between mb">
      <div>
        <h1 style={{ marginBottom: subtitle ? 4 : 0 }}>{title}</h1>
        {subtitle && <div className="muted">{subtitle}</div>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}
