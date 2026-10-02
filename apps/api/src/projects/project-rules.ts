import { LOADED_PROJECT_STATUSES, WORKLOAD_LIMIT, type DecisionAnswer, type DecisionStatus, type ProjectStatus } from '@hemcenter/shared';

/** Today as a calendar date in the centre's time zone (APP_TIMEZONE, default Asia/Almaty), "YYYY-MM-DD". */
export function todayIn(zone = process.env.APP_TIMEZONE || 'Asia/Almaty', now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** A `@db.Date` value comes back as midnight UTC of that calendar date. */
export const dateOnly = (d: Date | null | undefined): string | null => (d ? d.toISOString().slice(0, 10) : null);

/** Parses "YYYY-MM-DD" into the Date Prisma expects for a date column; null for junk (including 2026-02-31). */
export function parseDate(v: string | null | undefined): Date | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : d;
}

/** Not finished and the due date is before today. A task due today is not late yet. */
export const isOverdue = (due: Date | string | null | undefined, finished: boolean, today = todayIn()): boolean => {
  if (finished || !due) return false;
  const day = typeof due === 'string' ? due.slice(0, 10) : dateOnly(due)!;
  return day < today;
};

/** Objections win; otherwise the decision is confirmed once every addressee has answered. */
export function decisionStatus(addresseeIds: string[], responses: { userId: string; answer: DecisionAnswer }[]): DecisionStatus {
  const mine = responses.filter((r) => addresseeIds.includes(r.userId));
  if (mine.some((r) => r.answer === 'OBJECT')) return 'OBJECTIONS';
  return addresseeIds.every((id) => mine.some((r) => r.userId === id)) ? 'CONFIRMED' : 'PENDING';
}

export interface Membership {
  userId: string;
  allocation: number;
  projectStatus: ProjectStatus;
}

/** Sum of the shares in projects that are planned or running; paused and finished projects free the person. */
export const totalLoad = (rows: Pick<Membership, 'allocation' | 'projectStatus'>[]): number =>
  rows.filter((r) => LOADED_PROJECT_STATUSES.includes(r.projectStatus)).reduce((sum, r) => sum + r.allocation, 0);

export const isOverloaded = (total: number): boolean => total > WORKLOAD_LIMIT;
