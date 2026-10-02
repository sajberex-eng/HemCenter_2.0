import { describe, expect, it } from 'vitest';
import { activeStage, buildStages, formatRegistrationNumber, isAwaiting, routeProblem } from '../src/documents/approval-rules';

const step = (approverId: string, stage: number, status: 'PENDING' | 'APPROVED' | 'RETURNED' = 'PENDING') => ({ approverId, stage, status });

describe('stages', () => {
  it('numbers a route, putting "together with" approvers into the same stage', () => {
    expect(buildStages([{ approverId: 'law' }, { approverId: 'acc', parallelWithPrevious: true }, { approverId: 'dir' }])).toEqual([
      { approverId: 'law', stage: 1 },
      { approverId: 'acc', stage: 1 },
      { approverId: 'dir', stage: 2 },
    ]);
    // "together with the previous" on the first line means nothing
    expect(buildStages([{ approverId: 'a', parallelWithPrevious: true }, { approverId: 'b' }]).map((s) => s.stage)).toEqual([1, 2]);
  });
  it('the active stage is the earliest with someone still to decide', () => {
    expect(activeStage([step('a', 1, 'APPROVED'), step('b', 2), step('c', 3)])).toBe(2);
    expect(activeStage([step('a', 1), step('b', 1, 'APPROVED')])).toBe(1);
    expect(activeStage([step('a', 1, 'APPROVED')])).toBeNull();
    expect(activeStage([])).toBeNull();
  });
});

describe('whose turn', () => {
  const steps = [step('law', 1), step('acc', 1), step('dir', 2)];
  it('only pending approvers of the active stage, only while under review', () => {
    expect(isAwaiting('law', 'IN_REVIEW', steps)).toBe(true);
    expect(isAwaiting('acc', 'IN_REVIEW', steps)).toBe(true);
    expect(isAwaiting('dir', 'IN_REVIEW', steps)).toBe(false); // later stage
    expect(isAwaiting('stranger', 'IN_REVIEW', steps)).toBe(false);
    expect(isAwaiting('law', 'RETURNED', steps)).toBe(false);
    expect(isAwaiting('law', 'IN_REVIEW', [step('law', 1, 'APPROVED'), step('dir', 2)])).toBe(false); // already answered
    expect(isAwaiting('dir', 'IN_REVIEW', [step('law', 1, 'APPROVED'), step('dir', 2)])).toBe(true);
  });
});

describe('routes and numbers', () => {
  it('names what is wrong with a route', () => {
    expect(routeProblem([], 'me', 20)).toBe('ROUTE_REQUIRED');
    expect(routeProblem([{ approverId: 'a' }, { approverId: 'a' }], 'me', 20)).toBe('DUPLICATE_APPROVER');
    expect(routeProblem([{ approverId: 'me' }], 'me', 20)).toBe('APPROVER_IS_AUTHOR');
    expect(routeProblem([{ approverId: 'a' }, { approverId: 'b' }], 'me', 1)).toBe('ROUTE_TOO_LONG');
    expect(routeProblem([{ approverId: 'a' }, { approverId: 'b' }], 'me', 20)).toBeNull();
  });
  it('formats numbers as N-PREFIX/YYYY', () => {
    expect(formatRegistrationNumber(15, 'ПР', 2026)).toBe('15-ПР/2026');
  });
});
