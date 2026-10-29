import type { AuthSession, User } from './types';

const STORAGE_KEY = 'drainguard.session.v1';
const SESSION_EVENT = 'drainguard:session-changed';
const EXPIRED_EVENT = 'drainguard:session-expired';

export interface StoredSession {
  user: User;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: number;
}

let currentSession: StoredSession | null = readSession();

function readSession(): StoredSession | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    if (!parsed.accessToken || !parsed.refreshToken || !parsed.user) return null;
    return parsed;
  } catch {
    return null;
  }
}

function persist(): void {
  try {
    if (currentSession) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(currentSession));
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    return;
  }
}

function notify(): void {
  window.dispatchEvent(new CustomEvent(SESSION_EVENT, { detail: currentSession }));
}

export function getSession(): StoredSession | null {
  return currentSession;
}

export function setSession(session: AuthSession): StoredSession {
  currentSession = {
    user: session.user,
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    accessTokenExpiresAt: Date.now() + session.expiresIn * 1000,
  };
  persist();
  notify();
  return currentSession;
}

export function updateSessionUser(user: User): void {
  if (!currentSession) return;
  currentSession = { ...currentSession, user };
  persist();
  notify();
}

export function clearSession(expired = false): void {
  currentSession = null;
  persist();
  notify();
  if (expired) window.dispatchEvent(new CustomEvent(EXPIRED_EVENT));
}

export function onSessionChange(listener: (session: StoredSession | null) => void): () => void {
  const handler = (event: Event) => {
    listener((event as CustomEvent<StoredSession | null>).detail);
  };
  window.addEventListener(SESSION_EVENT, handler);
  return () => window.removeEventListener(SESSION_EVENT, handler);
}

export function onSessionExpired(listener: () => void): () => void {
  window.addEventListener(EXPIRED_EVENT, listener);
  return () => window.removeEventListener(EXPIRED_EVENT, listener);
}

export function initialSession(): StoredSession | null {
  return currentSession;
}
