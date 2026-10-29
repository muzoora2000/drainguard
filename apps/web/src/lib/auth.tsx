import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, refreshAccessToken } from '../lib/api';
import {
  clearSession,
  getSession,
  initialSession,
  onSessionChange,
  onSessionExpired,
  setSession,
  type StoredSession,
} from '../lib/session';
import type { AuthSession } from '../lib/types';

interface AuthContextValue {
  session: StoredSession | null;
  isAuthenticated: boolean;
  signingIn: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSessionState] = useState<StoredSession | null>(() => initialSession());
  const [signingIn, setSigningIn] = useState(false);
  const queryClient = useQueryClient();
  const refreshTimer = useRef<number | null>(null);

  useEffect(
    () =>
      onSessionChange((next) => {
        setSessionState(next);
      }),
    [],
  );

  useEffect(
    () =>
      onSessionExpired(() => {
        setSessionState(null);
        queryClient.clear();
      }),
    [queryClient],
  );

  useEffect(() => {
    if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    if (!session) return;

    const delay = Math.max(5_000, session.accessTokenExpiresAt - Date.now() - 60_000);
    refreshTimer.current = window.setTimeout(() => {
      refreshAccessToken().catch(() => undefined);
    }, delay);

    return () => {
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    };
  }, [session]);

  const login = useCallback(
    async (email: string, password: string) => {
      setSigningIn(true);
      try {
        const response = await api.anonymousPost<{ data: AuthSession }>('/api/auth/login', {
          email,
          password,
        });
        setSession(response.data);
        queryClient.clear();
      } finally {
        setSigningIn(false);
      }
    },
    [queryClient],
  );

  const logout = useCallback(async () => {
    const current = getSession();
    if (current?.refreshToken) {
      try {
        await api.post('/api/auth/logout', { refreshToken: current.refreshToken });
      } catch {}
    }
    clearSession();
    queryClient.clear();
  }, [queryClient]);

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      await api.post('/api/auth/change-password', { currentPassword, newPassword });
      await logout();
    },
    [logout],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      isAuthenticated: Boolean(session),
      signingIn,
      login,
      logout,
      changePassword,
    }),
    [session, signingIn, login, logout, changePassword],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}

export function useCurrentUser() {
  return useAuth().session?.user ?? null;
}

export function hasRole(role: string, allowed: string[]): boolean {
  return allowed.includes(role);
}
