import { describe, expect, it } from 'vitest';
import { NOTIFICATION_TYPES } from '@hemcenter/shared';
import { PUSH_TEXT, canReport, canReview, canStart, dayDiff, isOverdue, reminderFor } from '../src/assignments/assignment-rules';

describe('overdue', () => {
  it('is late only when the responsible person still has to act and the date has passed', () => {
    expect(isOverdue('IN_PROGRESS', '2026-10-01', '2026-10-02')).toBe(true);
    expect(isOverdue('NEW', '2026-10-01', '2026-10-02')).toBe(true);
    expect(isOverdue('RETURNED', '2026-10-01', '2026-10-02')).toBe(true);
    expect(isOverdue('IN_PROGRESS', '2026-10-02', '2026-10-02')).toBe(false); // due today
    expect(isOverdue('REVIEW', '2026-09-01', '2026-10-02')).toBe(false); // waiting for the controller
    expect(isOverdue('DONE', '2026-09-01', '2026-10-02')).toBe(false);
    expect(isOverdue('REMOVED', '2026-09-01', '2026-10-02')).toBe(false);
  });
  it('counts days between calendar dates, across month and year ends', () => {
    expect(dayDiff('2026-10-05', '2026-10-02')).toBe(3);
    expect(dayDiff('2026-11-01', '2026-10-30')).toBe(2);
    expect(dayDiff('2027-01-01', '2026-12-31')).toBe(1);
    expect(dayDiff('2026-10-01', '2026-10-04')).toBe(-3);
  });
});

describe('what can be done', () => {
  it('follows the life of an assignment', () => {
    expect(['NEW', 'RETURNED'].every((s) => canStart(s as never))).toBe(true);
    expect(canStart('IN_PROGRESS')).toBe(false);
    expect(['NEW', 'IN_PROGRESS', 'RETURNED'].every((s) => canReport(s as never))).toBe(true);
    expect(canReport('REVIEW')).toBe(false);
    expect(canReport('DONE')).toBe(false);
    expect(canReview('REVIEW')).toBe(true);
    expect(canReview('IN_PROGRESS')).toBe(false);
  });
});

describe('reminders', () => {
  it('3 days, 1 day, the day itself, then daily once late', () => {
    expect(reminderFor(3)?.kind).toBe('D3');
    expect(reminderFor(1)?.kind).toBe('D1');
    expect(reminderFor(0)?.kind).toBe('D0');
    expect(reminderFor(-1)?.kind).toBe('OVERDUE');
    expect(reminderFor(-30)?.kind).toBe('OVERDUE');
    for (const d of [2, 4, 5, 10]) expect(reminderFor(d)).toBeNull();
  });
  it('every notification type has a push text in both languages, and none leaks the work itself', () => {
    for (const t of NOTIFICATION_TYPES) {
      expect(PUSH_TEXT[t].ru.length).toBeGreaterThan(5);
      expect(PUSH_TEXT[t].kk.length).toBeGreaterThan(5);
      expect(PUSH_TEXT[t].ru).not.toMatch(/[{}]/);
    }
  });
});
