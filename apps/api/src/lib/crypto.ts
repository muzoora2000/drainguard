import { createHash, randomBytes } from 'node:crypto';

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function generateDeviceApiKey(): { plaintext: string; hash: string; prefix: string } {
  const plaintext = `dg_${randomBytes(24).toString('base64url')}`;
  return {
    plaintext,
    hash: sha256(plaintext),
    prefix: plaintext.slice(0, 10),
  };
}

export function generateOpaqueToken(): string {
  return randomBytes(48).toString('base64url');
}
