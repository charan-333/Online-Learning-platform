import { type FormEvent, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';

const NAV: { title: string; links: [string, string][] }[] = [
  { title: 'Today', links: [['/', 'Dashboard'], ['/lesson', 'Daily lesson'], ['/revision', 'Revision'], ['/plan', 'Study plan']] },
  { title: 'Learn', links: [['/syllabus', 'Syllabus'], ['/formulas', 'Formula book'], ['/calc-gym', 'Calculation gym'], ['/tutor', 'Tutor']] },
  { title: 'Practise', links: [['/questions', 'Question bank'], ['/modes', 'Practice modes'], ['/reading', 'Reading lab'], ['/dilr', 'DILR lab'], ['/strategy', 'Strategy drills']] },
  { title: 'Test', links: [['/mocks', 'Mocks'], ['/diagnostic', 'Diagnostic']] },
  { title: 'Review', links: [['/errors', 'Error log'], ['/analytics', 'Analytics'], ['/notes', 'Notes & bookmarks']] },
];

function useTheme() {
  const [theme, setTheme] = useState<string>(() => {
    try {
      return localStorage.getItem('cat100-theme') ?? '';
    } catch {
      return '';
    }
  });
  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
    try {
      if (theme) localStorage.setItem('cat100-theme', theme);
      else localStorage.removeItem('cat100-theme');
    } catch {
      /* storage unavailable */
    }
  }, [theme]);
  const effective = theme || (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  return { effective, toggle: () => setTheme(effective === 'dark' ? 'light' : 'dark') };
}

export function Layout() {
  const { user, profile, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const nav = useNavigate();
  const loc = useLocation();
  const theme = useTheme();
  useEffect(() => setOpen(false), [loc.pathname]);

  const search = (e: FormEvent) => {
    e.preventDefault();
    if (q.trim().length >= 2) nav(`/search?q=${encodeURIComponent(q.trim())}`);
  };

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className={`sidebar ${open ? 'open' : ''}`} aria-label="Main navigation">
        <NavLink to="/" className="brand">
          <span className="brand-mark">CAT</span> 100
        </NavLink>
        <nav className="nav">
          {NAV.map((g) => (
            <div className="nav-group" key={g.title}>
              <div className="nav-group-title">{g.title}</div>
              {g.links.map(([to, label]) => (
                <NavLink key={to} to={to} end={to === '/'}>
                  {label}
                </NavLink>
              ))}
            </div>
          ))}
          <div className="nav-group">
            <div className="nav-group-title">Account</div>
            <NavLink to="/settings">Settings</NavLink>
            {user?.role === 'admin' && <NavLink to="/admin">Content admin</NavLink>}
          </div>
        </nav>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="btn btn-ghost menu-btn" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(!open)}>
            ☰
          </button>
          <form role="search" onSubmit={search}>
            <label htmlFor="global-search" className="sr-only">
              Search
            </label>
            <input id="global-search" type="search" placeholder="Search questions, topics, formulas, notes…" value={q} onChange={(e) => setQ(e.target.value)} />
          </form>
          <button className="btn btn-ghost btn-sm" onClick={theme.toggle} aria-label={`Switch to ${theme.effective === 'dark' ? 'light' : 'dark'} theme`}>
            {theme.effective === 'dark' ? '☀' : '☾'}
          </button>
          <span className="small muted nowrap" title={user?.email}>
            {profile?.display_name || user?.email}
          </span>
          <button className="btn btn-sm" onClick={() => void logout().then(() => nav('/login'))}>
            Sign out
          </button>
        </header>
        <main id="main" className="content" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
