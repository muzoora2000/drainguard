import { env } from '../../config/env';
import { SmsProviderError } from './types';
import type { SmsProvider, SmsSendInput, SmsSendResult } from './types';

interface AfricaStalkingRecipient {
  messageId?: string;
  number?: string;
  status?: string;
  statusCode?: number;
  cost?: string;
}

interface AfricaStalkingResponse {
  SMSMessageData?: {
    Message?: string;
    Recipients?: AfricaStalkingRecipient[];
  };
}

export class AfricaStalkingSmsProvider implements SmsProvider {
  readonly name = 'africastalking' as const;

  async send(input: SmsSendInput): Promise<SmsSendResult> {
    if (!env.AFRICASTALKING_USERNAME || !env.AFRICASTALKING_API_KEY) {
      throw new SmsProviderError('Africa\'s Talking credentials are not configured', null);
    }

    const body = new URLSearchParams({
      username: env.AFRICASTALKING_USERNAME,
      to: input.to,
      message: input.message,
    });
    if (env.AFRICASTALKING_SENDER_ID) {
      body.set('from', env.AFRICASTALKING_SENDER_ID);
    }

    let response: Response;
    try {
      response = await fetch('https://api.africastalking.com/version1/messaging', {
        method: 'POST',
        headers: {
          apiKey: env.AFRICASTALKING_API_KEY,
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      throw new SmsProviderError(
        error instanceof Error ? error.message : 'Africa\'s Talking request failed',
        null,
      );
    }

    const text = await response.text();
    let data: AfricaStalkingResponse = {};
    try {
      data = JSON.parse(text) as AfricaStalkingResponse;
    } catch {
      data = { SMSMessageData: { Message: text } };
    }

    const recipient = data.SMSMessageData?.Recipients?.[0];
    if (!response.ok || !recipient || recipient.status !== 'Success') {
      throw new SmsProviderError(
        data.SMSMessageData?.Message ?? `Africa's Talking returned HTTP ${response.status}`,
        data,
      );
    }

    return {
      providerMessageId:
        recipient.messageId ?? `at-${recipient.statusCode ?? 'unknown'}-${Date.now()}`,
      providerResponse: data,
    };
  }
}
