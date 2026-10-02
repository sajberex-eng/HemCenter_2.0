'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { TASK_STATUSES, type DecisionDto, type TaskDto, type TaskStatus } from '@hemcenter/shared';
import { api } from '@/lib/api';
import { useChats } from '@/lib/chats';
import { useI18n } from '@/lib/i18n';
import { formatDate } from '@/lib/chatUtils';
import type { Key } from '@/lib/dictionaries';
import { Card, ErrorText, PageTitle, useErrorText } from '@/components/ui';
import { DecisionCard } from '@/components/work/DecisionCard';

export default function TasksPage() {
  const { t, locale } = useI18n();
  const { nameOf, ensurePeople, subscribe } = useChats();
  const errorText = useErrorText();
  const [tasks, setTasks] = useState<TaskDto[]>();
  const [pending, setPending] = useState<DecisionDto[]>([]);
  const [showDone, setShowDone] = useState(false);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    try {
      const list = await api<TaskDto[]>(`/tasks?mine=1${showDone ? '' : '&status=open'}`);
      setTasks(list);
      ensurePeople(list.map((x) => x.assigneeId));
      setPending(await api<DecisionDto[]>('/decisions/pending'));
    } catch (e) {
      setError(errorText(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDone, ensurePeople]);

  useEffect(() => {
    void load();
  }, [load]);
  // a decision answered elsewhere (or a new one) arrives as a message update
  useEffect(() => subscribe((e) => { if (e.type === 'message:updated' || e.type === 'resync') void load(); }), [subscribe, load]);

  async function move(task: TaskDto, status: TaskStatus) {
    setError(undefined);
    try {
      await api(`/tasks/${task.id}`, { method: 'PATCH', body: { status } });
      await load();
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageTitle>{t('tasks.title')}</PageTitle>
      <ErrorText>{error}</ErrorText>

      {pending.length > 0 && (
        <section aria-label={t('decision.pendingTitle')} className="space-y-2" data-testid="pending-decisions">
          <h2 className="font-medium">{t('decision.pendingTitle')}</h2>
          {pending.map((d) => (
            <Card key={d.id}>
              <DecisionCard decision={d} />
              <Link href={`/chats/${d.sourceChatId}`} className="text-sm text-teal-800 underline">{t('tasks.fromChat')}</Link>
            </Card>
          ))}
        </section>
      )}

      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" className="h-5 w-5" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
        {t('tasks.showDone')}
      </label>
      {tasks && tasks.length === 0 && <p className="text-slate-500">{t('tasks.empty')}</p>}
      <ul className="space-y-2">
        {tasks?.map((task) => (
          <li key={task.id}>
            <Card data-testid="my-task">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className={task.status === 'DONE' ? 'text-slate-500 line-through' : 'font-medium'}>{task.title}</span>
                {task.overdue && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">{t('tasks.overdue')}</span>}
              </div>
              {task.description && <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{task.description}</p>}
              <p className="mt-1 text-xs text-slate-600">
                {task.dueDate ? t('tasks.dueOn', { date: formatDate(task.dueDate, locale) }) : ''}
                {task.coAssigneeIds.length > 0 ? ` · ${t('tasks.coAssignees')}: ${task.coAssigneeIds.map(nameOf).join(', ')}` : ''}
              </p>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <select aria-label={t('projects.status')} value={task.status} onChange={(e) => move(task, e.target.value as TaskStatus)} className="min-h-10 rounded-lg border border-slate-300 bg-white px-2 text-sm">
                  {TASK_STATUSES.map((s) => <option key={s} value={s}>{t(`tasks.status.${s}` as Key)}</option>)}
                </select>
                <span className="flex gap-3 text-sm">
                  {task.projectId && <Link href={`/projects/${task.projectId}`} className="text-teal-800 underline">{t('tasks.project')}</Link>}
                  {task.sourceChatId && <Link href={`/chats/${task.sourceChatId}`} className="text-teal-800 underline">{t('tasks.fromChat')}</Link>}
                </span>
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
