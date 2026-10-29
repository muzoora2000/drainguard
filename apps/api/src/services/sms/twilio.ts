import { env } from '../../config/env';
import { SmsProviderError } from './types';
import type { SmsProvider, SmsSendInput, SmsSendResult } from './types';

interface TwilioResponse {
  sid?: string;
  status?: string;
  error_message?: string;
  message?: string;
}

export class TwilioSmsProvider implements SmsProvider {
  readonly name = 'twilio' as const;

  async send(input: SmsSendInput): Promise<SmsSendResult> {
    if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM_NUMBER) {
      throw new SmsProviderError('Twilio credentials are not configured', null);
    }

    const body = new URLSearchParams({
      To: input.to,
      From: env.TWILIO_FROM_NUMBER,
      Body: input.message,
    });
    const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(
      env.TWILIO_ACCOUNT_SID,
    )}/Messages.json`;
    const auth = Buffer.from(
      `${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`,
      'utf8',
    ).toString('base64');

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      throw new SmsProviderError(
        error instanceof Error ? error.message : 'Twilio request failed',
        null,
      );
    }

    const text = await response.text();
    let data: TwilioResponse = {};
    try {
      data = JSON.parse(text) as TwilioResponse;
    } catch {
      data = { message: text };
    }

    if (!response.ok || !data.sid) {
      throw new SmsProviderError(
        data.error_message ?? data.message ?? `Twilio returned HTTP ${response.status}`,
        data,
      );
    }

    return {
      providerMessageId: data.sid,
      providerResponse: data,
    };
  }
}
