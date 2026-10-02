import type { AssignmentDto } from '@hemcenter/shared';

export const STATUS_STYLE: Record<string, string> = {
  NEW: 'bg-slate-100 text-slate-700',
  IN_PROGRESS: 'bg-teal-100 text-teal-800',
  REVIEW: 'bg-amber-100 text-amber-900',
  DONE: 'bg-green-100 text-green-800',
  RETURNED: 'bg-red-100 text-red-800',
  REMOVED: 'bg-slate-200 text-slate-600',
};

/** Roles that give assignments by hand (the server checks it as well). */
export const canGiveAssignments = (roles: string[] | undefined) => !!roles?.some((r) => r === 'ADMIN' || r === 'MANAGEMENT' || r === 'PROJECT_MANAGER' || r === 'SECRETARY');
export const isOverseer = (roles: string[] | undefined) => !!roles?.some((r) => r === 'ADMIN' || r === 'MANAGEMENT');
export type { AssignmentDto };
