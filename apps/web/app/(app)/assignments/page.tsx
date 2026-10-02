'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { AssignmentDto } from '@hemcenter/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useChats } from '@/lib/chats';
import { useI18n } from '@/lib/i18n';
import { formatDate } from '@/lib/chatUtils';
import { canGiveAssignments, isOverseer, STATUS_STYLE } from '@/lib/assignments';
import type { Key } from '@/lib/dictionaries';
import { Card, PageTitle } from '@/components/ui';

type Scope = 'mine' | 'control' | 'all' | 'summary';
type State = 'open' | 'overdue' | 'review' | 'done';

export function AssignmentRow({ a }: { a: AssignmentDto }) {
  const { t, locale } = useI18n();
  const { nameOf } = useChats();
  return (
    <Link href={`/assignments/${a.id}`} className="block" data-testid="assignment-item">
      <Card className="hover:border-teal-600">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-medium">{a.text}</span>
          <span className="flex items-center gap-2">
            {a.overdue && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">{t('asg.overdue')}</span>}
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[a.status]}`}>{t(`asg.status.${a.status}` as Key)}</span>
          </span>
        </div>
        <p className="mt-1 text-sm text-slate-600">{nameOf(a.responsibleId)} · {t('asg.due')}: {formatDate(a.dueDate, locale)}</p>
      </Card>
    </Link>
  );
}

export default function AssignmentsPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const { ensurePeople, nameOf } = useChats();
  const [scope, setScope] = useState<Scope>('mine');
  const [state, setState] = useState<State>('open');
  const [list, setList] = useState<AssignmentDto[]>();
  const [summary, setSummary] = useState<{ overdue: AssignmentDto[]; byPerson: { userId: string; count: number }[] }>();
  const overseer = isOverseer(user?.roles);

  useEffect(() => {
    setList(undefined);
    if (scope === 'summary') {
      api<{ overdue: AssignmentDto[]; byPerson: { userId: string; count: number }[] }>('/assignments/summary').then((s) => {
        setSummary(s);
        ensurePeople([...s.overdue.map((a) => a.responsibleId), ...s.byPerson.map((p) => p.userId)]);
      }, () => undefined);
      return;
    }
    api<AssignmentDto[]>(`/assignments?scope=${scope}&state=${state}`).then((l) => {
      setList(l);
      ensurePeople(l.flatMap((a) => [a.responsibleId, a.controllerId]));
    }, () => setList([]));
  }, [scope, state, ensurePeople]);

  const scopes: [Scope, Key][] = [['mine', 'asg.scope.mine'], ['control', 'asg.scope.control'], ...(overseer ? ([['all', 'asg.scope.all'], ['summary', 'asg.scope.summary']] as [Scope, Key][]) : [])];
  const states: [State, Key][] = [['open', 'asg.state.open'], ['overdue', 'asg.state.overdue'], ['review', 'asg.state.review'], ['done', 'asg.state.done']];
  const pill = (active: boolean) => `min-h-9 rounded-full px-3 text-sm ${active ? 'bg-teal-700 text-white' : 'bg-slate-100'}`;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PageTitle>{t('asg.title')}</PageTitle>
        {canGiveAssignments(user?.roles) && (
          <Link href="/assignments/new" className="inline-flex min-h-11 items-center rounded-lg bg-teal-700 px-4 text-sm font-medium text-white hover:bg-teal-800">{t('asg.new')}</Link>
        )}
      </div>
      <div role="group" className="flex flex-wrap gap-2">
        {scopes.map(([s, label]) => <button key={s} type="button" aria-pressed={scope === s} onClick={() => setScope(s)} className={pill(scope === s)}>{t(label)}</button>)}
      </div>
      {scope !== 'summary' && (
        <div role="group" className="flex flex-wrap gap-2">
          {states.map(([s, label]) => <button key={s} type="button" aria-pressed={state === s} onClick={() => setState(s)} className={pill(state === s)}>{t(label)}</button>)}
        </div>
      )}

      {scope === 'summary' ? (
        <div className="space-y-3" data-testid="summary">
          {summary && summary.overdue.length === 0 && <p className="text-slate-500">{t('asg.noOverdue')}</p>}
          {summary && summary.byPerson.length > 0 && (
            <Card>
              <h2 className="mb-1 font-medium">{t('asg.byPerson')}</h2>
              <ul className="text-sm">
                {summary.byPerson.map((p) => <li key={p.userId} className="flex justify-between py-0.5" data-testid="by-person"><span>{nameOf(p.userId)}</span><span className="font-medium text-red-700">{p.count}</span></li>)}
              </ul>
            </Card>
          )}
          {summary?.overdue.map((a) => <AssignmentRow key={a.id} a={a} />)}
        </div>
      ) : (
        <>
          {list && list.length === 0 && <p className="text-slate-500">{t('asg.empty')}</p>}
          <div className="space-y-3">{list?.map((a) => <AssignmentRow key={a.id} a={a} />)}</div>
        </>
      )}
    </div>
  );
}
