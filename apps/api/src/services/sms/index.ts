import { env } from '../../config/env';
import { AfricaStalkingSmsProvider } from './africastalking';
import { MockSmsProvider } from './mock';
import { TwilioSmsProvider } from './twilio';
import type { SmsProvider } from './types';

let cached: SmsProvider | null = null;

export function getSmsProvider(): SmsProvider {
  if (cached) return cached;

  switch (env.SMS_PROVIDER) {
    case 'africastalking':
      cached = new AfricaStalkingSmsProvider();
      break;
    case 'twilio':
      cached = new TwilioSmsProvider();
      break;
    case 'mock':
    default:
      cached = new MockSmsProvider();
      break;
  }

  return cached;
}

export function resetSmsProviderForTests(): void {
  cached = null;
}

export type { SmsProvider, SmsSendInput, SmsSendResult } from './types';
export { SmsProviderError } from './types';
