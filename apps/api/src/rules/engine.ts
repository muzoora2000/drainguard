import type { AlertType, DeviceType } from '@prisma/client';
import {
  analyseBlockage,
  computeRiseRates,
  effectiveDeviceHealth,
  isHealthy,
  latestGoodReading,
  minutesBetween,
  pairWaterReadings,
  rainfallContext,
  rainfallTriggerData,
  round,
} from './helpers';
import type {
  AlertSnapshot,
  BlockageAnalysis,
  EffectiveDeviceHealth,
  ReadingSnapshot,
  RiseRate,
  RuleDecision,
  RuleInput,
} from './types';

const WATER_TYPES: DeviceType[] = ['WATER_UPSTREAM', 'WATER_DOWNSTREAM'];

function readingRef(reading: ReadingSnapshot): Record<string, unknown> {
  return {
    id: reading.id,
    deviceId: reading.deviceId,
    value: round(reading.value, 2),
    recordedAt: reading.recordedAt.toISOString(),
  };
}

function openAlertOfType(input: RuleInput, type: AlertType): AlertSnapshot | null {
  return input.openAlerts.find((alert) => alert.type === type) ?? null;
}

function resolveDecision(
  input: RuleInput,
  type: AlertType,
  rule: string,
  reason: string,
): RuleDecision[] {
  const alert = openAlertOfType(input, type);
  if (!alert) return [];
  return [{ kind: 'RESOLVE_ALERT', alertId: alert.id, alertType: type, rule, reason }];
}

function rateTriggerData(
  rate: RiseRate,
  context: ReturnType<typeof rainfallContext>,
  thresholdCmPerMin: number,
) {
  return {
    deviceId: rate.deviceId,
    deviceType: rate.type,
    readings: {
      from: readingRef(rate.oldest),
      to: readingRef(rate.latest),
    },
    spanMinutes: round(rate.spanMinutes, 2),
    computedRiseCmPerMin: round(rate.rateCmPerMin, 3),
    thresholdCmPerMin,
    rainfall: rainfallTriggerData(context),
  };
}

function blockageTriggerData(
  analysis: BlockageAnalysis,
  input: RuleInput,
  context: ReturnType<typeof rainfallContext>,
): Record<string, unknown> {
  const latest = analysis.latestPair;
  const first = analysis.pairs[0] ?? null;
  return {
    deviceIds: [
      latest?.upstream.deviceId ?? null,
      latest?.downstream.deviceId ?? null,
    ].filter(Boolean),
    latestDifferenceCm: latest ? round(latest.differenceCm, 2) : null,
    thresholdCm: input.drain.thresholds.levelDifferenceCm,
    sustainedForMinutes:
      analysis.oldestPairAgeMinutes === null ? null : round(analysis.oldestPairAgeMinutes, 1),
    requiredMinutes: input.drain.thresholds.differencePersistMinutes,
    pairs: analysis.pairs.length,
    maxPairGapMinutes: analysis.maxGapMinutes === null ? null : round(analysis.maxGapMinutes, 2),
    everyPairAboveThreshold: analysis.everyPairAboveThreshold,
    firstPair: first
      ? {
          upstream: readingRef(first.upstream),
          downstream: readingRef(first.downstream),
          differenceCm: round(first.differenceCm, 2),
        }
      : null,
    latestPair: latest
      ? {
          upstream: readingRef(latest.upstream),
          downstream: readingRef(latest.downstream),
          differenceCm: round(latest.differenceCm, 2),
        }
      : null,
    rainfall: rainfallTriggerData(context),
  };
}

/**
 * Pure rule evaluation. No database, network, clock or logging access.
 * Precedence is mandatory: health -> rainfall context -> remaining rules.
 */
