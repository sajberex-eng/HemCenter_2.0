import { describe, expect, it } from 'vitest';
import { decisionStatus, isOverdue, isOverloaded, parseDate, todayIn, totalLoad } from '../src/projects/project-rules';

describe('decisionStatus', () => {
  const ids = ['a', 'b', 'c'];
  it('waits while someone has not answered', () => {
    expect(decisionStatus(ids, [])).toBe('PENDING');
    expect(decisionStatus(ids, [{ userId: 'a', answer: 'AGREE' }, { userId: 'b', answer: 'ACKNOWLEDGED' }])).toBe('PENDING');
  });
  it('is confirmed when everyone answered without objecting', () => {
    expect(decisionStatus(ids, ids.map((userId) => ({ userId, answer: 'AGREE' as const })))).toBe('CONFIRMED');
    expect(decisionStatus(ids, [{ userId: 'a', answer: 'AGREE' }, { userId: 'b', answer: 'ACKNOWLEDGED' }, { userId: 'c', answer: 'AGREE' }])).toBe('CONFIRMED');
  });
  it('shows objections at once, even before everyone has answered', () => {
    expect(decisionStatus(ids, [{ userId: 'c', answer: 'OBJECT' }])).toBe('OBJECTIONS');
  });
  it('ignores answers from people who are not addressees', () => {
    expect(decisionStatus(['a'], [{ userId: 'x', answer: 'OBJECT' }])).toBe('PENDING');
  });
});

describe('dates', () => {
  it('a task due today is not late; yesterday is; finished or undated never is', () => {
    expect(isOverdue('2026-10-02', false, '2026-10-02')).toBe(false);
    expect(isOverdue('2026-10-01', false, '2026-10-02')).toBe(true);
    expect(isOverdue('2026-10-01', true, '2026-10-02')).toBe(false);
    expect(isOverdue(null, false, '2026-10-02')).toBe(false);
  });
  it('takes "today" in the centre time zone, not UTC', () => {
    const lateEveningUtc = new Date('2026-10-01T20:30:00Z'); // already 02:30 on 2 October in Almaty (UTC+5)
    expect(todayIn('Asia/Almaty', lateEveningUtc)).toBe('2026-10-02');
    expect(todayIn('UTC', lateEveningUtc)).toBe('2026-10-01');
  });
  it('rejects impossible calendar dates', () => {
    expect(parseDate('2026-02-31')).toBeNull();
    expect(parseDate('26-1-1')).toBeNull();
    expect(parseDate('2026-10-02')?.toISOString()).toBe('2026-10-02T00:00:00.000Z');
  });
});

describe('workload', () => {
  it('adds up planned and running projects only', () => {
    const rows = [
      { allocation: 50, projectStatus: 'ACTIVE' as const },
      { allocation: 40, projectStatus: 'PLANNED' as const },
      { allocation: 30, projectStatus: 'ACTIVE' as const },
      { allocation: 90, projectStatus: 'ON_HOLD' as const },
      { allocation: 90, projectStatus: 'DONE' as const },
    ];
    expect(totalLoad(rows)).toBe(120);
  });
  it('flags only totals above 100', () => {
    expect(isOverloaded(100)).toBe(false);
    expect(isOverloaded(101)).toBe(true);
  });
});
