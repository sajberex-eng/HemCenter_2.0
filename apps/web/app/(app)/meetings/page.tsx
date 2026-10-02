'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { MeetingDto } from '@hemcenter/shared';
import { api } from '@/lib/api';
import { useChats } from '@/lib/chats';
import { useI18n } from '@/lib/i18n';
import type { Key } from '@/lib/dictionaries';
import { Card, PageTitle } from '@/components/ui';

export const formatWhen = (iso: string, locale: string) => new Intl.DateTimeFormat(locale === 'kk' ? 'kk-KZ' : 'ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));

export default function MeetingsPage() {
  const { t, locale } = useI18n();
  const { nameOf, ensurePeople } = useChats();
  const [list, setList] = useState<MeetingDto[]>();

  useEffect(() => {
    api<MeetingDto[]>('/meetings').then((l) => {
      setList(l);
      ensurePeople(l.map((m) => m.chairId));
    }, () => setList([]));
  }, [ensurePeople]);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between gap-2">
        <PageTitle>{t('meet.title')}</PageTitle>
        <Link href="/meetings/new" className="inline-flex min-h-11 items-center rounded-lg bg-teal-700 px-4 text-sm font-medium text-white hover:bg-teal-800">{t('meet.new')}</Link>
      </div>
      {list && list.length === 0 && <p className="text-slate-500">{t('meet.empty')}</p>}
      <div className="space-y-3">
        {list?.map((m) => (
          <Link key={m.id} href={`/meetings/${m.id}`} className="block" data-testid="meeting-item">
            <Card className="hover:border-teal-600">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{m.subject}</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">{t(`meet.status.${m.status}` as Key)}</span>
              </div>
              <p className="mt-1 text-sm text-slate-600">{formatWhen(m.startsAt, locale)}{m.place ? ` · ${m.place}` : ''} · {t('meet.chair')}: {nameOf(m.chairId)}</p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
