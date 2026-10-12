import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Markdown } from '../components/Markdown';
import { ProfileForm } from '../components/ProfileForm';
import { Badge, Card, Empty, ErrorBox, PageHeader, Spinner, Tabs } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ERROR_LABEL, fmtDate } from '../lib/format';
import { useApi } from '../lib/useApi';

export function Notes() {
  const [tab, setTab] = useState<'notes' | 'bookmarks'>('notes');
  const [q, setQ] = useState('');
  const notes = useApi(`/api/notes${q ? `?q=${encodeURIComponent(q)}` : ''}`);
  const bookmarks = useApi('/api/bookmarks');
  const remove = async (id: string) => {
    await api.del(`/api/notes/${id}`);
    notes.reload();
  };
  const link = (n: any) =>
    n.question_id ? <Link to={`/practice/${n.question_id}`}>{n.question_external_id}</Link> : n.topic_id ? <Link to={`/syllabus/${n.topic_id}`}>{n.topic_name}</Link> : n.passage_id ? <Link to={`/reading/${n.passage_id}`}>{n.passage_title}</Link> : n.dilr_set_id ? <Link to={`/dilr/${n.dilr_set_id}`}>{n.set_title}</Link> : <span className="muted">General</span>;
  return (
    <div>
      <PageHeader title="Notes and bookmarks" />
      <Tabs
        label="Notes or bookmarks"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'notes', label: `Notes (${notes.data?.items.length ?? '…'})` },
          { id: 'bookmarks', label: `Bookmarks (${bookmarks.data?.items.length ?? '…'})` },
        ]}
      />
      {tab === 'notes' ? (
        <>
          <input type="search" aria-label="Search notes" placeholder="Search notes" value={q} onChange={(e) => setQ(e.target.value)} className="mb" />
          {notes.data?.items.length === 0 ? (
            <Empty>No notes yet. Add them from questions, topics, passages and DILR sets.</Empty>
          ) : (
            <ul className="list card">
              {(notes.data?.items ?? []).map((n: any) => (
                <li key={n.id}>
                  <div className="row-between">
                    <div className="row small">
                      <Badge tone="outline">{n.kind}</Badge>
                      {link(n)}
                      <span className="muted">{fmtDate(n.updated_at)}</span>
                    </div>
                    <button className="btn btn-sm btn-ghost" onClick={() => void remove(n.id)}>
                      Delete
                    </button>
                  </div>
                  <div className="small mt">{n.kind === 'workspace' ? 'DILR scratch grid' : n.body}</div>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : bookmarks.data?.items.length === 0 ? (
        <Empty>No bookmarks yet.</Empty>
      ) : (
        <>
          <Link className="btn mb" to="/practice?bookmarked=true">
            Practise bookmarks
          </Link>
          <ul className="list card">
            {(bookmarks.data?.items ?? []).map((b: any) => (
              <li key={b.id}>
                <div className="row small">
                  <Link to={`/practice/${b.id}`}>
                    <strong>{b.external_id}</strong>
                  </Link>
                  <Badge tone="accent">{b.section_id}</Badge>
                  <span>{b.topic_name}</span>
                </div>
                <div className="small muted">
                  <Markdown text={b.stem_preview} inline />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export function Search() {
  const [params] = useSearchParams();
  const q = params.get('q') ?? '';
  const r = useApi(q.length >= 2 ? `/api/search?q=${encodeURIComponent(q)}` : null);
  if (q.length < 2) return <Empty>Type at least two characters in the search box.</Empty>;
  if (r.loading && !r.data) return <Spinner />;
  if (r.error) return <ErrorBox error={r.error} />;
  const d = r.data;
  const total = Object.values(d).reduce((s: number, v: any) => s + v.length, 0);
  const group = (title: string, items: any[], render: (x: any) => React.ReactNode) =>
    items.length > 0 && (
      <Card title={<h3 style={{ margin: 0 }}>{title}</h3>}>
        <ul className="list">
          {items.map((x, i) => (
            <li key={x.id ?? i}>{render(x)}</li>
          ))}
        </ul>
      </Card>
    );
  return (
    <div>
      <PageHeader title={`Search: “${q}”`} subtitle={`${total} result(s)`} />
      {total === 0 && <Empty>Nothing found.</Empty>}
      {group('Topics', d.topics, (t) => (
        <>
          <Link to={`/syllabus/${t.id}`}>{t.name}</Link> <Badge>{t.section_id}</Badge>
          <div className="small muted">{t.summary}</div>
        </>
      ))}
      {group('Questions', d.questions, (x) => (
        <>
          <Link to={`/practice/${x.id}`}>{x.external_id}</Link> <Badge>{x.section_id}</Badge>
          <div className="small muted">
            <Markdown text={x.preview} inline />
          </div>
        </>
      ))}
      {group('Solutions you have seen', d.solutions, (x) => (
        <>
          <Link to={`/practice/${x.id}`}>{x.external_id}</Link>
          <div className="small muted">
            <Markdown text={x.preview} inline />
          </div>
        </>
      ))}
      {group('Formulas', d.formulas, (f) => (
        <>
          <Link to={`/syllabus/${f.topic_id}`}>{f.title}</Link> <span className="small muted">{f.topic_name}</span>
        </>
      ))}
      {group('Your notes', d.notes, (n) => <span className="small">{n.preview}</span>)}
      {group('Bookmarks', d.bookmarks, (x) => <Link to={`/practice/${x.id}`}>{x.external_id}</Link>)}
      {group('Error log', d.errors, (e) => (
        <>
          <Link to={`/practice/${e.question_id}`}>{e.external_id}</Link> <Badge tone="bad">{ERROR_LABEL[e.category] ?? e.category}</Badge>
        </>
      ))}
      {group('Tests', d.mocks, (m) => (
        <>
          {m.title} <Badge>{m.kind}</Badge>
        </>
      ))}
      {group('Lessons', d.lessons, (l) => (
        <Link to={`/lesson/${l.id}`}>
          {l.topic_name} · {fmtDate(l.lesson_date)}
        </Link>
      ))}
    </div>
  );
}

export function Settings() {
  const { profile, refresh, user, logout } = useAuth();
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState<Error | null>(null);
  const nav = useNavigate();
  if (!profile) return <Spinner />;
  const exportData = async () => {
    const data = await api.get('/api/account/export');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `cat100-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const del = async () => {
    setErr(null);
    try {
      await api.del('/api/account', { password: pw, confirm });
      await logout();
      nav('/login');
    } catch (e) {
      setErr(e as Error);
    }
  };
  return (
    <div>
      <PageHeader title="Settings" subtitle={user?.email} />
      <Card title="Profile and study time">
        <ProfileForm profile={profile} onSaved={() => void refresh()} />
      </Card>
      <Card title="Password">
        <p className="small">
          To change your password, use the <Link to="/forgot-password">reset link</Link>. Resetting signs you out on every device.
        </p>
      </Card>
      <Card title="Your data">
        <p className="small">Download everything CAT 100 stores about you: profile, attempts, mastery, notes, error log, revision history, plans, tests and tutor conversations.</p>
        <button className="btn" onClick={() => void exportData()}>
          Export my data (JSON)
        </button>
      </Card>
      <Card title="Delete account">
        <p className="small">This permanently deletes your account and all learning data. It cannot be undone.</p>
        <ErrorBox error={err} />
        <div className="grid grid-2">
          <div className="field">
            <label htmlFor="del-pw">Password</label>
            <input id="del-pw" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="del-c">Type DELETE to confirm</label>
            <input id="del-c" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
        </div>
        <button className="btn btn-danger" disabled={!pw || confirm !== 'DELETE'} onClick={() => void del()}>
          Delete my account
        </button>
      </Card>
    </div>
  );
}

export const MASTERY_DOC = `$$\\text{score} = 100 \\times E \\times (0.7\\,A + 0.2\\,S + 0.1\\,C)$$

Only your latest 30 attempts in the topic are used. Attempts made after revealing a solution (including worked examples shown in a lesson) are excluded.

- **A, accuracy**: weighted share of correct answers. Each attempt's weight halves every 21 days, and harder questions weigh more (easy 0.6, medium 1.0, difficult 1.3, advanced 1.5). A correct answer you marked as a guess earns half credit.
- **S, speed**: over correct answers, the average of target time ÷ your time, capped at 1.
- **C, calibration**: 1 minus the share of attempts you got wrong while marking high confidence.
- **E, evidence**: $\\min(1, d/8)$, where $d$ is the number of different questions attempted, so one or two lucky answers cannot produce a high score.`;

export function MasteryHelp() {
  return (
    <div>
      <PageHeader title="How mastery is calculated" subtitle="The engine is rule-based and explainable. Every state shows its reason on the topic page." />
      <Card title="Score (0–100)">
        <Markdown text={MASTERY_DOC} />
      </Card>
      <Card title="States, checked in this order">
        <ol>
          <li>
            <strong>Not started</strong>: no counted attempts.
          </li>
          <li>
            <strong>Learning</strong>: fewer than 3 different questions attempted.
          </li>
          <li>
            <strong>Weak</strong>: under 50% correct in the last 5 attempts, or the same mistake type at least twice in those 5.
          </li>
          <li>
            <strong>Exam-ready</strong>: score 85+, 10+ different questions, 3+ difficult or advanced questions correct without guessing, and 3+ timed correct answers within target time.
          </li>
          <li>
            <strong>Proficient</strong>: score 70+ with 6+ different questions.
          </li>
          <li>
            <strong>Practising</strong>: anything else.
          </li>
          <li>
            <strong>Revision due</strong>: replaces proficient or exam-ready when the topic has not been practised for 21 days.
          </li>
        </ol>
        <p className="small">
          Mode B (high-performance practice) applies when the score is 70+ and the topic is not weak; otherwise Mode A (foundation first). All thresholds are in one server configuration object, MASTERY_CONFIG, documented in docs/MASTERY.md.
        </p>
      </Card>
    </div>
  );
}
