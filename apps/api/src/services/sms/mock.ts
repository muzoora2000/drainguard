import { randomUUID } from 'node:crypto';
import { logger } from '../../lib/logger';
import type { SmsProvider, SmsSendInput, SmsSendResult } from './types';

export class MockSmsProvider implements SmsProvider {
  readonly name = 'mock' as const;

  async send(input: SmsSendInput): Promise<SmsSendResult> {
    const providerMessageId = `mock-${randomUUID()}`;
    logger.info(
      { provider: 'mock', to: input.to, message: input.message, providerMessageId },
      'Mock SMS accepted',
    );
    return {
      providerMessageId,
      providerResponse: { status: 'accepted', providerMessageId },
    };
  }
}
