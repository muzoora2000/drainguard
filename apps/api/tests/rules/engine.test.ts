import { describe, expect, it } from 'vitest';
import { evaluateRules } from '../../src/rules/engine';
import type { OpenAlertDecision, RuleDecision } from '../../src/rules/types';
import {
  baseDevices,
  baseInput,
  device,
  minutesAgo,
  openAlert,
  reading,
  risingWaterReadings,
  sustainedDifferenceReadings,
} from './fixtures';

function opened(decisions: RuleDecision[], type: string): OpenAlertDecision | undefined {
  return decisions.find(
    (decision): decision is OpenAlertDecision =>
      decision.kind === 'OPEN_ALERT' && decision.type === type,
  );
}

function resolved(decisions: RuleDecision[], type: string): boolean {
  return decisions.some(
    (decision) => decision.kind === 'RESOLVE_ALERT' && decision.alertType === type,
  );
}

describe('basket rule', () => {
  it('opens BASKET_NEARLY_FULL and schedules litter removal when fill >= threshold', () => {
    const decisions = evaluateRules(
      baseInput({
        litterReadings: [reading('litter-high', 'litter-1', 'LITTER', 96, 1)],
      }),
    );

    const alert = opened(decisions, 'BASKET_NEARLY_FULL');
    expect(alert).toBeDefined();
    expect(alert?.severity).toBe('WARNING');
    expect(alert?.createTask?.type).toBe('LITTER_REMOVAL');
    expect(alert?.createTask?.priority).toBe('HIGH');
    expect(alert?.triggerData.fillPercent).toBe(96);
  });

  it('auto-resolves when fill returns below the threshold', () => {
    const decisions = evaluateRules(
      baseInput({
        openAlerts: [openAlert('alert-basket', 'BASKET_NEARLY_FULL')],
        litterReadings: [reading('litter-low', 'litter-1', 'LITTER', 40, 1)],
      }),
    );

    expect(resolved(decisions, 'BASKET_NEARLY_FULL')).toBe(true);
    expect(opened(decisions, 'BASKET_NEARLY_FULL')).toBeUndefined();
  });

  it('does not use a faulty litter sensor reading', () => {
    const devices = baseDevices().map((item) =>
      item.type === 'LITTER'
        ? device('litter-1', 'LITTER', {
            healthStatus: 'FAULTY',
            healthReason: 'Lens obstructed',
          })
        : item,
    );

    const decisions = evaluateRules(
      baseInput({
        devices,
        litterReadings: [reading('litter-high', 'litter-1', 'LITTER', 99, 1)],
      }),
    );

    expect(opened(decisions, 'SYSTEM_HEALTH')).toBeDefined();
    expect(opened(decisions, 'BASKET_NEARLY_FULL')).toBeUndefined();
  });
});

describe('high water rule', () => {
  it('opens HIGH_WATER when the rise rate exceeds the threshold', () => {
    const decisions = evaluateRules(baseInput({ waterReadings: risingWaterReadings(10, 35, 10) }));

    const alert = opened(decisions, 'HIGH_WATER');
    expect(alert).toBeDefined();
    expect(alert?.severity).toBe('CRITICAL');
    expect(alert?.triggerData.computedRiseCmPerMin).toBeCloseTo(2.5, 2);
    expect(alert?.message).toContain('HIGH WATER');
  });

  it('ignores readings spanning less than 60 seconds', () => {
    const decisions = evaluateRules(
      baseInput({
        waterReadings: [
          reading('up-a', 'up-1', 'WATER_UPSTREAM', 0, 0.5),
          reading('up-b', 'up-1', 'WATER_UPSTREAM', 30, 0),
        ],
      }),
    );

    expect(opened(decisions, 'HIGH_WATER')).toBeUndefined();
  });

  it('auto-resolves when all healthy water devices show a normal rate', () => {
    const decisions = evaluateRules(
      baseInput({
        openAlerts: [openAlert('alert-water', 'HIGH_WATER', { severity: 'CRITICAL' })],
        waterReadings: [
          reading('up-old', 'up-1', 'WATER_UPSTREAM', 20, 10),
          reading('up-new', 'up-1', 'WATER_UPSTREAM', 21, 0),
          reading('down-old', 'down-1', 'WATER_DOWNSTREAM', 10, 10),
          reading('down-new', 'down-1', 'WATER_DOWNSTREAM', 11, 0),
        ],
      }),
    );

    expect(resolved(decisions, 'HIGH_WATER')).toBe(true);
  });

  it('does not auto-resolve while a water sensor is offline', () => {
    const devices = baseDevices().map((item) =>
      item.type === 'WATER_UPSTREAM'
        ? device('up-1', 'WATER_UPSTREAM', { lastSeenAt: minutesAgo(30) })
        : item,
    );

    const decisions = evaluateRules(
      baseInput({
        devices,
        openAlerts: [openAlert('alert-water', 'HIGH_WATER')],
      }),
    );

    expect(resolved(decisions, 'HIGH_WATER')).toBe(false);
    expect(opened(decisions, 'SYSTEM_HEALTH')).toBeDefined();
  });
});

