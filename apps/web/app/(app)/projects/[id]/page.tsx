'use client';

import Link from 'next/link';
import { use, useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { PROJECT_STATUSES, type ProjectDto, type ProjectStatus, type TaskDto } from '@hemcenter/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useChats } from '@/lib/chats';
import { useI18n } from '@/lib/i18n';
import { formatDate } from '@/lib/chatUtils';
import type { Key } from '@/lib/dictionaries';
import { Button, Card, ErrorText, Field, Input, PageTitle, Select, useErrorText } from '@/components/ui';

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const { people, nameOf, ensurePeople } = useChats();
  const errorText = useErrorText();
  const [project, setProject] = useState<ProjectDto>();
  const [tasks, setTasks] = useState<TaskDto[]>([]);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    try {
      const p = await api<ProjectDto>(`/projects/${id}`);
      setProject(p);
      ensurePeople([p.managerId, ...p.members.map((m) => m.userId)]);
      setTasks(await api<TaskDto[]>(`/tasks?projectId=${id}`));
    } catch {
      setMissing(true);
    }
  }, [id, ensurePeople]);

  useEffect(() => {
    void load();
  }, [load]);

  const canManage = !!project && !!user && (project.managerId === user.id || user.roles.includes('ADMIN') || user.roles.includes('MANAGEMENT'));

  async function run(fn: () => Promise<unknown>) {
    setError(undefined);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(errorText(e));
    }
  }

  if (missing) return <p className="p-6 text-slate-600">{t('err.PROJECT_NOT_FOUND')}</p>;
  if (!project) return <p className="p-6 text-slate-500">{t('loading')}</p>;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href="/projects" className="text-sm text-teal-800 underline">‹ {t('projects.title')}</Link>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PageTitle>{project.name}</PageTitle>
        <Link href={`/chats/${project.chatId}`} className="inline-flex min-h-11 items-center rounded-lg bg-teal-700 px-4 text-sm font-medium text-white hover:bg-teal-800">
          {t('projects.openChat')}
        </Link>
      </div>
      <ErrorText>{error}</ErrorText>

      <Card>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-500">{t('projects.status')}</dt>
            <dd>
              {canManage ? (
                <Select aria-label={t('projects.status')} value={project.status} onChange={(e) => run(() => api(`/projects/${id}`, { method: 'PATCH', body: { status: e.target.value as ProjectStatus } }))}>
                  {PROJECT_STATUSES.map((s) => <option key={s} value={s}>{t(`projects.status.${s}` as Key)}</option>)}
                </Select>
              ) : (
                t(`projects.status.${project.status}` as Key)
              )}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">{t('projects.manager')}</dt>
            <dd>{nameOf(project.managerId)}</dd>
          </div>
          {(project.startDate || project.endDate) && (
            <div>
              <dt className="text-slate-500">{t('projects.due')}</dt>
              <dd>{project.startDate ? formatDate(project.startDate, locale) : '…'} — {project.endDate ? formatDate(project.endDate, locale) : '…'}</dd>
            </div>
          )}
          {project.goal && (
            <div className="sm:col-span-2">
              <dt className="text-slate-500">{t('projects.goal')}</dt>
              <dd className="whitespace-pre-wrap">{project.goal}</dd>
            </div>
          )}
        </dl>
      </Card>

      <Card aria-label={t('projects.team')}>
        <h2 className="mb-2 font-medium">{t('projects.team')}</h2>
        <ul className="divide-y divide-slate-100" data-testid="team">
          {project.members.map((m) => (
            <li key={m.userId} className="flex min-h-14 flex-wrap items-center justify-between gap-2 py-2" data-testid="team-member">
              <div className="min-w-0">
                <div className="truncate font-medium">{m.fullName}</div>
                <div className="text-xs text-slate-500">{m.roleTitle ?? (m.userId === project.managerId ? t('projects.manager') : '')}</div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm">{m.allocation}%</span>
                {m.overloaded && <span role="note" className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800" data-testid="overload">⚠ {t('workload.warning', { n: m.totalLoad })}</span>}
                {canManage && m.userId !== project.managerId && m.userId !== project.curatorId && (
                  <button type="button" className="min-h-9 rounded px-2 text-sm text-red-700 hover:bg-red-50" onClick={() => confirm(t('projects.confirmRemove')) && run(() => api(`/projects/${id}/members/${m.userId}`, { method: 'DELETE' }))}>
                    {t('projects.removeMember')}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
        {canManage && <AddMember project={project} candidates={Object.values(people).filter((p) => p.isActive && !project.members.some((m) => m.userId === p.id))} onAdd={(userId, allocation) => run(() => api(`/projects/${id}/members/${userId}`, { method: 'PUT', body: { allocation } }))} />}
      </Card>

      <Card aria-label={t('projects.milestones')}>
        <h2 className="mb-2 font-medium">{t('projects.milestones')}</h2>
        {project.milestones.length === 0 && <p className="text-sm text-slate-500">{t('projects.noMilestones')}</p>}
        <ul className="divide-y divide-slate-100">
          {project.milestones.map((m) => (
            <li key={m.id} className="flex min-h-12 flex-wrap items-center justify-between gap-2 py-2" data-testid="milestone">
              <div>
                <span className={m.doneAt ? 'text-slate-500 line-through' : 'font-medium'}>{m.title}</span>
                <span className="ml-2 text-sm text-slate-600">{formatDate(m.dueDate, locale)}</span>
                {m.overdue && <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800" data-testid="milestone-overdue">{t('projects.overdue')}</span>}
              </div>
              {canManage && (
                <div className="flex gap-1">
                  <button type="button" className="min-h-9 rounded px-2 text-sm text-teal-800 hover:bg-slate-100" onClick={() => run(() => api(`/projects/${id}/milestones/${m.id}`, { method: 'PATCH', body: { done: !m.doneAt } }))}>
                    {m.doneAt ? t('projects.reopen') : t('projects.markDone')}
                  </button>
                  <button type="button" className="min-h-9 rounded px-2 text-sm text-red-700 hover:bg-red-50" onClick={() => confirm(t('confirmDelete')) && run(() => api(`/projects/${id}/milestones/${m.id}`, { method: 'DELETE' }))}>
                    {t('delete')}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
        {canManage && <AddMilestone onAdd={(title, dueDate) => run(() => api(`/projects/${id}/milestones`, { method: 'POST', body: { title, dueDate } }))} />}
      </Card>

      <Card aria-label={t('projects.tasks')}>
        <h2 className="mb-2 font-medium">{t('projects.tasks')}</h2>
        {tasks.length === 0 && <p className="text-sm text-slate-500">{t('projects.noTasks')}</p>}
        <ul className="divide-y divide-slate-100">
          {tasks.map((task) => (
            <li key={task.id} className="py-2 text-sm" data-testid="project-task">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className={task.status === 'DONE' ? 'text-slate-500 line-through' : 'font-medium'}>{task.title}</span>
                {task.overdue && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">{t('tasks.overdue')}</span>}
              </div>
              <div className="text-xs text-slate-600">
                {t('tasks.assignedTo', { name: nameOf(task.assigneeId) })} · {t(`tasks.status.${task.status}` as Key)}
                {task.dueDate ? ` · ${t('tasks.dueOn', { date: formatDate(task.dueDate, locale) })}` : ''}
              </div>
            </li>
          ))}
        </ul>
        <AddTask project={project} onAdd={(body) => run(() => api('/tasks', { method: 'POST', body: { ...body, projectId: id } }))} />
      </Card>
    </div>
  );
}

function AddMember({ candidates, onAdd }: { project: ProjectDto; candidates: { id: string; fullName: string }[]; onAdd: (userId: string, allocation: number) => void }) {
  const { t } = useI18n();
  const [userId, setUserId] = useState('');
  const [allocation, setAllocation] = useState(20);
  const sorted = useMemo(() => [...candidates].sort((a, b) => a.fullName.localeCompare(b.fullName)), [candidates]);
  return (
    <form
      className="mt-3 flex flex-wrap items-end gap-2"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (userId) {
          onAdd(userId, allocation);
          setUserId('');
        }
      }}
    >
      <div className="min-w-48 flex-1">
        <Field label={t('projects.addMember')}>
          <Select aria-label={t('projects.addMember')} value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">{t('projects.pickPerson')}</option>
            {sorted.map((c) => <option key={c.id} value={c.id}>{c.fullName}</option>)}
          </Select>
        </Field>
      </div>
      <input type="number" min={0} max={100} aria-label={t('projects.allocation')} value={allocation} onChange={(e) => setAllocation(Math.min(100, Math.max(0, Number(e.target.value) || 0)))} className="min-h-11 w-24 rounded-lg border border-slate-300 px-2 text-right" />
      <Button type="submit" variant="secondary" disabled={!userId}>{t('create')}</Button>
    </form>
  );
}

function AddMilestone({ onAdd }: { onAdd: (title: string, dueDate: string) => void }) {
  const { t } = useI18n();
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  return (
    <form
      className="mt-3 flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onAdd(title, due);
        setTitle('');
        setDue('');
      }}
    >
      <div className="min-w-48 flex-1">
        <Field label={t('projects.milestoneTitle')}>
          <Input required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} aria-label={t('projects.milestoneTitle')} />
        </Field>
      </div>
      <Input type="date" required aria-label={t('projects.due')} value={due} onChange={(e) => setDue(e.target.value)} className="w-44" />
      <Button type="submit" variant="secondary" disabled={!title.trim() || !due}>{t('projects.addMilestone')}</Button>
    </form>
  );
}

function AddTask({ project, onAdd }: { project: ProjectDto; onAdd: (body: { title: string; assigneeId: string; dueDate?: string }) => void }) {
  const { t } = useI18n();
  const [title, setTitle] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [due, setDue] = useState('');
  return (
    <form
      className="mt-3 space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!assigneeId) return;
        onAdd({ title, assigneeId, dueDate: due || undefined });
        setTitle('');
        setDue('');
      }}
    >
      <Field label={t('tasks.new')}>
        <Input required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} aria-label={t('tasks.new')} placeholder={t('tasks.titleLabel')} />
      </Field>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-48 flex-1">
          <Select aria-label={t('tasks.assignee')} value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
            <option value="">{t('tasks.assigneePick')}</option>
            {project.members.map((m) => <option key={m.userId} value={m.userId}>{m.fullName}</option>)}
          </Select>
        </div>
        <Input type="date" aria-label={t('tasks.due')} value={due} onChange={(e) => setDue(e.target.value)} className="w-44" />
        <Button type="submit" variant="secondary" disabled={!title.trim() || !assigneeId}>{t('create')}</Button>
      </div>
    </form>
  );
}
