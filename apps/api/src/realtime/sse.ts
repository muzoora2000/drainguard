import { randomUUID } from 'node:crypto';
import type { RequestHandler, Response } from 'express';
import type { AuthUser } from '../types/auth';

interface SseClient {
  id: string;
  userId: string;
  role: string;
  response: Response;
  heartbeat: NodeJS.Timeout;
}

class SseHub {
  private readonly clients = new Map<string, SseClient>();

  handler: RequestHandler = (req, res) => {
    if (!req.user) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      return;
    }

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.write(`event: ready\ndata: ${JSON.stringify({ connectedAt: new Date().toISOString() })}\n\n`);

    const client: SseClient = {
      id: randomUUID(),
      userId: req.user.id,
      role: req.user.role,
      response: res,
      heartbeat: setInterval(() => {
        res.write(`: heartbeat ${Date.now()}\n\n`);
      }, 25_000),
    };

    this.clients.set(client.id, client);

    req.on('close', () => {
      clearInterval(client.heartbeat);
      this.clients.delete(client.id);
    });
  };

  publish(event: string, data: Record<string, unknown>): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.clients.values()) {
      try {
        client.response.write(payload);
      } catch {
        clearInterval(client.heartbeat);
        this.clients.delete(client.id);
      }
    }
  }

  closeAll(): void {
    for (const client of this.clients.values()) {
      clearInterval(client.heartbeat);
      try {
        client.response.end();
      } catch {
        // The socket may already be closed.
      }
    }
    this.clients.clear();
  }

  get size(): number {
    return this.clients.size;
  }
}

export const sseHub = new SseHub();

export function sseHandlerForUser(user: AuthUser): RequestHandler {
  return (req, res, next) => {
    req.user = user;
    sseHub.handler(req, res, next);
  };
}
