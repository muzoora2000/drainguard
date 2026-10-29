import { DeviceType, Role } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { hashPassword } from '../src/lib/password';
import { generateDeviceApiKey } from '../src/lib/crypto';
import { env } from '../src/config/env';

const defaultPassword = process.env.SEED_PASSWORD ?? 'DrainGuard123!';

if (env.NODE_ENV === 'production' && !process.env.SEED_PASSWORD) {
  throw new Error('SEED_PASSWORD must be set when running the seed in production');
}

const users = [
  { email: 'admin@drainguard.local', name: 'System Administrator', role: Role.ADMIN },
  { email: 'supervisor@drainguard.local', name: 'Zones Supervisor', role: Role.SUPERVISOR },
  { email: 'technician@drainguard.local', name: 'Field Technician', role: Role.TECHNICIAN },
] as const;

const drains = [
  { name: 'Market Square Drain', zone: 'Zone A', latitude: -1.2864, longitude: 36.8172, address: 'Market Street' },
  { name: 'Riverside Road Drain', zone: 'Zone A', latitude: -1.2921, longitude: 36.8219, address: 'Riverside Road' },
  { name: 'Station Approach Drain', zone: 'Zone B', latitude: -1.3012, longitude: 36.8291, address: 'Station Approach' },
  { name: 'Industrial Park Drain', zone: 'Zone B', latitude: -1.3089, longitude: 36.8355, address: 'Industrial Park' },
  { name: 'Hillview Drain', zone: 'Zone C', latitude: -1.2795, longitude: 36.8103, address: 'Hillview Estate' },
  { name: 'Green Park Drain', zone: 'Zone C', latitude: -1.2741, longitude: 36.8266, address: 'Green Park' },
];

const deviceTypes: DeviceType[] = ['LITTER', 'WATER_UPSTREAM', 'WATER_DOWNSTREAM'];

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

async function main(): Promise<void> {
  const passwordHash = await hashPassword(defaultPassword);

  const seededUsers = new Map<string, { id: string }>();
  for (const user of users) {
    const record = await prisma.user.upsert({
      where: { email: user.email },
      create: {
        email: user.email,
        name: user.name,
        role: user.role,
        passwordHash,
        isFallbackContact: user.role === Role.SUPERVISOR,
      },
      update: {
        name: user.name,
        role: user.role,
        passwordHash,
        active: true,
      },
      select: { id: true },
    });
    seededUsers.set(user.email, record);
  }

  const seededDrains: { id: string; name: string; zone: string }[] = [];
  for (const drain of drains) {
    let record = await prisma.drain.findFirst({
      where: { name: drain.name },
      select: { id: true, name: true, zone: true },
    });

    if (!record) {
      record = await prisma.drain.create({
        data: {
          ...drain,
          thresholds: { create: {} },
        },
        select: { id: true, name: true, zone: true },
      });
    }
    seededDrains.push(record);
  }

  const apiKeys: { serialNumber: string; name: string; type: DeviceType; apiKey: string }[] = [];
  for (const drain of seededDrains) {
    for (const type of deviceTypes) {
      const serialNumber = `DEMO-${slug(drain.name)}-${type}`;
      const apiKey = generateDeviceApiKey();
      const label = type
        .replaceAll('_', ' ')
        .toLowerCase()
        .replace(/\b\w/g, (letter) => letter.toUpperCase());

      await prisma.device.upsert({
        where: { serialNumber },
        create: {
          drainId: drain.id,
          name: `${drain.name} ${label}`,
          serialNumber,
          type,
          apiKeyHash: apiKey.hash,
          apiKeyPrefix: apiKey.prefix,
          healthStatus: 'UNKNOWN',
        },
        update: {
          drainId: drain.id,
          name: `${drain.name} ${label}`,
          type,
          apiKeyHash: apiKey.hash,
          apiKeyPrefix: apiKey.prefix,
        },
      });

      apiKeys.push({
        serialNumber,
        name: `${drain.name} ${label}`,
        type,
        apiKey: apiKey.plaintext,
      });
    }
  }

  const supervisor = seededUsers.get('supervisor@drainguard.local');
  const technician = seededUsers.get('technician@drainguard.local');

  if (supervisor) {
    await prisma.drainAssignment.createMany({
      data: [...new Set(seededDrains.map((drain) => drain.zone))].map((zone) => ({
        userId: supervisor.id,
        zone,
      })),
      skipDuplicates: true,
    });
  }

  if (technician) {
    await prisma.drainAssignment.createMany({
      data: [
        ...seededDrains
          .filter((drain) => drain.zone === 'Zone A' || drain.zone === 'Zone B')
          .map((drain) => ({ userId: technician.id, drainId: drain.id })),
      ],
      skipDuplicates: true,
    });
  }

  console.log('Seed complete.');
  console.log('Demo users (password: %s):', defaultPassword);
  for (const user of users) console.log(`- ${user.email} (${user.role})`);
  console.log('Device API keys (store securely; re-running the seed rotates them):');
  for (const key of apiKeys) {
    console.log(`- ${key.name} [${key.type}] serial=${key.serialNumber}: ${key.apiKey}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
