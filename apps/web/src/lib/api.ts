import {
  clearSession,
  getSession,
  setSession,
} from './session';
import type { ApiErrorBody, AuthSession, Dict } from './types';

const configuredBase = (import.meta.env.VITE_API_URL ?? '').trim().replace(/\/+$/, '');
export const API_BASE = configuredBase;

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  requestId?: string;

  constructor(message: string, status: number, code = 'REQUEST_FAILED', details?: unknown, requestId?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

export function apiUrl(path: string): string {
  return `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
}

function buildQuery(query?: Dict): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const serialized = params.toString();
  return serialized ? `?${serialized}` : '';
}

async function parseError(response: Response): Promise<ApiError> {
  let body: ApiErrorBody | null = null;
  try {
    body = (await response.json()) as ApiErrorBody;
  } catch {
    body = null;
  }
  const message =
    body?.error?.message ??
    (response.status === 429
      ? 'Too many requests. Please wait a moment and try again.'
      : response.status >= 500
        ? 'The server could not complete this request.'
        : `Request failed (${response.status}).`);
  return new ApiError(
    message,
    response.status,
    body?.error?.code ?? 'REQUEST_FAILED',
    body?.error?.details,
    body?.error?.requestId ?? response.headers.get('x-request-id') ?? undefined,
  );
}

let refreshInFlight: Promise<string> | null = null;

export async function refreshAccessToken(): Promise<string> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const session = getSession();
    if (!session?.refreshToken) {
      clearSession(true);
      throw new ApiError('Your session has ended. Please sign in again.', 401, 'UNAUTHORIZED');
    }

    const response = await fetch(apiUrl('/api/auth/refresh'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    });

    if (!response.ok) {
      clearSession(true);
      throw await parseError(response);
    }

    const payload = (await response.json()) as { data: AuthSession };
    const stored = setSession(payload.data);
    return stored.accessToken;
  })().finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
}

export async function ensureAccessToken(): Promise<string> {
  const session = getSession();
  if (!session) {
    throw new ApiError('Authentication required.', 401, 'UNAUTHORIZED');
  }
  if (session.accessTokenExpiresAt - Date.now() < 30_000) {
    return refreshAccessToken();
  }
  return session.accessToken;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Dict;
  signal?: AbortSignal;
  anonymous?: boolean;
  retryOnUnauthorized?: boolean;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, signal, anonymous = false, retryOnUnauthorized = true } = options;
  const headers = new Headers();
  if (body !== undefined) headers.set('Content-Type', 'application/json');

  if (!anonymous) {
    const token = getSession()?.accessToken;
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }

  let response: Response;
  try {
    response = await fetch(apiUrl(`${path}${buildQuery(query)}`), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new ApiError(
      'Cannot reach the DrainGuard API. Check your connection or the API server.',
      0,
      'NETWORK_ERROR',
    );
  }

  const isAuthPath = path.startsWith('/api/auth/login') || path.startsWith('/api/auth/refresh');
  if (response.status === 401 && !anonymous && !isAuthPath && retryOnUnauthorized) {
    try {
      await refreshAccessToken();
    } catch {
      throw await parseError(response);
    }
    return request<T>(path, { ...options, retryOnUnauthorized: false });
  }

  if (!response.ok) {
    throw await parseError(response);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  get<T>(path: string, query?: Dict, signal?: AbortSignal): Promise<T> {
    return request<T>(path, { query, signal });
  },
  post<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, { method: 'POST', body });
  },
  patch<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, { method: 'PATCH', body });
  },
  put<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, { method: 'PUT', body });
  },
  delete<T>(path: string): Promise<T> {
    return request<T>(path, { method: 'DELETE' });
  },
  anonymousPost<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, { method: 'POST', body, anonymous: true });
  },
  async download(path: string, query?: Dict): Promise<Blob> {
    const token = await ensureAccessToken();
    const response = await fetch(apiUrl(`${path}${buildQuery(query)}`), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw await parseError(response);
    return response.blob();
  },
};

export function isForbidden(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
}
