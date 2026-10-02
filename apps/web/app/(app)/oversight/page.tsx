'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { oversightTitle, type OversightChat } from '@/lib/oversight';
import { Card, ErrorText, Input, PageTitle, useErrorText } from '@/components/ui';

export default function OversightPage() {
  const { t, locale } = useI18n();
  const errorText = useErrorText();
  const [q, setQ] = useState('');
  const [chats, setChats] = useState<OversightChat[]>();
  const [error, setError] = useState<string>();

  // every search is a logged action on the server, so wait for a pause in typing
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(async () => {
      try {
        const list = await api<OversightChat[]>(`/oversight/chats${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`);
        if (alive) {
          setChats(list);
          setError(undefined);
        }
      } catch (e) {
        if (alive) setError(errorText(e));
      }
    }, 400);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const stamp = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(locale === 'kk' ? 'kk-KZ' : 'ru-RU') : '');

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <PageTitle>{t('oversight.title')}</PageTitle>
      <p role="note" data-testid="oversight-banner" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
        {t('oversight.banner')}
      </p>
      <Input type="search" aria-label={t('oversight.search')} placeholder={t('oversight.search')} value={q} onChange={(e) => setQ(e.target.value)} />
      <ErrorText>{error}</ErrorText>
      {chats && chats.length === 0 && <p className="py-6 text-center text-slate-500">{t('oversight.empty')}</p>}
      <Card className="p-0">
        <ul className="divide-y divide-slate-100">
          {chats?.map((c) => (
            <li key={c.id}>
              <Link href={`/oversight/${c.id}`} data-testid="oversight-item" className="flex min-h-14 items-center justify-between gap-3 px-4 py-2 hover:bg-slate-50">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{oversightTitle(c, t('oversight.untitled'))}</span>
                  <span className="block truncate text-xs text-slate-500">
                    {c.type === 'ARCHIVE' ? `${t('chats.archive')} · ` : ''}
                    {t('chats.membersCount', { n: c.members.length })}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-slate-500">{stamp(c.lastMessageAt)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
