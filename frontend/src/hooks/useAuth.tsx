import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, setUnauthorizedHandler } from '../services/api';
import type { AuthUser, Company, Role } from '../types';

interface AuthState {
  user: AuthUser | null;
  /** Company of the signed-in user */
  company: Company | null;
  loading: boolean;
  /** Message shown on the login page, e.g. after the session expired */
  notice: string | null;
  login: (clientId: string, username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: AuthUser) => void;
  setCompany: (company: Company) => void;
  hasRole: (...roles: Role[]) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

interface MeResponse {
  user: AuthUser;
  company: Company;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [company, setCompany] = useState<Company | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const userRef = useRef<AuthUser | null>(null);
  userRef.current = user;

  useEffect(() => {
    setUnauthorizedHandler((message) => {
      // Only show "session expired" if the user was actually signed in
      if (userRef.current) setNotice(message);
      setUserState(null);
    });
    api
      .get<MeResponse>('/auth/me')
      .then((r) => {
        setUserState(r.user);
        setCompany(r.company);
      })
      .catch(() => setUserState(null))
      .finally(() => setLoading(false));
    return () => setUnauthorizedHandler(null);
  }, []);

  const login = useCallback(async (clientId: string, username: string, password: string) => {
    const r = await api.post<MeResponse>('/auth/login', { clientId, username, password });
    setNotice(null);
    setCompany(r.company);
    setUserState(r.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      setNotice(null);
      setUserState(null);
    }
  }, []);

  const hasRole = useCallback((...roles: Role[]) => !!user && roles.includes(user.role), [user]);

  const value = useMemo<AuthState>(
    () => ({ user, company, loading, notice, login, logout, setUser: setUserState, setCompany, hasRole }),
    [user, company, loading, notice, login, logout, hasRole],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
