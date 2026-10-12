import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ProfileForm } from '../components/ProfileForm';
import { Card, PageHeader, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

export function Onboarding() {
  const { profile, refresh } = useAuth();
  const [step, setStep] = useState<1 | 2>(1);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  if (!profile) return <Spinner />;
  const skipDiagnostic = async () => {
    setBusy(true);
    await api.patch('/api/profile', { onboardingCompleted: true });
    await api.post('/api/plans/generate', {});
    await refresh();
    nav('/');
  };
  return (
    <div>
      <PageHeader title="Set up your preparation" subtitle={`Step ${step} of 2`} />
      {step === 1 ? (
        <Card title="About you">
          <p className="muted small">These defaults come from the CAT 100 brief. Change anything that does not fit; the plan uses your available time and self-ratings until the diagnostic gives real data.</p>
          <ProfileForm profile={profile} submitLabel="Save and continue" onSaved={() => void refresh().then(() => setStep(2))} />
        </Card>
      ) : (
        <Card title="Take the diagnostic">
          <p>
            The diagnostic is a short timed set across QA, one RC passage, one verbal item and one complete DILR set. It sets your starting mode per section and builds your first study plan.
          </p>
          <p className="small muted">It uses CAT 100 original practice questions, not past CAT papers, and is a starting estimate rather than a prediction.</p>
          <div className="row">
            <Link className="btn btn-primary" to="/diagnostic">
              Start the diagnostic
            </Link>
            <button className="btn" disabled={busy} onClick={() => void skipDiagnostic()}>
              Skip for now and build a plan from my self-ratings
            </button>
          </div>
        </Card>
      )}
    </div>
  );
}
