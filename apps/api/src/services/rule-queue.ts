import { logger } from '../lib/logger';
import { evaluateDrain } from './rule-application';

const pending = new Set<string>();
let running = false;

async function drainQueue(): Promise<void> {
  if (running) return;
  running = true;

  try {
    while (pending.size > 0) {
      const ids = [...pending];
      pending.clear();

      await Promise.allSettled(
        ids.map(async (drainId) => {
          try {
            await evaluateDrain(drainId);
          } catch (error) {
            logger.error({ err: error, drainId }, 'Queued rule evaluation failed');
          }
        }),
      );
    }
  } finally {
    running = false;
  }
}

export function scheduleDrainEvaluation(drainId: string): void {
  pending.add(drainId);
  void drainQueue();
}

export async function flushRuleQueue(): Promise<void> {
  while (running || pending.size > 0) {
    if (!running) void drainQueue();
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

export function resetRuleQueueForTests(): void {
  pending.clear();
  running = false;
}
