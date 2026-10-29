import type { AuthDevice, AuthUser } from './auth';

declare global {
  namespace Express {
    interface Request {
      id: string;
      user?: AuthUser;
      device?: AuthDevice;
    }
  }
}

export {};
