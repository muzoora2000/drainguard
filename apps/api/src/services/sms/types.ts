export interface SmsSendInput {
  to: string;
  message: string;
}

export interface SmsSendResult {
  providerMessageId: string;
  providerResponse: unknown;
}

export interface SmsProvider {
  readonly name: 'mock' | 'africastalking' | 'twilio';
  send(input: SmsSendInput): Promise<SmsSendResult>;
}

export class SmsProviderError extends Error {
  readonly providerResponse: unknown;

  constructor(message: string, providerResponse: unknown) {
    super(message);
    this.name = 'SmsProviderError';
    this.providerResponse = providerResponse;
  }
}
