import type { Prisma, Role } from '@prisma/client';
import { prisma } from './prisma';

export interface AccessUser {
  id: string;
  role: Role;
}

export async function drainAccessScope(user: AccessUser): Promise<Prisma.DrainWhereInput | null> {
  if (user.role === 'ADMIN' || user.role === 'SUPERVISOR') return null;

  if (user.role === 'ENGINEER') {
    return { tasks: { some: { type: 'ENGINEERING_INVESTIGATION' } } };
  }

  const assignments = await prisma.drainAssignment.findMany({
    where: { userId: user.id },
    select: { drainId: true, zone: true },
  });

  const drainIds = [
    ...new Set(assignments.map((assignment) => assignment.drainId).filter((id): id is string => Boolean(id))),
  ];
  const zones = [
    ...new Set(assignments.map((assignment) => assignment.zone).filter((zone): zone is string => Boolean(zone))),
  ];

  const conditions: Prisma.DrainWhereInput[] = [
    { tasks: { some: { assignedToId: user.id } } },
  ];
  if (drainIds.length) conditions.push({ id: { in: drainIds } });
  if (zones.length) conditions.push({ zone: { in: zones } });

  return { OR: conditions };
}

export function andDrainScope(
  scope: Prisma.DrainWhereInput | null,
  where: Prisma.DrainWhereInput,
): Prisma.DrainWhereInput {
  return scope ? { AND: [where, scope] } : where;
}

export async function canAccessDrain(user: AccessUser, drainId: string): Promise<boolean> {
  const scope = await drainAccessScope(user);
  if (!scope) return true;

  const drain = await prisma.drain.findFirst({
    where: { AND: [{ id: drainId }, scope] },
    select: { id: true },
  });
  return Boolean(drain);
}
