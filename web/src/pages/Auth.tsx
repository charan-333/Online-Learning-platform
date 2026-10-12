import { type FormEvent, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ErrorBox, Field } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

function AuthShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="auth-wrap">
      <main className="card auth-card">
        <div className="brand" style={{ padding: '0 0 8px' }}>
          <span className="brand-mark">CAT</span> 100
        </div>
        <h1>{title}</h1>
        {children}
      </main>
    </div>
  );
}

export function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await login(email, password);
      nav('/');
    } catch (x) {
      setErr(x as Error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthShell title="Sign in">
      <form onSubmit={submit}>
        <ErrorBox error={err} />
        <Field label="Email">{(id) => <input id={id} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
        <Field label="Password">{(id) => <input id={id} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
        <button className="btn btn-primary" style={{ width: '100%' }} disabled={busy}>
          Sign in
        </button>
      </form>
      <p className="small mt">
        <Link to="/forgot-password">Forgot password?</Link> · New here? <Link to="/register">Create an account</Link>
      </p>
    </AuthShell>
  );
}

export function Register() {
  const { register } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState({ email: '', password: '', displayName: '' });
  const [err, setErr] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await register(f.email, f.password, f.displayName);
      nav('/onboarding');
    } catch (x) {
      setErr(x as Error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthShell title="Create your account">
      <form onSubmit={submit}>
        <ErrorBox error={err} />
        <Field label="Your name">{(id) => <input id={id} autoComplete="name" required value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} />}</Field>
        <Field label="Email">{(id) => <input id={id} type="email" autoComplete="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}</Field>
        <Field label="Password" hint="At least 10 characters.">
          {(id) => <input id={id} type="password" autoComplete="new-password" minLength={10} required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />}
        </Field>
        <button className="btn btn-primary" style={{ width: '100%' }} disabled={busy}>
          Create account
        </button>
      </form>
      <p className="small mt">
        Already registered? <Link to="/login">Sign in</Link>
      </p>
    </AuthShell>
  );
}

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState<Error | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      setMsg((await api.post('/api/auth/forgot-password', { email })).message);
    } catch (x) {
      setErr(x as Error);
    }
  };
  return (
    <AuthShell title="Reset your password">
      {msg ? (
        <div className="alert alert-good">{msg}</div>
      ) : (
        <form onSubmit={submit}>
          <ErrorBox error={err} />
          <Field label="Email">{(id) => <input id={id} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
          <button className="btn btn-primary">Send reset link</button>
        </form>
      )}
      <p className="small mt">
        <Link to="/login">Back to sign in</Link>
      </p>
    </AuthShell>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState<Error | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      setMsg((await api.post('/api/auth/reset-password', { token: params.get('token') ?? '', password })).message);
    } catch (x) {
      setErr(x as Error);
    }
  };
  return (
    <AuthShell title="Choose a new password">
      {msg ? (
        <div className="alert alert-good">
          {msg} <Link to="/login">Sign in</Link>
        </div>
      ) : (
        <form onSubmit={submit}>
          <ErrorBox error={err} />
          <Field label="New password" hint="At least 10 characters.">
            {(id) => <input id={id} type="password" minLength={10} required autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
          </Field>
          <button className="btn btn-primary">Save password</button>
        </form>
      )}
    </AuthShell>
  );
}
