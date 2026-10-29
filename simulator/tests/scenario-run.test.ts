import { describe, expect, it } from 'vitest';
import type {
  Alert,
  AlertType,
  Device,
  DeviceHealth,
  DeviceType,
  DrainGuardApi,
  DrainThresholds,
  IngestResult,
  ReadingSample,
} from '../src/client';
import { SCENARIOS, type ScenarioTools } from '../src/scenarios';

interface Harness {
  tools: ScenarioTools;
  alerts: Alert[];
  posts: { type: DeviceType; samples: ReadingSample[] }[];
  rainfall: { mmPerHour: number; externalId: string }[];
  healthChanges: { type: DeviceType; health: DeviceHealth }[];
  thresholdChanges: Partial<DrainThresholds>[];
  logs: string[];
}

const expectedAlert: Record<number, AlertType> = {
  1: 'BASKET_NEARLY_FULL',
  2: 'HIGH_WATER',
  3: 'POSSIBLE_BLOCKAGE',
  4: 'HIGH_WATER',
  5: 'SYSTEM_HEALTH',
  6: 'ENGINEERING_REVIEW',
};

const devices: Device[] = [
  ['LITTER', 'DEMO-market-square-drain-LITTER'],
  ['WATER_UPSTREAM', 'DEMO-market-square-drain-WATER_UPSTREAM'],
  ['WATER_DOWNSTREAM', 'DEMO-market-square-drain-WATER_DOWNSTREAM'],
].map(([type, serialNumber], index) => ({
  id: `device-${index + 1}`,
  drainId: 'drain-1',
  name: serialNumber!,
  serialNumber: serialNumber!,
  type: type as DeviceType,
  healthStatus: 'UNKNOWN',
  healthReason: null,
  lastSeenAt: null,
  lastReadingAt: null,
}));

function createHarness(): Harness {
  const alerts: Alert[] = [];
  const posts: Harness['posts'] = [];
  const rainfall: Harness['rainfall'] = [];
  const healthChanges: Harness['healthChanges'] = [];
  const thresholdChanges: Harness['thresholdChanges'] = [];
  const logs: string[] = [];
  let sequence = 0;

  const findAlerts = (type?: AlertType): Alert[] =>
    type ? alerts.filter((alert) => alert.type === type) : [...alerts];

  const tools: ScenarioTools = {
    api: {} as DrainGuardApi,
    drain: {
      id: 'drain-1',
      name: 'Market Square Drain',
      zone: 'Zone A',
      status: 'ACTIVE',
      latitude: -1.2864,
      longitude: 36.8172,
      thresholds: null,
    },
    devices,
    deviceKey: (type) => `key-${type}`,
    async post(type, samples): Promise<IngestResult> {
      posts.push({ type, samples });
      return {
        accepted: samples.length,
        duplicates: 0,
        deviceId: `device-${type}`,
        drainId: 'drain-1',
        type,
        lastReadingAt: samples.at(-1)?.recordedAt ?? null,
        rulesQueued: true,
      };
    },
    async rainfall(mmPerHour, externalId): Promise<void> {
      rainfall.push({ mmPerHour, externalId });
    },
    async findAlerts(type): Promise<Alert[]> {
      return findAlerts(type);
    },
    async ensureAlert(type): Promise<Alert> {
      const active = findAlerts(type).find(
        (alert) => alert.status === 'ACTIVE' || alert.status === 'ACKNOWLEDGED',
      );
      if (active) return active;

      sequence += 1;
      const alert: Alert = {
        id: `alert-${sequence}`,
        drainId: 'drain-1',
        deviceId: null,
        type,
        severity: 'WARNING',
        status: 'ACTIVE',
        rule: 'TEST',
        message: `Synthetic ${type}`,
        createdAt: new Date().toISOString(),
        resolvedAt: null,
      };
      alerts.push(alert);
      return alert;
    },
    async resolveAlert(alertId, note): Promise<void> {
      const alert = alerts.find((item) => item.id === alertId);
      if (!alert) throw new Error(`Missing alert ${alertId}`);
      alert.status = 'RESOLVED';
      alert.resolvedAt = new Date().toISOString();
      expect(note.length).toBeGreaterThan(0);
    },
    async markDevice(type, health): Promise<void> {
      healthChanges.push({ type, health });
    },
    async updateThresholds(thresholds): Promise<void> {
      thresholdChanges.push(thresholds);
    },
    async sleep(): Promise<void> {},
    log(message): void {
      logs.push(message);
    },
  };

  return { tools, alerts, posts, rainfall, healthChanges, thresholdChanges, logs };
}

describe('scenario recipes', () => {
  for (const scenario of SCENARIOS) {
    it(`runs scenario ${scenario.id}: ${scenario.title}`, async () => {
      const harness = createHarness();
      const result = await scenario.run(harness.tools);

      expect(result.summary.length).toBeGreaterThan(0);
      expect(harness.alerts.map((alert) => alert.type)).toContain(expectedAlert[scenario.id]);
      expect(harness.posts.length + harness.rainfall.length).toBeGreaterThan(0);
    });
  }

  it('restores thresholds after the repeat-blockage scenario', async () => {
    const harness = createHarness();
    await SCENARIOS[5]!.run(harness.tools);

    expect(harness.thresholdChanges).toHaveLength(2);
    expect(harness.thresholdChanges[1]).toMatchObject({
      differencePersistMinutes: 15,
      levelMatchWindowMinutes: 5,
      alertCooldownMinutes: 30,
      repeatBlockageCount: 3,
    });
    expect(harness.alerts.filter((alert) => alert.type === 'POSSIBLE_BLOCKAGE')).toHaveLength(3);
  });
});