export function evaluateRules(input: RuleInput): RuleDecision[] {
  if (input.drain.status !== 'ACTIVE') return [];

  const { now, drain, devices } = input;
  const thresholds = drain.thresholds;
  const decisions: RuleDecision[] = [];

  const effectiveDevices: EffectiveDeviceHealth[] = devices.map((device) =>
    effectiveDeviceHealth(device, now, thresholds.heartbeatTimeoutMinutes),
  );
  const healthyDevices = effectiveDevices.filter(isHealthy);
  const unhealthyDevices = effectiveDevices.filter(
    (item) => item.health === 'FAULTY' || item.health === 'OFFLINE',
  );

  const waterDevices = effectiveDevices.filter((item) => WATER_TYPES.includes(item.device.type));
  const healthyWaterDevices = healthyDevices.filter((item) =>
    WATER_TYPES.includes(item.device.type),
  );
  const litterDevice = healthyDevices.find((item) => item.device.type === 'LITTER') ?? null;

  // -------------------------------------------------------------------------
  // 1. Device health first.
  // -------------------------------------------------------------------------
  if (unhealthyDevices.length > 0) {
    const open = openAlertOfType(input, 'SYSTEM_HEALTH');
    if (!open) {
      const allWaterUnusable =
        waterDevices.length > 0 && healthyWaterDevices.length === 0;
      decisions.push({
        kind: 'OPEN_ALERT',
        type: 'SYSTEM_HEALTH',
        severity: allWaterUnusable ? 'CRITICAL' : 'WARNING',
        rule: 'DEVICE_HEALTH',
        triggerData: {
          devices: unhealthyDevices.map((item) => ({
            deviceId: item.device.id,
            name: item.device.name,
            type: item.device.type,
            health: item.health,
            reason: item.healthReason,
            lastSeenAt: item.device.lastSeenAt?.toISOString() ?? null,
            lastReadingAt: item.device.lastReadingAt?.toISOString() ?? null,
          })),
          heartbeatTimeoutMinutes: thresholds.heartbeatTimeoutMinutes,
          allWaterSensorsUnusable: allWaterUnusable,
        },
        message: `DrainGuard [SYSTEM HEALTH] Drain: ${drain.name}, Zone: ${drain.zone}. ${unhealthyDevices.length} device(s) faulty/offline. Check equipment.`,
        createTask: {
          type: 'DEVICE_REPAIR',
          priority: 'HIGH',
          title: `Repair faulty or offline device(s) at ${drain.name}`,
        },
      });
    }
  } else if (openAlertOfType(input, 'SYSTEM_HEALTH')) {
    decisions.push(
      ...resolveDecision(
        input,
        'SYSTEM_HEALTH',
        'DEVICE_HEALTH',
        'All previously affected devices are healthy again.',
      ),
    );
  }

  // -------------------------------------------------------------------------
  // 2. Rainfall context (before blockage logic).
  // -------------------------------------------------------------------------
  const context = rainfallContext(input.rainfall, now, thresholds);

  // -------------------------------------------------------------------------
  // 3. Remaining rules.
  // -------------------------------------------------------------------------

  // Basket fill.
  if (litterDevice) {
    const latest = latestGoodReading(
      input.litterReadings.filter((reading) => reading.deviceId === litterDevice.device.id),
      now,
    );
    const fresh =
      latest !== null &&
      minutesBetween(latest.recordedAt, now) <= thresholds.heartbeatTimeoutMinutes;

    if (latest && fresh) {
      const open = openAlertOfType(input, 'BASKET_NEARLY_FULL');
      if (latest.value >= thresholds.basketFillPercent && !open) {
        decisions.push({
          kind: 'OPEN_ALERT',
          type: 'BASKET_NEARLY_FULL',
          severity: 'WARNING',
          rule: 'BASKET_FILL_THRESHOLD',
          deviceId: litterDevice.device.id,
          triggerData: {
            deviceId: litterDevice.device.id,
            reading: readingRef(latest),
            fillPercent: round(latest.value, 1),
            thresholdPercent: thresholds.basketFillPercent,
          },
          message: `DrainGuard [BASKET FULL] Drain: ${drain.name}, Zone: ${drain.zone}. Basket at ${round(latest.value, 1)}% (threshold ${thresholds.basketFillPercent}%). Schedule removal.`,
          createTask: {
            type: 'LITTER_REMOVAL',
            priority: latest.value >= 95 ? 'HIGH' : 'MEDIUM',
            title: `Remove litter from ${drain.name}`,
          },
        });
      } else if (latest.value < thresholds.basketFillPercent && open) {
        decisions.push(
          ...resolveDecision(
            input,
            'BASKET_NEARLY_FULL',
            'BASKET_FILL_THRESHOLD',
            `Litter fill returned below the ${thresholds.basketFillPercent}% threshold.`,
          ),
        );
      }
    }
  }

  // High water / unusual rate of rise.
  const riseRates = computeRiseRates(
    input.waterReadings,
    healthyWaterDevices,
    now,
    thresholds,
  );
  const fastest = riseRates.reduce<RiseRate | null>(
    (best, rate) => (best === null || rate.rateCmPerMin > best.rateCmPerMin ? rate : best),
    null,
  );

  if (fastest && fastest.rateCmPerMin >= thresholds.waterRiseRateCmPerMin) {
    const open = openAlertOfType(input, 'HIGH_WATER');
    if (!open) {
      decisions.push({
        kind: 'OPEN_ALERT',
        type: 'HIGH_WATER',
        severity: 'CRITICAL',
        rule: 'HIGH_WATER_RISE_RATE',
        deviceId: fastest.deviceId,
        triggerData: {
          ...rateTriggerData(fastest, context, thresholds.waterRiseRateCmPerMin),
          rates: riseRates.map((rate) => ({
            deviceId: rate.deviceId,
            type: rate.type,
            rateCmPerMin: round(rate.rateCmPerMin, 3),
            spanMinutes: round(rate.spanMinutes, 2),
          })),
        },
        message: `DrainGuard [HIGH WATER] Drain: ${drain.name}, Zone: ${drain.zone}. Water rising fast (${round(fastest.rateCmPerMin, 1)} cm/min). Check now.`,
      });
    }
  } else if (openAlertOfType(input, 'HIGH_WATER')) {
    const allWaterHealthy =
      waterDevices.length > 0 && healthyWaterDevices.length === waterDevices.length;
    const allRatesKnown = riseRates.length === waterDevices.length;
    if (allWaterHealthy && allRatesKnown) {
      decisions.push(
        ...resolveDecision(
          input,
          'HIGH_WATER',
          'HIGH_WATER_RISE_RATE',
          `Water rise returned below the ${thresholds.waterRiseRateCmPerMin} cm/min threshold.`,
        ),
      );
    }
  }

  // Possible blockage (rainfall context applied before this block).
  const upstreamDevice = healthyWaterDevices.find((item) => item.device.type === 'WATER_UPSTREAM');
  const downstreamDevice = healthyWaterDevices.find(
    (item) => item.device.type === 'WATER_DOWNSTREAM',
  );

  if (upstreamDevice && downstreamDevice) {
    const upstreamReadings = input.waterReadings.filter(
      (reading) =>
        reading.deviceId === upstreamDevice.device.id &&
        reading.quality === 'OK' &&
        reading.recordedAt.getTime() <= now.getTime(),
    );
    const downstreamReadings = input.waterReadings.filter(
      (reading) =>
        reading.deviceId === downstreamDevice.device.id &&
        reading.quality === 'OK' &&
        reading.recordedAt.getTime() <= now.getTime(),
    );

    const pairs = pairWaterReadings(
      upstreamReadings,
      downstreamReadings,
      thresholds.levelMatchWindowMinutes,
    );
    const analysis = analyseBlockage(pairs, now, thresholds);
    const open = openAlertOfType(input, 'POSSIBLE_BLOCKAGE');
    const latest = analysis.latestPair;
    const latestIsCurrent =
      latest !== null &&
      minutesBetween(latest.upstream.recordedAt, now) <= thresholds.levelMatchWindowMinutes;

    if (open && latestIsCurrent && latest && latest.differenceCm < thresholds.levelDifferenceCm) {
      decisions.push(
        ...resolveDecision(
          input,
          'POSSIBLE_BLOCKAGE',
          'BLOCKAGE_SUSTAINED_DIFFERENCE',
          `Upstream/downstream difference returned below the ${thresholds.levelDifferenceCm} cm threshold.`,
        ),
      );
    } else if (analysis.sustained && !open) {
      if (context.intense) {
        decisions.push({
          kind: 'SUPPRESSED',
          type: 'POSSIBLE_BLOCKAGE',
          rule: 'BLOCKAGE_INTENSE_RAINFALL',
          reason:
            'A sustained level difference was observed during intense rainfall; blockage is not assumed.',
          triggerData: blockageTriggerData(analysis, input, context),
        });
      } else {
        decisions.push({
          kind: 'OPEN_ALERT',
          type: 'POSSIBLE_BLOCKAGE',
          severity: 'WARNING',
          rule: 'BLOCKAGE_SUSTAINED_DIFFERENCE',
          deviceId: upstreamDevice.device.id,
          triggerData: blockageTriggerData(analysis, input, context),
          message: `DrainGuard [POSSIBLE BLOCKAGE] Drain: ${drain.name}, Zone: ${drain.zone}. Upstream is ${round(latest?.differenceCm ?? 0, 1)} cm above downstream for ${round(analysis.oldestPairAgeMinutes ?? 0, 0)} min. Inspect.`,
          createTask: {
            type: 'BLOCKAGE_INSPECTION',
            priority: 'HIGH',
            title: `Inspect possible blockage at ${drain.name}`,
          },
        });
      }
    }
  }

  // Repeated blockage at the same location.
  const openEngineering = openAlertOfType(input, 'ENGINEERING_REVIEW');
  const blockagesSinceReview = input.recentBlockageAlerts.filter(
    (alert) =>
      !input.lastResolvedEngineeringReviewAt ||
      alert.createdAt.getTime() > input.lastResolvedEngineeringReviewAt.getTime(),
  ).length;

  if (
    !openEngineering &&
    blockagesSinceReview >= thresholds.repeatBlockageCount
  ) {
    decisions.push({
      kind: 'OPEN_ALERT',
      type: 'ENGINEERING_REVIEW',
      severity: 'WARNING',
      rule: 'REPEAT_BLOCKAGE_COUNT',
      triggerData: {
        blockagesSinceReview,
        requiredCount: thresholds.repeatBlockageCount,
        windowDays: thresholds.repeatBlockageWindowDays,
        blockageAlertIds: input.recentBlockageAlerts.map((alert) => alert.id),
        lastResolvedEngineeringReviewAt:
          input.lastResolvedEngineeringReviewAt?.toISOString() ?? null,
      },
      message: `DrainGuard [ENGINEERING REVIEW] Drain: ${drain.name}, Zone: ${drain.zone}. ${blockagesSinceReview} possible blockages in ${thresholds.repeatBlockageWindowDays} days. Review.`,
      createTask: {
        type: 'ENGINEERING_INVESTIGATION',
        priority: 'HIGH',
        title: `Engineering investigation at ${drain.name}`,
      },
    });
  }

  return decisions;
}