describe('possible blockage rule', () => {
  it('opens POSSIBLE_BLOCKAGE for a sustained level difference', () => {
    const decisions = evaluateRules(
      baseInput({ waterReadings: sustainedDifferenceReadings(20) }),
    );

    const alert = opened(decisions, 'POSSIBLE_BLOCKAGE');
    expect(alert).toBeDefined();
    expect(alert?.severity).toBe('WARNING');
    expect(alert?.createTask?.type).toBe('BLOCKAGE_INSPECTION');
    expect(Number(alert?.triggerData.latestDifferenceCm)).toBe(20);
  });

  it('does not flag a difference that has not persisted long enough', () => {
    const readings = [];
    for (let minute = 10; minute >= 0; minute -= 1) {
      readings.push(reading(`up-${minute}`, 'up-1', 'WATER_UPSTREAM', 40, minute));
      readings.push(reading(`down-${minute}`, 'down-1', 'WATER_DOWNSTREAM', 20, minute));
    }

    const decisions = evaluateRules(baseInput({ waterReadings: readings }));
    expect(opened(decisions, 'POSSIBLE_BLOCKAGE')).toBeUndefined();
  });

  it('is not assumed during intense rainfall, but high water is still alerted', () => {
    const readings = [];
    for (let minute = 17; minute >= 0; minute -= 1) {
      const upstream = 20 + (17 - minute) * 3;
      readings.push(reading(`up-${minute}`, 'up-1', 'WATER_UPSTREAM', upstream, minute));
      readings.push(
        reading(`down-${minute}`, 'down-1', 'WATER_DOWNSTREAM', upstream - 20, minute),
      );
    }

    const decisions = evaluateRules(
      baseInput({
        waterReadings: readings,
        rainfall: { mmPerHour: 25, recordedAt: minutesAgo(2) },
      }),
    );

    const highWater = opened(decisions, 'HIGH_WATER');
    expect(highWater).toBeDefined();
    expect(opened(decisions, 'POSSIBLE_BLOCKAGE')).toBeUndefined();
    expect(opened(decisions, 'ENGINEERING_REVIEW')).toBeUndefined();

    const suppressed = decisions.find(
      (decision) =>
        decision.kind === 'SUPPRESSED' && decision.type === 'POSSIBLE_BLOCKAGE',
    );
    expect(suppressed).toBeDefined();
    expect(highWater?.triggerData.rainfall).toMatchObject({ intense: true });
  });

  it('does allow blockage detection when a rainfall sample is stale', () => {
    const decisions = evaluateRules(
      baseInput({
        waterReadings: sustainedDifferenceReadings(20),
        rainfall: { mmPerHour: 40, recordedAt: minutesAgo(90) },
      }),
    );

    expect(opened(decisions, 'POSSIBLE_BLOCKAGE')).toBeDefined();
  });

  it('auto-resolves when the difference returns below threshold', () => {
    const decisions = evaluateRules(
      baseInput({
        openAlerts: [openAlert('alert-blockage', 'POSSIBLE_BLOCKAGE')],
        waterReadings: [
          reading('up-old', 'up-1', 'WATER_UPSTREAM', 30, 5),
          reading('up-new', 'up-1', 'WATER_UPSTREAM', 20, 0),
          reading('down-old', 'down-1', 'WATER_DOWNSTREAM', 15, 5),
          reading('down-new', 'down-1', 'WATER_DOWNSTREAM', 18, 0),
        ],
      }),
    );

    expect(resolved(decisions, 'POSSIBLE_BLOCKAGE')).toBe(true);
  });
});

