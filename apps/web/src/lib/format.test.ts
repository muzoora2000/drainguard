import { describe, expect, it } from 'vitest';
import {
  enumLabel,
  formatDuration,
  formatNumber,
  formatPercent,
  initials,
  isOverdue,
  titleCase,
} from './format';

describe('format helpers', () => {
  it('converts enum values into readable labels', () => {
    expect(enumLabel('POSSIBLE_BLOCKAGE')).toBe('Possible blockage');
    expect(enumLabel('ENGINEERING_INVESTIGATION')).toBe('Engineering investigation');
    expect(enumLabel('ACTIVE')).toBe('Active');
  });

  it('title-cases unknown enum values', () => {
    expect(titleCase('SOME_NEW_VALUE')).toBe('Some New Value');
  });

  it('formats numbers with the requested precision', () => {
    expect(formatNumber(1234.56, 1)).toBe('1,234.6');
    expect(formatNumber(null)).toBe('—');
  });

  it('formats percentages', () => {
    expect(formatPercent(82.45, 1)).toBe('82.5%');
    expect(formatPercent(undefined)).toBe('—');
  });

  it('formats alert acknowledgement durations', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(0.5)).toBe('<1 min');
    expect(formatDuration(35)).toBe('35 min');
    expect(formatDuration(90)).toBe('1.5 hr');
    expect(formatDuration(60 * 30)).toBe('1.3 days');
  });

  it('builds initials from a person name', () => {
    expect(initials('Ama Mensah')).toBe('AM');
    expect(initials('  Kofi   Boateng  ')).toBe('KB');
  });

  it('detects overdue open tasks only', () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(isOverdue(past, 'SCHEDULED')).toBe(true);
    expect(isOverdue(past, 'DONE')).toBe(false);
    expect(isOverdue(future, 'IN_PROGRESS')).toBe(false);
    expect(isOverdue(null, 'SCHEDULED')).toBe(false);
  });
});
