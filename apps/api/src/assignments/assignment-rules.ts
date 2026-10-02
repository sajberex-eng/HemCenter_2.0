import type { AssignmentStatus, NotificationType } from '@hemcenter/shared';

/** Statuses in which the responsible person still has to act. A report waiting for the controller is not "late". */
export const ACTIONABLE: readonly AssignmentStatus[] = ['NEW', 'IN_PROGRESS', 'RETURNED'];
export const FINISHED: readonly AssignmentStatus[] = ['DONE', 'REMOVED'];

export const isFinished = (s: AssignmentStatus) => FINISHED.includes(s);

/** YYYY-MM-DD strings compare as dates. */
export const dayDiff = (due: string, today: string): number => Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);

/** Overdue: the person still has to act and the due date is before today. Due today is not yet late. */
export const isOverdue = (status: AssignmentStatus, due: string, today: string): boolean => ACTIONABLE.includes(status) && due < today;

/** The next states the responsible person may move to by themselves. */
export const canStart = (s: AssignmentStatus) => s === 'NEW' || s === 'RETURNED';
export const canReport = (s: AssignmentStatus) => ACTIONABLE.includes(s);
export const canReview = (s: AssignmentStatus) => s === 'REVIEW';

/** Reminders: 3 days before, 1 day before, on the day, then every day while it is late. */
export function reminderFor(daysLeft: number): { kind: string; type: NotificationType } | null {
  if (daysLeft === 3) return { kind: 'D3', type: 'REMIND_D3' };
  if (daysLeft === 1) return { kind: 'D1', type: 'REMIND_D1' };
  if (daysLeft === 0) return { kind: 'D0', type: 'REMIND_D0' };
  if (daysLeft < 0) return { kind: 'OVERDUE', type: 'REMIND_OVERDUE' };
  return null;
}

/** What a push says: only what happened, never the text of the assignment (it travels through Google and Apple). */
export const PUSH_TEXT: Record<NotificationType, { ru: string; kk: string }> = {
  ASSIGNED: { ru: 'Вам назначено поручение', kk: 'Сізге тапсырма берілді' },
  REPORT_SUBMITTED: { ru: 'Получен отчёт по поручению', kk: 'Тапсырма бойынша есеп келді' },
  REPORT_ACCEPTED: { ru: 'Ваш отчёт принят', kk: 'Есебіңіз қабылданды' },
  REPORT_RETURNED: { ru: 'Отчёт возвращён на доработку', kk: 'Есеп пысықтауға қайтарылды' },
  DUE_REQUESTED: { ru: 'Просят перенести срок поручения', kk: 'Тапсырма мерзімін ауыстыруды сұрады' },
  DUE_APPROVED: { ru: 'Перенос срока согласован', kk: 'Мерзімді ауыстыру келісілді' },
  DUE_REJECTED: { ru: 'В переносе срока отказано', kk: 'Мерзімді ауыстырудан бас тартылды' },
  REMOVED: { ru: 'Поручение снято с контроля', kk: 'Тапсырма бақылаудан алынды' },
  REMIND_D3: { ru: 'Срок поручения через 3 дня', kk: 'Тапсырма мерзіміне 3 күн қалды' },
  REMIND_D1: { ru: 'Срок поручения завтра', kk: 'Тапсырма мерзімі ертең' },
  REMIND_D0: { ru: 'Срок поручения сегодня', kk: 'Тапсырма мерзімі бүгін' },
  REMIND_OVERDUE: { ru: 'Поручение просрочено', kk: 'Тапсырма мерзімі өтті' },
};
