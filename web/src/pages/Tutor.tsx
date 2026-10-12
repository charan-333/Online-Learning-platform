import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Markdown } from '../components/Markdown';
import { Badge, Card, ErrorBox, PageHeader, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { fmtDate } from '../lib/format';
import { useApi } from '../lib/useApi';

export function Tutor() {
  const { id } = useParams();
  const status = useApi('/api/tutor/status');
  const sessions = useApi('/api/tutor/sessions');
  const topics = useApi('/api/topics');
  const nav = useNavigate();
  const [topic, setTopic] = useState('');
  const start = async () => {
    const s = await api.post('/api/tutor/sessions', topic ? { contextType: 'topic', contextId: topic, title: topics.data?.items.find((t: any) => t.id === topic)?.name } : { contextType: 'general', title: 'General question' });
    sessions.reload();
    nav(`/tutor/${s.id}`);
  };
  return (
    <div>
      <PageHeader title="Tutor" subtitle="Answers are grounded in CAT 100 content: topic notes, formulas, and questions or solutions you have already seen." />
      {status.data && (
        <div className={`alert ${status.data.aiEnabled ? 'alert-info' : 'alert-warn'}`}>
          {status.data.aiEnabled
            ? `AI tutor on (${status.data.provider}). ${status.data.usedToday} of ${status.data.dailyLimit} messages used today. AI answers can be wrong; check them against the linked sources.`
            : 'AI tutor is not configured on this server, so replies come from the offline guide: relevant notes, formulas and solution steps from the platform. Everything else still works.'}
        </div>
      )}
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 260px) minmax(0, 1fr)' }}>
        <Card title={<h3 style={{ margin: 0 }}>Conversations</h3>}>
          <div className="field">
            <label htmlFor="t-topic">About a topic (optional)</label>
            <select id="t-topic" value={topic} onChange={(e) => setTopic(e.target.value)}>
              <option value="">General</option>
              {(topics.data?.items ?? []).map((t: any) => (
                <option key={t.id} value={t.id}>
                  {t.section_id} · {t.name}
                </option>
              ))}
            </select>
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => void start()}>
            New conversation
          </button>
          <ul className="list mt">
            {(sessions.data?.items ?? []).map((s: any) => (
              <li key={s.id}>
                <Link to={`/tutor/${s.id}`} style={{ fontWeight: s.id === id ? 700 : 400 }}>
                  {s.title}
                </Link>
                <div className="tiny muted">
                  {s.context_type} · {fmtDate(s.created_at)}
                </div>
              </li>
            ))}
          </ul>
        </Card>
        {id ? <Chat id={id} /> : <Card>Choose or start a conversation. You can also open the tutor from any question after you answer it.</Card>}
      </div>
    </div>
  );
}

function Chat({ id }: { id: string }) {
  const s = useApi(`/api/tutor/sessions/${id}`);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Error | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ block: 'end' }), [s.data?.messages?.length]);
  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await api.post(`/api/tutor/sessions/${id}/messages`, { content: text });
      setText('');
      await s.reload();
    } catch (x) {
      setErr(x as Error);
    } finally {
      setBusy(false);
    }
  };
  if (s.loading && !s.data) return <Spinner />;
  if (s.error) return <ErrorBox error={s.error} />;
  return (
    <Card title={<h3 style={{ margin: 0 }}>{s.data.title}</h3>}>
      <div className="chat" aria-live="polite">
        {s.data.messages.map((m: any) => (
          <div key={m.id} className={`msg msg-${m.role}`}>
            <Markdown text={m.content} />
            {m.role === 'assistant' && (
              <div className="tiny muted mt">
                <Badge tone={m.provider === 'offline' ? 'outline' : 'info'}>{m.provider === 'offline' ? 'Offline guide' : `AI · ${m.provider}`}</Badge>
                {(m.grounding ?? []).length > 0 && <> Sources: {(m.grounding as any[]).map((g) => `${g.kind}: ${g.title}`).join('; ')}</>}
              </div>
            )}
          </div>
        ))}
        <div ref={end} />
      </div>
      <ErrorBox error={err} />
      <form onSubmit={send} className="mt">
        <label htmlFor="t-msg" className="sr-only">
          Message
        </label>
        <textarea id="t-msg" placeholder="Ask about a concept, a step in a solution, or why an option is wrong…" value={text} onChange={(e) => setText(e.target.value)} />
        <button className="btn btn-primary mt" disabled={busy || !text.trim()}>
          {busy ? 'Thinking…' : 'Send'}
        </button>
      </form>
    </Card>
  );
}
