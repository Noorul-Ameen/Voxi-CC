import { describe, expect, it } from 'vitest';
import {
  addDays,
  formatDateLabel,
  formatMinutes,
  nowInDubai,
  parseDatePhrase,
  parseTimeLabel,
  toVoxDateParam,
} from '@shared/utils';

// Fixed reference: 2026-08-18 20:00 UTC = 2026-08-19 00:00 Dubai (midnight edge)
const LATE_UTC = new Date('2026-08-18T20:30:00Z');
// 2026-08-18 10:00 UTC = 14:00 Dubai (Tuesday)
const AFTERNOON = new Date('2026-08-18T10:00:00Z');

describe('nowInDubai', () => {
  it('uses UTC+4 regardless of host timezone', () => {
    expect(nowInDubai(AFTERNOON).date).toBe('2026-08-18');
    expect(nowInDubai(AFTERNOON).minutesFromMidnight).toBe(14 * 60);
  });
  it('crosses midnight correctly (browser-timezone independence)', () => {
    // 20:30 UTC is already tomorrow in Dubai.
    expect(nowInDubai(LATE_UTC).date).toBe('2026-08-19');
  });
});

describe('date helpers', () => {
  it('adds days across month ends', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
  });
  it('formats VOX date params', () => {
    expect(toVoxDateParam('2026-08-19')).toBe('20260819');
  });
  it('labels today/tomorrow relative to Dubai', () => {
    expect(formatDateLabel('2026-08-18', AFTERNOON)).toBe('Today');
    expect(formatDateLabel('2026-08-19', AFTERNOON)).toBe('Tomorrow');
  });
});

describe('parseTimeLabel', () => {
  it('parses VOX display times', () => {
    expect(parseTimeLabel('11:30pm')).toBe(23 * 60 + 30);
    expect(parseTimeLabel('12:00am')).toBe(0);
    expect(parseTimeLabel('12:15pm')).toBe(12 * 60 + 15);
    expect(parseTimeLabel('9:05am')).toBe(9 * 60 + 5);
  });
  it('rejects garbage', () => {
    expect(parseTimeLabel('25:99xx')).toBeUndefined();
  });
});

describe('formatMinutes', () => {
  it('round-trips display times', () => {
    expect(formatMinutes(19 * 60)).toBe('7:00pm');
    expect(formatMinutes(0)).toBe('12:00am');
    expect(formatMinutes(1440 + 30)).toBe('12:30am'); // post-midnight session
  });
});

describe('parseDatePhrase (Dubai-local)', () => {
  it('resolves today/tonight/tomorrow', () => {
    expect(parseDatePhrase('what is on today', AFTERNOON).date).toBe('2026-08-18');
    const tonight = parseDatePhrase('any movies tonight?', AFTERNOON);
    expect(tonight.date).toBe('2026-08-18');
    expect(tonight.timeFromMinutes).toBe(18 * 60);
    expect(parseDatePhrase('show me tomorrow', AFTERNOON).date).toBe('2026-08-19');
  });
  it('handles midnight transitions: "tonight" late UTC is the Dubai date', () => {
    expect(parseDatePhrase('tonight', LATE_UTC).date).toBe('2026-08-19');
  });
  it('resolves weekend to next Saturday (UAE weekend)', () => {
    // 2026-08-18 is a Tuesday → Saturday is 2026-08-22
    expect(parseDatePhrase('this weekend', AFTERNOON).date).toBe('2026-08-22');
  });
  it('resolves weekday names', () => {
    expect(parseDatePhrase('on friday', AFTERNOON).date).toBe('2026-08-21');
  });
  it('parses "after 7 PM" style floors, defaulting bare hours to PM', () => {
    expect(parseDatePhrase('times after 7 pm', AFTERNOON).timeFromMinutes).toBe(19 * 60);
    expect(parseDatePhrase('anything after 7?', AFTERNOON).timeFromMinutes).toBe(19 * 60);
    expect(parseDatePhrase('after dinner', AFTERNOON).timeFromMinutes).toBe(20 * 60);
  });
  it('parses explicit dates and rolls past dates to next year', () => {
    expect(parseDatePhrase('on 25 aug', AFTERNOON).date).toBe('2026-08-25');
    expect(parseDatePhrase('on 1 jan', AFTERNOON).date).toBe('2027-01-01');
  });
});
