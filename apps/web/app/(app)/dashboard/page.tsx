'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { PROJECT_STATUSES, type DashboardDto } from '@hemcenter/shared';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { Key } from '@/lib/dictionaries';
import { Button, Card, ErrorText, PageTitle, useErrorText } from '@/components/ui';

function Tile({ label, value, bad, testId, href }: { label: string; value: number; bad?: boolean; testId: string; href?: string }) {
  const body = (
    <Card className={`h-full ${bad && value > 0 ? 'border-red-300 bg-red-50' : ''}`} data-testid={testId}>
      <div className={`text-3xl font-semibold ${bad && value > 0 ? 'text-red-700' : 'text-slate-900'}`} data-testid={`${testId}-value`}>{value}</div>
      <div className="mt-1 text-sm text-slate-600">{label}</div>
    </Card>
  );
  return href ? <Link href={href} className="block">{body}</Link> : body;
}

/** One screen for the head of the centre (TZ 3.10). */
export default function DashboardPage() {
  const { t, locale } = useI18n();
  const errorText = useErrorText();
  const [d, setD] = useState<DashboardDto>();
  const [error, setError] = useState<string>();

  const load = useCallback(() => api<DashboardDto>('/dashboard').then((x) => { setD(x); setError(undefined); }, (e) => setError(errorText(e))), [errorText]);
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!d) return <div className="space-y-4"><PageTitle>{t('dash.title')}</PageTitle><ErrorText>{error}</ErrorText>{!error && <p className="text-slate-500">{t('loading')}</p>}</div>;
  const nothingLate = d.assignments.overdue === 0 && d.tasks.overdue === 0 && d.projects.withOverdueMilestones.length === 0 && d.overloaded.length === 0 && d.decisionsWaiting.length === 0;
  const time = new Intl.DateTimeFormat(locale === 'kk' ? 'kk-KZ' : 'ru-RU', { timeStyle: 'short' }).format(new Date(d.generatedAt));

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PageTitle>{t('dash.title')}</PageTitle>
        <div className="flex items-center gap-3 text-sm text-slate-500">
          {t('dash.updated', { time })}
          <Button variant="secondary" onClick={() => void load()}>{t('dash.refresh')}</Button>
        </div>
      </div>
      <ErrorText>{error}</ErrorText>
      {nothingLate && <p role="status" className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800" data-testid="all-good">{t('dash.allGood')}</p>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile testId="tile-open" label={t('dash.assignmentsOpen')} value={d.assignments.open} href="/assignments" />
        <Tile testId="tile-overdue" label={t('dash.assignmentsOverdue')} value={d.assignments.overdue} bad href="/assignments" />
        <Tile testId="tile-review" label={t('dash.inReview')} value={d.assignments.inReview} />
        <Tile testId="tile-done" label={t('dash.done30')} value={d.assignments.doneLast30Days} />
        <Tile testId="tile-tasks" label={t('dash.tasksOverdue')} value={d.tasks.overdue} bad />
        <Tile testId="tile-docs-review" label={t('dash.docsInReview')} value={d.documents.inReview} href="/documents" />
        <Tile testId="tile-docs-month" label={t('dash.docsMonth')} value={d.documents.registeredThisMonth} />
      </div>

      <Card aria-label={t('dash.projects')} data-testid="projects-by-status">
        <h2 className="mb-2 font-medium">{t('dash.projects')}</h2>
        <ul className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
          {PROJECT_STATUSES.map((s) => (
            <li key={s} className="flex justify-between rounded-lg bg-slate-50 px-3 py-2"><span>{t(`projects.status.${s}` as Key)}</span><span className="font-semibold">{d.projects.byStatus[s]}</span></li>
          ))}
        </ul>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card aria-label={t('dash.projectsLate')} data-testid="late-projects">
          <h2 className="mb-2 font-medium">{t('dash.projectsLate')}</h2>
          {d.projects.withOverdueMilestones.length === 0 ? <p className="text-sm text-slate-500">—</p> : (
            <ul className="divide-y divide-slate-100 text-sm">
              {d.projects.withOverdueMilestones.map((p) => (
                <li key={p.id} className="flex justify-between py-1.5"><Link href={`/projects/${p.id}`} className="text-teal-800 underline">{p.name}</Link><span className="text-red-700">{t('dash.overdueStages', { n: p.overdue })}</span></li>
              ))}
            </ul>
          )}
        </Card>
        <Card aria-label={t('dash.overdueByPerson')} data-testid="late-people">
          <h2 className="mb-2 font-medium">{t('dash.overdueByPerson')}</h2>
          {d.assignments.overdueByPerson.length === 0 ? <p className="text-sm text-slate-500">—</p> : (
            <ul className="divide-y divide-slate-100 text-sm">
              {d.assignments.overdueByPerson.map((p) => <li key={p.userId} className="flex justify-between py-1.5"><span>{p.fullName}</span><span className="font-semibold text-red-700">{p.count}</span></li>)}
            </ul>
          )}
        </Card>
        <Card aria-label={t('dash.decisionsWaiting')} data-testid="waiting-decisions">
          <h2 className="mb-2 font-medium">{t('dash.decisionsWaiting')}</h2>
          {d.decisionsWaiting.length === 0 ? <p className="text-sm text-slate-500">—</p> : (
            <ul className="divide-y divide-slate-100 text-sm">
              {d.decisionsWaiting.map((x) => (
                <li key={x.id} className="py-1.5">
                  <Link href={`/chats/${x.chatId}`} className="text-teal-800 underline">{x.text}</Link>
                  <div className="text-xs text-slate-500">{t('dash.waitingFor', { n: x.waitingFor })} · {t('dash.age', { n: x.ageDays })}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card aria-label={t('dash.overloaded')} data-testid="overloaded">
          <h2 className="mb-2 font-medium">{t('dash.overloaded')}</h2>
          {d.overloaded.length === 0 ? <p className="text-sm text-slate-500">—</p> : (
            <ul className="divide-y divide-slate-100 text-sm">
              {d.overloaded.map((p) => <li key={p.userId} className="flex justify-between py-1.5"><Link href="/workload" className="text-teal-800 underline">{p.fullName}</Link><span className="font-semibold text-red-700">{p.total}%</span></li>)}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
