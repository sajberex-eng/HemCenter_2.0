'use client';

import Link from 'next/link';
import { useState } from 'react';
import { TASK_STATUSES, type TaskCardDto, type TaskStatus } from '@hemcenter/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useChats } from '@/lib/chats';
import { useI18n } from '@/lib/i18n';
import { formatDate } from '@/lib/chatUtils';
import type { Key } from '@/lib/dictionaries';
import { ErrorText, useErrorText } from '../ui';

/** A task under the message it was created from. The person responsible can move it along from here. */
export function TaskCard({ task, readOnly }: { task: TaskCardDto; readOnly?: boolean }) {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const { nameOf } = useChats();
  const errorText = useErrorText();
  const [status, setStatus] = useState<TaskStatus | null>(null);
  const [error, setError] = useState<string>();
  const current = status ?? task.status;
  const canMove = !readOnly && user?.id === task.assigneeId;

  async function move(next: TaskStatus) {
    setError(undefined);
    try {
      await api(`/tasks/${task.id}`, { method: 'PATCH', body: { status: next } });
      setStatus(next);
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <div className="mb-1 rounded-lg border border-black/10 bg-white/70 p-2 text-sm" data-testid="task-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">✔ {task.title}</span>
        {task.overdue && current !== 'DONE' && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">{t('tasks.overdue')}</span>}
      </div>
      <p className="text-xs text-slate-600">
        {t('tasks.assignedTo', { name: nameOf(task.assigneeId) })}
        {task.dueDate ? ` · ${t('tasks.dueOn', { date: formatDate(task.dueDate, locale) })}` : ''}
      </p>
      <ErrorText>{error}</ErrorText>
      <div className="mt-1 flex items-center justify-between gap-2">
        {canMove ? (
          <select aria-label={t('projects.status')} data-testid="task-status" value={current} onChange={(e) => move(e.target.value as TaskStatus)} className="min-h-9 rounded-lg border border-slate-300 bg-white px-2 text-xs">
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`tasks.status.${s}` as Key)}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-xs text-slate-700">{t(`tasks.status.${current}` as Key)}</span>
        )}
        {!readOnly && (
          <Link href="/tasks" className="text-xs text-teal-800 underline">
            {t('nav.tasks')}
          </Link>
        )}
      </div>
    </div>
  );
}
