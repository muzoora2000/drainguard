import { describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';

describe('Prisma client factory', () => {
  it('creates a client with model delegates and event registration', async () => {
    expect(typeof prisma.user.count).toBe('function');
    expect(typeof prisma.$on).toBe('function');
    await prisma.$disconnect();
  });
});
