import { describe, expect, it } from 'vitest';
import { SCENARIOS, findScenario } from '../src/scenarios';

describe('scenario catalog', () => {
  it('contains the six supported scenarios', () => {
    expect(SCENARIOS).toHaveLength(6);
    expect(SCENARIOS.map((scenario) => scenario.id)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('uses unique keys and titles', () => {
    expect(new Set(SCENARIOS.map((scenario) => scenario.key)).size).toBe(6);
    expect(new Set(SCENARIOS.map((scenario) => scenario.title)).size).toBe(6);
  });

  it('resolves scenarios by id, key, and title', () => {
    expect(findScenario('1')?.key).toBe('basket');
    expect(findScenario('high-water')?.id).toBe(2);
    expect(findScenario('Sustained level difference')?.key).toBe('blockage');
    expect(findScenario('missing')).toBeUndefined();
  });

  it('maps every scenario to a seeded drain', () => {
    const allowed = new Set([
      'Market Square Drain',
      'Riverside Road Drain',
      'Station Approach Drain',
      'Industrial Park Drain',
      'Hillview Drain',
      'Green Park Drain',
    ]);
    for (const scenario of SCENARIOS) {
      expect(allowed.has(scenario.drainName)).toBe(true);
      expect(typeof scenario.run).toBe('function');
    }
  });
});
