import { randomUUID } from 'node:crypto';
import type {
  Alert,
  AlertType,
  Device,
  DeviceHealth,
  DeviceType,
  Drain,
  DrainGuardApi,
  DrainThresholds,
  IngestResult,
  ReadingSample,
} from './client';

export interface ScenarioTools {
  api: DrainGuardApi;
  drain: Drain;
  devices: Device[];
  deviceKey(type: DeviceType): string;
  post(type: DeviceType, samples: ReadingSample[]): Promise<IngestResult>;
  rainfall(mmPerHour: number, externalId: string, notes?: string): Promise<void>;
  findAlerts(type?: AlertType): Promise<Alert[]>;
  ensureAlert(type: AlertType, timeoutMs?: number): Promise<Alert>;
  resolveAlert(alertId: string, note: string): Promise<void>;
  markDevice(type: DeviceType, health: DeviceHealth, reason?: string): Promise<void>;
  updateThresholds(thresholds: Partial<DrainThresholds>): Promise<void>;
  sleep(ms: number): Promise<void>;
  log(message: string): void;
}

export interface ScenarioResult {
  summary: string;
  alerts: Alert[];
  details?: Record<string, unknown>;
}

export interface ScenarioDefinition {
  id: number;
  key: string;
  title: string;
  description: string;
  drainName: string;
  run(tools: ScenarioTools): Promise<ScenarioResult>;
}

const DEFAULT_THRESHOLDS: DrainThresholds = {
  basketFillPercent: 85,
  waterRiseRateCmPerMin: 2,
  levelDifferenceCm: 15,
  differencePersistMinutes: 15,
  intenseRainfallMmPerHour: 20,
  rainfallLookbackMinutes: 30,
  heartbeatTimeoutMinutes: 10,
  repeatBlockageCount: 3,
  repeatBlockageWindowDays: 30,
  alertCooldownMinutes: 30,
  escalationMinutes: 15,
  riseRateWindowMinutes: 10,
  levelMatchWindowMinutes: 5,
};

