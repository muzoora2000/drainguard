import type { DeviceType, DrainStatus, Role } from '@prisma/client';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  phone: string | null;
  smsOptIn: boolean;
  inAppOptIn: boolean;
  isFallbackContact: boolean;
  active: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
}

export interface AuthDevice {
  id: string;
  drainId: string;
  name: string;
  type: DeviceType;
  drain: {
    id: string;
    name: string;
    zone: string;
    status: DrainStatus;
  };
}
