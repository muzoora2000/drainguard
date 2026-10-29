import type {
  BlockageAnalysis,
  DeviceSnapshot,
  EffectiveDeviceHealth,
  RainfallContext,
  RainfallSnapshot,
  ReadingSnapshot,
  RiseRate,
  RuleThresholds,
  WaterPair,
} from './types';

export function minutesBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / 60_000;
}

export function round(value: number, decimals = 1): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function effectiveDeviceHealth(
  device: DeviceSnapshot,
  now: Date,
  heartbeatTimeoutMinutes: number,
): EffectiveDeviceHealth {
  if (device.healthStatus === 'FAULTY') {
    return { device, health: 'FAULTY', healthReason: device.healthReason ?? 'Device marked faulty' };
  }

  if (device.lastSeenAt) {
    const silentFor = minutesBetween(device.lastSeenAt, now);
    if (silentFor > heartbeatTimeoutMinutes) {
      return {
        device,
        health: 'OFFLINE',
        healthReason: `No contact for ${round(silentFor, 1)} minutes (timeout ${heartbeatTimeoutMinutes} minutes)`,
      };
    }
  }

  if (device.healthStatus === 'OFFLINE') {
    return { device, health: 'OFFLINE', healthReason: device.healthReason ?? 'Device marked offline' };
  }

  if (device.healthStatus === 'UNKNOWN') {
    return { device, health: 'UNKNOWN', healthReason: device.healthReason ?? 'No readings received yet' };
  }

  return { device, health: 'HEALTHY', healthReason: null };
}

export function isHealthy(effective: EffectiveDeviceHealth): boolean {
  return effective.health === 'HEALTHY';
}

export function goodReadingsWithin(
  readings: ReadingSnapshot[],
  now: Date,
  windowMinutes: number,
): ReadingSnapshot[] {
  const from = now.getTime() - windowMinutes * 60_000;
  return readings
    .filter(
      (reading) =>
        reading.quality === 'OK' &&
        reading.recordedAt.getTime() >= from &&
        reading.recordedAt.getTime() <= now.getTime(),
    )
    .sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
}

export function latestGoodReading(
  readings: ReadingSnapshot[],
  now: Date,
): ReadingSnapshot | null {
  const eligible = readings
    .filter((reading) => reading.quality === 'OK' && reading.recordedAt.getTime() <= now.getTime())
    .sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime());
  return eligible[0] ?? null;
}

export function computeRiseRates(
  readings: ReadingSnapshot[],
  healthyWaterDevices: EffectiveDeviceHealth[],
  now: Date,
  thresholds: RuleThresholds,
  minSpanSeconds = 60,
): RiseRate[] {
  const rates: RiseRate[] = [];

  for (const { device } of healthyWaterDevices) {
    const series = goodReadingsWithin(
      readings.filter((reading) => reading.deviceId === device.id),
      now,
      thresholds.riseRateWindowMinutes,
    );

    if (series.length < 2) continue;

    const oldest = series[0];
    const latest = series[series.length - 1];
    if (!oldest || !latest) continue;

    const spanMinutes = minutesBetween(oldest.recordedAt, latest.recordedAt);
    if (spanMinutes * 60 < minSpanSeconds) continue;

    rates.push({
      deviceId: device.id,
      type: device.type,
      oldest,
      latest,
      spanMinutes,
      rateCmPerMin: (latest.value - oldest.value) / spanMinutes,
    });
  }

  return rates;
}

export function pairWaterReadings(
  upstream: ReadingSnapshot[],
  downstream: ReadingSnapshot[],
  matchWindowMinutes: number,
): WaterPair[] {
  const downstreamSorted = [...downstream].sort(
    (a, b) => a.recordedAt.getTime() - b.recordedAt.getTime(),
  );
  const used = new Set<string>();
  const pairs: WaterPair[] = [];

  for (const up of [...upstream].sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime())) {
    let best: ReadingSnapshot | null = null;
    let bestGap = Number.POSITIVE_INFINITY;

    for (const down of downstreamSorted) {
      if (used.has(down.id)) continue;
      const gap = Math.abs(minutesBetween(up.recordedAt, down.recordedAt));
      if (gap <= matchWindowMinutes && gap < bestGap) {
        best = down;
        bestGap = gap;
      }
    }

    if (best) {
      used.add(best.id);
      pairs.push({
        upstream: up,
        downstream: best,
        differenceCm: up.value - best.value,
        gapMinutes: bestGap,
      });
    }
  }

  return pairs.sort((a, b) => a.upstream.recordedAt.getTime() - b.upstream.recordedAt.getTime());
}

export function analyseBlockage(
  pairs: WaterPair[],
  now: Date,
  thresholds: RuleThresholds,
): BlockageAnalysis {
  const windowStart = now.getTime() - thresholds.differencePersistMinutes * 60_000;
  const inWindow = pairs.filter((pair) => pair.upstream.recordedAt.getTime() >= windowStart);

  let maxGapMinutes: number | null = null;
  for (let index = 1; index < inWindow.length; index += 1) {
    const previous = inWindow[index - 1];
    const current = inWindow[index];
    if (!previous || !current) continue;
    const gap = minutesBetween(previous.upstream.recordedAt, current.upstream.recordedAt);
    maxGapMinutes = maxGapMinutes === null ? gap : Math.max(maxGapMinutes, gap);
  }

  const oldest = inWindow[0] ?? null;
  const oldestPairAgeMinutes = oldest ? minutesBetween(oldest.upstream.recordedAt, now) : null;
  const everyPairAboveThreshold =
    inWindow.length > 0 && inWindow.every((pair) => pair.differenceCm >= thresholds.levelDifferenceCm);

  const coverageOk =
    oldestPairAgeMinutes !== null &&
    oldestPairAgeMinutes >= thresholds.differencePersistMinutes * 0.9;
  const gapsOk =
    maxGapMinutes === null || maxGapMinutes <= 2 * thresholds.levelMatchWindowMinutes;
  const sustained = inWindow.length >= 3 && coverageOk && gapsOk && everyPairAboveThreshold;

  return {
    pairs: inWindow,
    sustained,
    latestPair: pairs.length > 0 ? (pairs[pairs.length - 1] ?? null) : null,
    oldestPairAgeMinutes,
    maxGapMinutes,
    everyPairAboveThreshold,
  };
}

export function rainfallContext(
  rainfall: RainfallSnapshot | null,
  now: Date,
  thresholds: RuleThresholds,
): RainfallContext {
  const recent =
    rainfall !== null &&
    rainfall.recordedAt.getTime() <= now.getTime() &&
    rainfall.recordedAt.getTime() >= now.getTime() - thresholds.rainfallLookbackMinutes * 60_000;

  const latestMmPerHour = recent ? rainfall.mmPerHour : null;

  return {
    intense:
      latestMmPerHour !== null && latestMmPerHour >= thresholds.intenseRainfallMmPerHour,
    latestMmPerHour,
    recordedAt: recent ? rainfall.recordedAt : null,
    lookbackMinutes: thresholds.rainfallLookbackMinutes,
    thresholdMmPerHour: thresholds.intenseRainfallMmPerHour,
  };
}

export function rainfallTriggerData(context: RainfallContext): Record<string, unknown> {
  return {
    intense: context.intense,
    latestMmPerHour: context.latestMmPerHour,
    recordedAt: context.recordedAt?.toISOString() ?? null,
    lookbackMinutes: context.lookbackMinutes,
    thresholdMmPerHour: context.thresholdMmPerHour,
  };
}
