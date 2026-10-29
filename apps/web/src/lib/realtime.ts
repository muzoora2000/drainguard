import { useEffect, useRef, useState } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { API_BASE, apiUrl, ensureAccessToken } from './api';

export type RealtimeStatus = 'connecting' | 'connected' | 'polling';

const LIVE_KEYS = new Set([
  'dashboard',
  'drains',
  'drain',
  'alerts',
  'alert',
  'tasks',
  'task',
  'notifications',
  'reports',
  'system',
  'readings',
]);

function invalidateLive(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({
    predicate: (query) => LIVE_KEYS.has(String(query.queryKey[0])),
    refetchType: 'active',
  });
}

async function streamEvents(
  signal: AbortSignal,
  onEvent: (event: string, data: unknown) => void,
): Promise<void> {
  const token = await ensureAccessToken();
  const response = await fetch(apiUrl('/api/events'), {
    headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
    signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(`SSE connection failed (${response.status})`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (!signal.aborted) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const chunk = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf('\n\n');

      let event = 'message';
      const dataLines: string[] = [];
      for (const line of chunk.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      }
      if (dataLines.length > 0) {
        try {
          onEvent(event, JSON.parse(dataLines.join('\n')) as unknown);
        } catch {
          onEvent(event, null);
        }
      }
    }
  }
}

export function useRealtime(enabled: boolean): RealtimeStatus {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<RealtimeStatus>('connecting');
  const reconnectRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return () => undefined;

    let stopped = false;
    let controller: AbortController | null = null;

    const connect = async () => {
      if (stopped) return;
      controller = new AbortController();
      setStatus((current) => (current === 'connected' ? current : 'connecting'));

      try {
        await streamEvents(controller.signal, (event) => {
          if (event !== 'ready') invalidateLive(queryClient);
        });
        if (!stopped) {
          setStatus('polling');
          reconnectRef.current = window.setTimeout(connect, 30_000);
        }
      } catch {
        if (stopped) return;
        setStatus('polling');
        reconnectRef.current = window.setTimeout(connect, 30_000);
      }
    };

    void connect();

    return () => {
      stopped = true;
      controller?.abort();
      if (reconnectRef.current) window.clearTimeout(reconnectRef.current);
    };
  }, [enabled, queryClient]);

  useEffect(() => {
    if (!enabled || status !== 'polling') return;
    invalidateLive(queryClient);
    const interval = window.setInterval(() => invalidateLive(queryClient), 10_000);
    return () => window.clearInterval(interval);
  }, [enabled, status, queryClient]);

  return enabled ? status : 'polling';
}

export function apiDisplayHost(): string {
  if (!API_BASE) return 'same origin';
  try {
    return new URL(API_BASE).host;
  } catch {
    return API_BASE;
  }
}
