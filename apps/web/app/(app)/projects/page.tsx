'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { ProjectDto } from '@hemcenter/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useChats } from '@/lib/chats';
import { useI18n } from '@/lib/i18n';
import { canCreateProjects } from '@/lib/work';
import type { Key } from '@/lib/dictionaries';
import { Button, Card, ErrorText, Field, Input, PageTitle, useErrorText } from '@/components/ui';

export const STATUS_STYLE: Record<string, string> = {
  PLANNED: 'bg-slate-100 text-slate-700',
  ACTIVE: 'bg-teal-100 text-teal-800',
  ON_HOLD: 'bg-amber-100 text-amber-900',
  DONE: 'bg-green-100 text-green-800',
};

export default function ProjectsPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const { nameOf, ensurePeople } = useChats();
  const [projects, setProjects] = useState<ProjectDto[]>();
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api<ProjectDto[]>('/projects').then((list) => {
      setProjects(list);
      ensurePeople(list.map((p) => p.managerId));
    }, () => setProjects([]));
  }, [ensurePeople]);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between gap-2">
        <PageTitle>{t('projects.title')}</PageTitle>
        {canCreateProjects(user) && !creating && <Button onClick={() => setCreating(true)}>{t('projects.new')}</Button>}
      </div>
      {creating && <NewProject onCancel={() => setCreating(false)} />}
      {projects && projects.length === 0 && !creating && <p className="text-slate-500">{t('projects.empty')}</p>}
      <div className="space-y-3">
        {projects?.map((p) => {
          const late = p.milestones.filter((m) => m.overdue).length;
          const overloaded = p.members.filter((m) => m.overloaded).length;
          return (
            <Link key={p.id} href={`/projects/${p.id}`} className="block" data-testid="project-item">
              <Card className="hover:border-teal-600">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{p.name}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[p.status]}`}>{t(`projects.status.${p.status}` as Key)}</span>
                </div>
                <p className="mt-1 text-sm text-slate-600">
                  {t('projects.manager')}: {nameOf(p.managerId)} · {t('projects.membersCount', { n: p.members.length })}
                </p>
                {(late > 0 || overloaded > 0) && (
                  <p className="mt-1 text-sm font-medium text-red-700">
                    {late > 0 && <span className="mr-3">{t('projects.overdueCount', { n: late })}</span>}
                    {overloaded > 0 && <span>⚠ {t('workload.title')}: {overloaded}</span>}
                  </p>
                )}
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function NewProject({ onCancel }: { onCancel: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const { user } = useAuth();
  const { people } = useChats();
  const errorText = useErrorText();
  const [form, setForm] = useState({ name: '', goal: '', startDate: '', endDate: '' });
  const [team, setTeam] = useState<Record<string, number>>({});
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const colleagues = useMemo(() => Object.values(people).filter((p) => p.isActive && p.id !== user?.id).sort((a, b) => a.fullName.localeCompare(b.fullName)), [people, user?.id]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const created = await api<ProjectDto>('/projects', {
        method: 'POST',
        body: {
          name: form.name,
          goal: form.goal || undefined,
          startDate: form.startDate || undefined,
          endDate: form.endDate || undefined,
          members: Object.entries(team).map(([userId, allocation]) => ({ userId, allocation })),
        },
      });
      router.push(`/projects/${created.id}`);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <Card>
      <form onSubmit={submit} className="space-y-3">
        <h2 className="font-medium">{t('projects.new')}</h2>
        <ErrorText>{error}</ErrorText>
        <Field label={t('projects.name')}>
          <Input required maxLength={200} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label={t('projects.goal')}>
          <textarea rows={2} maxLength={4000} aria-label={t('projects.goal')} value={form.goal} onChange={(e) => setForm({ ...form, goal: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('projects.start')}>
            <Input type="date" aria-label={t('projects.start')} value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
          </Field>
          <Field label={t('projects.end')}>
            <Input type="date" aria-label={t('projects.end')} value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
          </Field>
        </div>
        <fieldset>
          <legend className="mb-1 text-sm font-medium">{t('projects.team')}</legend>
          <ul className="max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
            {colleagues.map((c) => (
              <li key={c.id} className="flex min-h-12 items-center gap-3 px-3">
                <label className="flex flex-1 items-center gap-3">
                  <input
                    type="checkbox"
                    className="h-5 w-5"
                    checked={c.id in team}
                    onChange={(e) => setTeam((prev) => { const next = { ...prev }; if (e.target.checked) next[c.id] = 20; else delete next[c.id]; return next; })}
                  />
                  <span>{c.fullName}</span>
                </label>
                {c.id in team && (
                  <input
                    type="number"
                    min={0}
                    max={100}
                    aria-label={`${t('projects.allocation')}: ${c.fullName}`}
                    value={team[c.id]}
                    onChange={(e) => setTeam({ ...team, [c.id]: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })}
                    className="w-20 rounded-lg border border-slate-300 px-2 py-1 text-right"
                  />
                )}
              </li>
            ))}
          </ul>
        </fieldset>
        {/* stays in view above the phone's bottom bar, however long the list of colleagues is */}
        <div className="sticky bottom-16 -mx-4 flex gap-2 border-t border-slate-100 bg-white px-4 py-2 md:bottom-0">
          <Button type="submit" disabled={busy || !form.name.trim()}>{t('create')}</Button>
          <Button type="button" variant="secondary" onClick={onCancel}>{t('cancel')}</Button>
        </div>
      </form>
    </Card>
  );
}