describe('health precedence', () => {
  it('does not evaluate blockage when the upstream sensor is faulty', () => {
    const devices = baseDevices().map((item) =>
      item.type === 'WATER_UPSTREAM'
        ? device('up-1', 'WATER_UPSTREAM', { healthStatus: 'FAULTY' })
        : item,
    );

    const decisions = evaluateRules(
      baseInput({
        devices,
        waterReadings: sustainedDifferenceReadings(25),
      }),
    );

    expect(opened(decisions, 'SYSTEM_HEALTH')).toBeDefined();
    expect(opened(decisions, 'POSSIBLE_BLOCKAGE')).toBeUndefined();
  });

  it('treats a stale heartbeat as offline and raises SYSTEM_HEALTH', () => {
    const devices = baseDevices().map((item) =>
      item.type === 'WATER_DOWNSTREAM'
        ? device('down-1', 'WATER_DOWNSTREAM', { lastSeenAt: minutesAgo(30) })
        : item,
    );

    const decisions = evaluateRules(baseInput({ devices }));
    const alert = opened(decisions, 'SYSTEM_HEALTH');
    expect(alert).toBeDefined();
    expect(alert?.createTask?.type).toBe('DEVICE_REPAIR');
  });

  it('auto-resolves SYSTEM_HEALTH when devices recover', () => {
    const decisions = evaluateRules(
      baseInput({
        openAlerts: [openAlert('alert-health', 'SYSTEM_HEALTH')],
        devices: baseDevices(),
      }),
    );

    expect(resolved(decisions, 'SYSTEM_HEALTH')).toBe(true);
  });

  it('marks SYSTEM_HEALTH critical when every water sensor is unusable', () => {
    const devices = baseDevices().map((item) =>
      item.type === 'WATER_UPSTREAM' || item.type === 'WATER_DOWNSTREAM'
        ? device(item.id, item.type, { healthStatus: 'FAULTY' })
        : item,
    );

    const decisions = evaluateRules(baseInput({ devices }));
    expect(opened(decisions, 'SYSTEM_HEALTH')?.severity).toBe('CRITICAL');
  });
});

describe('repeat blockage and engineering review', () => {
  it('flags the location for engineering review after the configured count', () => {
    const decisions = evaluateRules(
      baseInput({
        recentBlockageAlerts: [
          { id: 'b1', createdAt: minutesAgo(60 * 24) },
          { id: 'b2', createdAt: minutesAgo(60 * 48) },
          { id: 'b3', createdAt: minutesAgo(60 * 72) },
        ],
      }),
    );

    const alert = opened(decisions, 'ENGINEERING_REVIEW');
    expect(alert).toBeDefined();
    expect(alert?.createTask?.type).toBe('ENGINEERING_INVESTIGATION');
    expect(alert?.triggerData.blockagesSinceReview).toBe(3);
  });

  it('does not reopen an existing engineering review', () => {
    const decisions = evaluateRules(
      baseInput({
        openAlerts: [openAlert('eng-open', 'ENGINEERING_REVIEW')],
        recentBlockageAlerts: [
          { id: 'b1', createdAt: minutesAgo(60 * 24) },
          { id: 'b2', createdAt: minutesAgo(60 * 48) },
          { id: 'b3', createdAt: minutesAgo(60 * 72) },
        ],
      }),
    );

    expect(opened(decisions, 'ENGINEERING_REVIEW')).toBeUndefined();
    expect(resolved(decisions, 'ENGINEERING_REVIEW')).toBe(false);
  });

  it('only counts blockages after the last resolved engineering review', () => {
    const decisions = evaluateRules(
      baseInput({
        lastResolvedEngineeringReviewAt: minutesAgo(60 * 96),
        recentBlockageAlerts: [
          { id: 'b1', createdAt: minutesAgo(60 * 24) },
          { id: 'b2', createdAt: minutesAgo(60 * 48) },
        ],
      }),
    );

    expect(opened(decisions, 'ENGINEERING_REVIEW')).toBeUndefined();
  });
});

describe('inactive drains', () => {
  it('does not evaluate rules for an inactive drain', () => {
    const input = baseInput({
      litterReadings: [reading('litter-high', 'litter-1', 'LITTER', 99, 1)],
    });
    input.drain.status = 'INACTIVE';

    expect(evaluateRules(input)).toEqual([]);
  });
});