function runTag(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

function sample(
  value: number,
  minutesFromNow: number,
  externalId: string,
  quality: ReadingSample['quality'] = 'OK',
): ReadingSample {
  return {
    value,
    quality,
    recordedAt: new Date(Date.now() + minutesFromNow * 60_000).toISOString(),
    externalId,
  };
}

function secondsFrom(baseMs: number, seconds: number): string {
  return new Date(baseMs + seconds * 1_000).toISOString();
}

async function blockageSamples(
  tools: ScenarioTools,
  tag: string,
  baseMs: number,
  upstreamValue: number,
  downstreamValue: number,
): Promise<void> {
  const offsets = [-165, -83, 0];
  await tools.post(
    'WATER_UPSTREAM',
    offsets.map((offset, index) => ({
      value: upstreamValue,
      recordedAt: secondsFrom(baseMs, offset),
      externalId: `${tag}-up-${index}`,
    })),
  );
  await tools.post(
    'WATER_DOWNSTREAM',
    offsets.map((offset, index) => ({
      value: downstreamValue,
      recordedAt: secondsFrom(baseMs, offset),
      externalId: `${tag}-down-${index}`,
    })),
  );
}

const basketNearlyFull: ScenarioDefinition = {
  id: 1,
  key: 'basket',
  title: 'Basket nearly full',
  description: 'Fills the litter basket above 85% and expects a basket-full alert and removal task.',
  drainName: 'Market Square Drain',
  async run(tools) {
    const tag = runTag('basket');
    await tools.post('LITTER', [
      sample(76, -4, `${tag}-1`),
      sample(83, -2, `${tag}-2`),
      sample(92, 0, `${tag}-3`),
    ]);
    const alert = await tools.ensureAlert('BASKET_NEARLY_FULL');
    return {
      summary: 'Basket fill crossed the configured threshold and produced a basket alert.',
      alerts: [alert],
      details: { fillPercent: 92, thresholdPercent: tools.drain.thresholds?.basketFillPercent ?? 85 },
    };
  },
};

const highWater: ScenarioDefinition = {
  id: 2,
  key: 'high-water',
  title: 'Water rising unusually fast',
  description: 'Backdates a five-minute upstream rise above 2 cm/min and expects a critical high-water alert.',
  drainName: 'Riverside Road Drain',
  async run(tools) {
    const tag = runTag('high-water');
    await tools.post('WATER_UPSTREAM', [
      sample(10, -5, `${tag}-1`),
      sample(23, -2.5, `${tag}-2`),
      sample(40, 0, `${tag}-3`),
    ]);
    const alert = await tools.ensureAlert('HIGH_WATER');
    return {
      summary: 'Upstream water rose at 6 cm/min and produced a high-water alert.',
      alerts: [alert],
      details: { riseCmPerMin: 6, thresholdCmPerMin: tools.drain.thresholds?.waterRiseRateCmPerMin ?? 2 },
    };
  },
};

const possibleBlockage: ScenarioDefinition = {
  id: 3,
  key: 'blockage',
  title: 'Sustained level difference',
  description: 'Backdates four paired readings over 14 minutes with a 30 cm difference and expects a blockage alert.',
  drainName: 'Station Approach Drain',
  async run(tools) {
    const tag = runTag('blockage');
    const now = Date.now();
    const offsets = [-14, -10, -6, -2];
    await tools.post(
      'WATER_UPSTREAM',
      offsets.map((minutes, index) => ({
        value: 55,
        recordedAt: new Date(now + minutes * 60_000).toISOString(),
        externalId: `${tag}-up-${index}`,
      })),
    );
    await tools.post(
      'WATER_DOWNSTREAM',
      offsets.map((minutes, index) => ({
        value: 25,
        recordedAt: new Date(now + minutes * 60_000).toISOString(),
        externalId: `${tag}-down-${index}`,
      })),
    );
    const alert = await tools.ensureAlert('POSSIBLE_BLOCKAGE');
    return {
      summary: 'Upstream stayed 30 cm above downstream for 14 minutes and produced a blockage alert.',
      alerts: [alert],
      details: { differenceCm: 30, persistedMinutes: 14 },
    };
  },
};

const intenseRainfall: ScenarioDefinition = {
  id: 4,
  key: 'rainfall',
  title: 'Intense rainfall with high water',
  description:
    'Combines intense rainfall with rising water and a sustained level difference; expects high water without assuming a blockage.',
  drainName: 'Hillview Drain',
  async run(tools) {
    const tag = runTag('rainfall');
    const startedAt = Date.now();
    await tools.rainfall(35, `${tag}-rain`, 'Demo storm cell');

    const now = Date.now();
    const offsets = [-14, -10, -6, -2];
    await tools.post(
      'WATER_UPSTREAM',
      offsets.map((minutes, index) => ({
        value: 20 + index * 10,
        recordedAt: new Date(now + minutes * 60_000).toISOString(),
        externalId: `${tag}-up-${index}`,
      })),
    );
    await tools.post(
      'WATER_DOWNSTREAM',
      offsets.map((minutes, index) => ({
        value: index * 5,
        recordedAt: new Date(now + minutes * 60_000).toISOString(),
        externalId: `${tag}-down-${index}`,
      })),
    );

    const alert = await tools.ensureAlert('HIGH_WATER');
    const newBlockages = (await tools.findAlerts('POSSIBLE_BLOCKAGE')).filter(
      (item) => new Date(item.createdAt).getTime() >= startedAt,
    );

    if (newBlockages.length > 0) {
      throw new Error('A blockage alert was opened despite intense rainfall');
    }

    return {
      summary: 'High water alerted during intense rainfall; blockage was suppressed by rainfall context.',
      alerts: [alert],
      details: { rainfallMmPerHour: 35, suppressedBlockages: true },
    };
  },
};

const faultySensor: ScenarioDefinition = {
  id: 5,
  key: 'faulty-sensor',
  title: 'Faulty sensor / offline device',
  description: 'Marks the upstream sensor faulty and expects a system-health alert and repair task.',
  drainName: 'Green Park Drain',
  async run(tools) {
    const tag = runTag('health');
    await tools.markDevice('WATER_UPSTREAM', 'FAULTY', 'Simulated sensor failure');
    await tools.post('LITTER', [sample(30, 0, `${tag}-trigger`)]);
    const alert = await tools.ensureAlert('SYSTEM_HEALTH');
    return {
      summary: 'A faulty upstream sensor produced a system-health alert.',
      alerts: [alert],
      details: { deviceHealth: 'FAULTY' },
    };
  },
};

const repeatBlockages: ScenarioDefinition = {
  id: 6,
  key: 'repeat-blockage',
  title: 'Repeat blockages leading to engineering review',
  description:
    'Uses a shortened persistence window to create three blockage alerts, then expects an engineering-review alert.',
  drainName: 'Station Approach Drain',
  async run(tools) {
    const tag = runTag('repeat');
    const original = tools.drain.thresholds ?? DEFAULT_THRESHOLDS;
    const windowStart = Date.now() - (original.repeatBlockageWindowDays ?? 30) * 86_400_000;

    await tools.updateThresholds({
      differencePersistMinutes: 3,
      levelMatchWindowMinutes: 2,
      alertCooldownMinutes: 0,
      repeatBlockageCount: 3,
    });

    try {
      let blockages = (await tools.findAlerts('POSSIBLE_BLOCKAGE')).filter(
        (item) => new Date(item.createdAt).getTime() >= windowStart,
      );

      for (let round = 0; blockages.length < 3 && round < 6; round += 1) {
        const open = blockages.filter(
          (item) => item.status === 'ACTIVE' || item.status === 'ACKNOWLEDGED',
        );
        for (const alert of open) {
          await tools.resolveAlert(alert.id, 'Simulator cleared the demo blockage before the next cycle.');
        }

        const baseMs = Date.now() - (6 - round) * 750;
        await blockageSamples(tools, `${tag}-${round}`, baseMs, 55, 25);
        await tools.ensureAlert('POSSIBLE_BLOCKAGE');
        blockages = (await tools.findAlerts('POSSIBLE_BLOCKAGE')).filter(
          (item) => new Date(item.createdAt).getTime() >= windowStart,
        );
      }

      if (blockages.length < 3) {
        throw new Error(`Only ${blockages.length} blockage alert(s) were created`);
      }

      const openBlockages = blockages.filter(
        (item) => item.status === 'ACTIVE' || item.status === 'ACKNOWLEDGED',
      );
      for (const alert of openBlockages) {
        await tools.resolveAlert(alert.id, 'Simulator completed the repeat-blockage sequence.');
      }

      await blockageSamples(tools, `${tag}-final`, Date.now() - 5_000, 55, 25);
      const alert = await tools.ensureAlert('ENGINEERING_REVIEW');

      return {
        summary: 'Three recent blockages triggered an engineering-review alert and investigation task.',
        alerts: [alert],
        details: { blockageAlerts: blockages.length },
      };
    } finally {
      await tools.updateThresholds(original);
    }
  },
};

export const SCENARIOS: ScenarioDefinition[] = [
  basketNearlyFull,
  highWater,
  possibleBlockage,
  intenseRainfall,
  faultySensor,
  repeatBlockages,
];

export function findScenario(query: string): ScenarioDefinition | undefined {
  const normalized = query.trim().toLowerCase();
  return SCENARIOS.find(
    (scenario) =>
      String(scenario.id) === normalized ||
      scenario.key === normalized ||
      scenario.title.toLowerCase() === normalized,
  );
}
