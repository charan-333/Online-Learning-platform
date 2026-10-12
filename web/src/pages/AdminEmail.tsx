import { useState } from 'react';
import { Badge, Card, ErrorBox, PageHeader, Spinner, Stat } from '../components/ui';
import { api } from '../lib/api';
import { fmtDate } from '../lib/format';
import { useApi } from '../lib/useApi';

/** Email delivery status as the server sees it. Credentials stay on the server and are never shown here. */
export function AdminEmail() {
  const s = useApi('/api/admin/email');
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  if (s.loading && !s.data) return <Spinner />;
  const d = s.data;
  const test = async () => {
    setErr(null);
    setBusy(true);
    try {
      setResult(await api.post('/api/admin/email/test'));
      s.reload();
    } catch (e) {
      setErr(e as Error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <PageHeader title="Email delivery" subtitle="Password-reset links are sent through the provider configured on the server (EMAIL_PROVIDER and SMTP_* settings)." />
      <ErrorBox error={err ?? s.error} />
      {d && (
        <>
          <div className={`alert ${d.configured ? 'alert-good' : 'alert-warn'}`} data-testid="email-status">
            <Badge tone={d.configured ? 'good' : 'bad'}>{d.configured ? 'configured' : 'not configured'}</Badge> {d.summary}
          </div>
          <div className="grid grid-4 mb">
            <Card>
              <Stat label="Provider" value={d.provider} hint={d.fromDomain ? `from @${d.fromDomain}` : undefined} />
            </Card>
            <Card>
              <Stat label="Sent (24 h)" value={Number(d.last24h?.sent ?? 0)} />
            </Card>
            <Card>
              <Stat label="Failed (24 h)" value={Number(d.last24h?.failed ?? 0)} />
            </Card>
            <Card>
              <Stat label="Held back (24 h)" value={Number(d.last24h?.suppressed ?? 0)} hint="per-account reset limit" />
            </Card>
          </div>
          <Card title="Recent outcomes">
            <p className="small">Last sent: {d.lastSent ? `${d.lastSent.purpose.replace('_', ' ')}, ${fmtDate(d.lastSent.created_at)}` : 'none recorded'}</p>
            <p className="small">
              Last failure: {d.lastFailure ? `${d.lastFailure.purpose.replace('_', ' ')}, ${fmtDate(d.lastFailure.created_at)}: ${d.lastFailure.error}` : 'none recorded'}
            </p>
            <button className="btn" disabled={busy} onClick={() => void test()}>
              Send a test email to me
            </button>
            {result && (
              <div className={`alert mt ${result.status === 'sent' ? 'alert-good' : 'alert-error'}`} role="status">
                {result.status === 'sent'
                  ? result.configured
                    ? 'The provider accepted the message. Check your inbox and spam folder.'
                    : 'Logged by the development provider. It was not delivered to an inbox.'
                  : `The provider refused the message: ${result.error}`}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
