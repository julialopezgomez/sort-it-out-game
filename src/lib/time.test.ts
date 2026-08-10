import { describe, expect, it } from 'vitest';
import {
  clampTimeLimit,
  computeClockOffset,
  formatDuration,
  formatLimit,
  isUrgent,
  pausedRemainingMs,
  remainingMs,
  remainingSeconds,
  serverNow,
} from './time';

describe('server clock, not browser clock', () => {
  it('derives an offset from the server timestamp', () => {
    // The local clock is 60s behind the server.
    const local = Date.parse('2026-01-01T12:00:00.000Z');
    const offset = computeClockOffset('2026-01-01T12:01:00.000Z', local);
    expect(offset.offsetMs).toBe(60_000);
    expect(serverNow(offset, local)).toBe(Date.parse('2026-01-01T12:01:00.000Z'));
  });

  it('falls back to no offset when the server timestamp is unreadable', () => {
    expect(computeClockOffset('not a date', 1000).offsetMs).toBe(0);
  });

  it('shows a correct countdown even on a badly wrong local clock', () => {
    // Local clock is an hour fast; the deadline is 30s of real time away.
    const local = Date.parse('2026-01-01T13:00:00.000Z');
    const offset = computeClockOffset('2026-01-01T12:00:00.000Z', local);
    const left = remainingMs('2026-01-01T12:00:30.000Z', offset, local);
    expect(left).toBe(30_000);
  });
});

describe('timer expiry', () => {
  it('counts down to zero and never below', () => {
    const local = Date.parse('2026-01-01T12:00:00.000Z');
    const offset = computeClockOffset('2026-01-01T12:00:00.000Z', local);

    expect(remainingMs('2026-01-01T12:00:45.000Z', offset, local)).toBe(45_000);
    expect(remainingMs('2026-01-01T12:00:00.000Z', offset, local)).toBe(0);
    // Well past the deadline: still 0, not a negative number.
    expect(remainingMs('2026-01-01T11:59:00.000Z', offset, local)).toBe(0);
  });

  it('treats a null deadline as unlimited rather than inventing a far-off date', () => {
    expect(remainingMs(null, null)).toBeNull();
    expect(formatDuration(null)).toBe('∞');
    expect(remainingSeconds(null)).toBeNull();
    expect(isUrgent(null)).toBe(false);
  });

  it('rounds up so a timer never shows 0 while time remains', () => {
    expect(remainingSeconds(1)).toBe(1);
    expect(remainingSeconds(1001)).toBe(2);
    expect(remainingSeconds(0)).toBe(0);
  });

  it('marks the last ten seconds as urgent', () => {
    expect(isUrgent(10_001)).toBe(false);
    expect(isUrgent(10_000)).toBe(true);
    expect(isUrgent(0)).toBe(true);
  });
});

describe('formatting', () => {
  it('formats as minutes and padded seconds', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(9_000)).toBe('0:09');
    expect(formatDuration(65_000)).toBe('1:05');
    expect(formatDuration(300_000)).toBe('5:00');
  });

  it('formats the Host’s configured limits', () => {
    expect(formatLimit(null, 'No limit')).toBe('No limit');
    expect(formatLimit(60, 'No limit')).toBe('1:00');
    expect(formatLimit(300, 'No limit')).toBe('5:00');
    expect(formatLimit(45, 'No limit')).toBe('0:45');
    expect(formatLimit(90, 'No limit')).toBe('1:30');
  });
});

describe('pause and resume remaining time', () => {
  it('shows the exact preserved remainder while paused', () => {
    expect(pausedRemainingMs(23_400)).toBe(23_400);
    expect(pausedRemainingMs(null)).toBeNull();
    expect(pausedRemainingMs(-5)).toBe(0);
  });

  it('resumes from the remainder, not from the full duration', () => {
    // Paused with 12s left; the server issues a new deadline 12s from the resume moment.
    const preserved = 12_000;
    const resumeLocal = Date.parse('2026-01-01T12:05:00.000Z');
    const offset = computeClockOffset('2026-01-01T12:05:00.000Z', resumeLocal);
    const newDeadline = new Date(resumeLocal + preserved).toISOString();

    expect(remainingMs(newDeadline, offset, resumeLocal)).toBe(preserved);
    // And it is much less than the original 60s limit.
    expect(remainingMs(newDeadline, offset, resumeLocal)).toBeLessThan(60_000);
  });

  it('keeps an unlimited phase unlimited across a pause', () => {
    expect(pausedRemainingMs(null)).toBeNull();
    expect(remainingMs(null, null)).toBeNull();
  });
});

describe('custom time limits', () => {
  it('clamps a +30s / +1min nudge into the accepted range', () => {
    expect(clampTimeLimit(90)).toBe(90);
    expect(clampTimeLimit(1)).toBe(5);
    expect(clampTimeLimit(99_999)).toBe(3600);
    expect(clampTimeLimit(45.6)).toBe(46);
  });
});
