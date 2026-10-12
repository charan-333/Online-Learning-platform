import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { api, setCsrf, setUnauthorizedHandler } from './api';

export interface User {
  id: string;
  email: string;
  role: 'learner' | 'admin';
}
export type Profile = Record<string, any>;

interface AuthState {
  user: User | null;
  profile: Profile | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const me = await api.get('/api/auth/me');
      setUser(me.user);
      setProfile(me.profile);
      setCsrf(me.csrfToken);
    } catch {
      setUser(null);
      setProfile(null);
      setCsrf(null);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
      setProfile(null);
    });
    void refresh();
  }, [refresh]);

  const login = async (email: string, password: string) => {
    const r = await api.post('/api/auth/login', { email, password });
    setCsrf(r.csrfToken);
    await refresh();
  };
  const register = async (email: string, password: string, displayName: string) => {
    const r = await api.post('/api/auth/register', { email, password, displayName });
    setCsrf(r.csrfToken);
    await refresh();
  };
  const logout = async () => {
    await api.post('/api/auth/logout').catch(() => undefined);
    setCsrf(null);
    setUser(null);
    setProfile(null);
  };

  return <Ctx.Provider value={{ user, profile, ready, login, register, logout, refresh }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth outside provider');
  return c;
}
