'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { DocumentDto, DocumentKindDto } from '@hemcenter/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useChats } from '@/lib/chats';
import { useI18n } from '@/lib/i18n';
import { formatDate } from '@/lib/chatUtils';
import { kindName, STATUS_STYLE } from '@/lib/docs';
import type { Key } from '@/lib/dictionaries';
import { Card, PageTitle } from '@/components/ui';

export default function DocumentsPage() {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const { nameOf, ensurePeople } = useChats();
  const [docs, setDocs] = useState<DocumentDto[]>();
  const [kinds, setKinds] = useState<DocumentKindDto[]>([]);
  const [view, setView] = useState<'all' | 'mine' | 'awaiting'>('all');
  const seesAll = !!user?.roles.some((r) => r === 'SECRETARY' || r === 'ADMIN' || r === 'MANAGEMENT');
  const isSecretary = !!user?.roles.some((r) => r === 'SECRETARY' || r === 'ADMIN');
  const kindById = useMemo(() => new Map(kinds.map((k) => [k.id, k])), [kinds]);

  useEffect(() => {
    api<DocumentKindDto[]>('/document-kinds?all=1').then(setKinds, () => undefined);
  }, []);
  useEffect(() => {
    api<DocumentDto[]>(`/documents${view === 'mine' ? '?mine=1' : view === 'awaiting' ? '?awaiting=1' : ''}`).then((list) => {
      setDocs(list);
      ensurePeople(list.map((d) => d.authorId));
    }, () => setDocs([]));
  }, [view, ensurePeople]);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PageTitle>{t('docs.title')}</PageTitle>
        <div className="flex gap-2">
          {isSecretary && (
            <Link href="/documents/templates" className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium hover:bg-slate-50">
              {t('docs.templates')}
            </Link>
          )}
          <Link href="/documents/new" className="inline-flex min-h-11 items-center rounded-lg bg-teal-700 px-4 text-sm font-medium text-white hover:bg-teal-800">
            {t('docs.new')}
          </Link>
        </div>
      </div>
      <div role="group" className="flex flex-wrap gap-2 text-sm">
        {([['all', 'docs.all'], ...(seesAll ? [['mine', 'docs.mine']] : []), ['awaiting', 'docs.awaiting']] as const).map(([v, label]) => (
          <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v as typeof view)} className={`min-h-9 rounded-full px-3 ${view === v ? 'bg-teal-700 text-white' : 'bg-slate-100'}`}>
            {t(label as Key)}
          </button>
        ))}
      </div>
      {docs && docs.length === 0 && <p className="text-slate-500">{t('docs.empty')}</p>}
      <div className="space-y-3">
        {docs?.map((d) => {
          const kind = kindById.get(d.kindId);
          return (
            <Link key={d.id} href={`/documents/${d.id}`} className="block" data-testid="document-item">
              <Card className="hover:border-teal-600">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{d.title}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[d.status]}`}>{t(`docs.status.${d.status}` as Key)}</span>
                </div>
                <p className="mt-1 text-sm text-slate-600">
                  {kind ? kindName(kind, locale) : ''} · {d.registrationNumber ?? t('docs.noNumber')} · {formatDate(d.docDate, locale)} · {nameOf(d.authorId)}
                </p>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
