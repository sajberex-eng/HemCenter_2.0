'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { AssignmentDto, TaskDto } from '@hemcenter/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAwaitingDocs } from '@/lib/awaiting';
import { useChats } from '@/lib/chats';
import { useI18n } from '@/lib/i18n';
import { Card, PageTitle, PatientDataWarning } from '@/components/ui';

function Tile({ href, label, count, hint, testId }: { href: string; label: string; count: number; hint?: string; testId: string }) {
  return (
    <Link href={href} className="block" data-testid={testId}>
      <Card className="h-full hover:border-teal-600">
        <div className="text-3xl font-semibold" data-testid={`${testId}-count`}>{count}</div>
        <div className="mt-1 text-sm font-medium">{label}</div>
        {hint && <div className="text-xs text-slate-500">{hint}</div>}
      </Card>
    </Link>
  );
}

export default function Home() {
  const { user } = useAuth();
  const { t } = useI18n();
  const { totalUnread } = useChats();
  const awaitingDocs = useAwaitingDocs();
  const [assignments, setAssignments] = useState(0);
  const [late, setLate] = useState(0);
  const [tasks, setTasks] = useState(0);

  useEffect(() => {
    api<AssignmentDto[]>('/assignments?scope=mine&state=open').then((l) => { setAssignments(l.length); setLate(l.filter((a) => a.overdue).length); }, () => undefined);
    api<TaskDto[]>('/tasks?mine=1&status=open').then((l) => setTasks(l.length), () => undefined);
  }, []);

  return (
    <div className="space-y-4">
      <PageTitle>{t('home.greeting', { name: user?.fullName ?? '' })}</PageTitle>
      <PatientDataWarning />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile testId="home-assignments" href="/assignments" label={t('home.assignments')} count={assignments} hint={late > 0 ? `${t('asg.overdue')}: ${late}` : t('home.open', { n: assignments })} />
        <Tile testId="home-tasks" href="/tasks" label={t('home.tasks')} count={tasks} />
        <Tile testId="home-docs" href="/documents" label={t('home.documents')} count={awaitingDocs} />
        <Tile testId="home-chats" href="/chats" label={t('home.chats')} count={totalUnread} />
      </div>
    </div>
  );
}
