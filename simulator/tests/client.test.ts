import { describe, expect, it } from 'vitest';
import { ApiError, DrainGuardApi } from '../src/client';

describe('DrainGuardApi', () => {
  it('logs in and authenticates later requests', async () => {
    const requests: { url: string; init?: RequestInit }[] = [];
    const fakeFetch: typeof fetch = async (url, init) => {
      requests.push({ url: String(url), init });
      if (String(url).endsWith('/api/auth/login')) {
        return new Response(
          JSON.stringify({
            data: {
              user: {
                id: 'u1',
                email: 'admin@drainguard.local',
                name: 'Admin',
                role: 'ADMIN',
              },
              accessToken: 'access-token',
              refreshToken: 'refresh-token',
              tokenType: 'Bearer',
              expiresIn: 900,
              refreshExpiresIn: 604800,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      return new Response(
        JSON.stringify({
          data: [],
          meta: { page: 1, pageSize: 100, total: 0, totalPages: 0 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const api = new DrainGuardApi('http://api.test/', fakeFetch);
    const session = await api.login('admin@drainguard.local', 'secret');
    expect(session.accessToken).toBe('access-token');

    await api.listDrains();
    const headers = new Headers(requests[1]?.init?.headers);
    expect(requests[1]?.url).toBe('http://api.test/api/drains?page=1&pageSize=100');
    expect(headers.get('Authorization')).toBe('Bearer access-token');
  });

  it('surfaces API error codes and status', async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          error: { code: 'UNAUTHORIZED', message: 'Invalid credentials' },
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      );

    const api = new DrainGuardApi('http://api.test', fakeFetch);
    await expect(api.login('admin@drainguard.local', 'wrong')).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
      code: 'UNAUTHORIZED',
      message: 'Invalid credentials',
    } satisfies Partial<ApiError>);
  });
});
