import type { DocumentStatus, StepStatus } from '@hemcenter/shared';

export interface StepLike {
  approverId: string;
  stage: number;
  status: StepStatus;
}

/** The stage being decided now: the earliest one that still has a pending step. null when nothing is pending. */
export function activeStage(steps: Pick<StepLike, 'stage' | 'status'>[]): number | null {
  const pending = steps.filter((s) => s.status === 'PENDING').map((s) => s.stage);
  return pending.length ? Math.min(...pending) : null;
}

/** It is `userId`'s turn: the document is under review and they have a pending step in the active stage. */
export function isAwaiting(userId: string, status: DocumentStatus, steps: StepLike[]): boolean {
  if (status !== 'IN_REVIEW') return false;
  const stage = activeStage(steps);
  return stage !== null && steps.some((s) => s.approverId === userId && s.status === 'PENDING' && s.stage === stage);
}

export interface RouteInput {
  approverId: string;
  /** Approve together with the approver listed just before, instead of after them. */
  parallelWithPrevious?: boolean;
}

/** Turns a route as entered ("A, then B together with C, then D") into numbered stages 1, 2, 3. */
export function buildStages(route: RouteInput[]): { approverId: string; stage: number }[] {
  let stage = 0;
  return route.map((r, i) => {
    if (i === 0 || !r.parallelWithPrevious) stage += 1;
    return { approverId: r.approverId, stage };
  });
}

/** The error code for an unusable route, or null. */
export function routeProblem(route: RouteInput[], authorId: string, max: number): string | null {
  if (route.length === 0) return 'ROUTE_REQUIRED';
  if (route.length > max) return 'ROUTE_TOO_LONG';
  const ids = route.map((r) => r.approverId);
  if (new Set(ids).size !== ids.length) return 'DUPLICATE_APPROVER';
  if (ids.includes(authorId)) return 'APPROVER_IS_AUTHOR';
  return null;
}

/** "12-ПР/2026": running number, then the kind's letters, then the year. */
export const formatRegistrationNumber = (n: number, prefix: string, year: number) => `${n}-${prefix}/${year}`;
