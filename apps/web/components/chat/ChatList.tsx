'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import type { MessageDto } from '@hemcenter/shared';
import { SEARCH_MIN_LENGTH } from '@hemcenter/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useChats } from '@/lib/chats';
import { useI18n } from '@/lib/i18n';
import { chatTitle, formatListStamp, highlight, snippet } from '@/lib/chatUtils';
import { Input, useErrorText } from '../ui';
import { Avatar } from './Avatar';

interface Found {
  hits: MessageDto[];
  hasMore: boolean;
}

function Marked({ text, term }: { text: string; term: string }) {
  return (
    <>
      {highlight(text, term).map((m, i) =>
        m.hit ? (
          <mark key={i} className="rounded bg-yellow-200 px-0.5 text-inherit">
            {m.text}
          </mark>
        ) : (
          <span key={i}>{m.text}</span>
        ),
      )}
    </>
  );
}

export function ChatList() {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const { chats, loaded, nameOf } = useChats();
  const errorText = useErrorText();
  const pathname = usePathname();
  const meId = user!.id;

  const [q, setQ] = useState('');
  const [found, setFound] = useState<Found | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string>();
  const term = q.trim();
  const searchable = term.length >= SEARCH_MIN_LENGTH;

  // titles are resolved once, so filtering and rendering agree
  const titled = useMemo(() => chats.map((c) => ({ chat: c, title: chatTitle(c, meId, nameOf) })), [chats, meId, nameOf]);
  const visibleChats = term ? titled.filter((x) => x.title.toLowerCase().includes(term.toLowerCase())) : titled;

  // message search, after a short pause in typing
  useEffect(() => {
    setFound(null);
    setError(undefined);
    if (!searchable) return;
    setSearching(true);
    let alive = true;
    const id = setTimeout(() => {
      api<Found>(`/search/messages?q=${encodeURIComponent(term)}`)
        .then((r) => alive && setFound(r))
        .catch((e) => alive && setError(errorText(e)))
        .finally(() => alive && setSearching(false));
    }, 300);
    return () => {
      alive = false;
      clearTimeout(id);
    };
    // errorText only depends on the language
  }, [term, searchable]);

  async function more() {
    if (!found) return;
    try {
      const next = await api<Found>(`/search/messages?q=${encodeURIComponent(term)}&offset=${found.hits.length}`);
      setFound({ hits: [...found.hits, ...next.hits], hasMore: next.hasMore });
    } catch (e) {
      setError(errorText(e));
    }
  }

  const chatOf = (id: string) => titled.find((x) => x.chat.id === id);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 pb-3">
        <h1 className="text-xl font-semibold text-slate-900">{t('chats.title')}</h1>
        <Link href="/chats/new" className="inline-flex min-h-11 items-center rounded-lg bg-teal-700 px-4 text-sm font-medium text-white hover:bg-teal-800">
          {t('chats.new')}
        </Link>
      </div>

      <div className="relative pb-3">
        <Input type="search" aria-label={t('chats.search')} placeholder={t('chats.search')} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {loaded && chats.length === 0 && !term && <p className="py-8 text-center text-slate-500">{t('chats.empty')}</p>}
      {error && <p role="alert" className="mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
        {visibleChats.length > 0 && (
          <section aria-label={t('chats.searchChats')}>
            {term && <h2 className="mb-1 text-xs font-semibold uppercase text-slate-500">{t('chats.searchChats')}</h2>}
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
              {visibleChats.map(({ chat: c, title }) => {
                const last = c.lastMessage;
                const preview = !last ? t('chats.noMessages') : last.deleted ? t('chats.deletedMessage') : last.body || (last.attachments[0] ? `📎 ${last.attachments[0].name}` : '');
                const prefix = last && !last.deleted ? (last.authorId === meId ? `${t('chats.you')}: ` : c.type === 'GROUP' ? `${nameOf(last.authorId).split(' ')[0]}: ` : '') : '';
                const other = c.members.find((m) => m.userId !== meId);
                const active = pathname === `/chats/${c.id}`;
                return (
                  <li key={c.id}>
                    <Link href={`/chats/${c.id}`} data-testid="chat-item" className={`flex min-h-16 items-center gap-3 px-3 py-2 ${active ? 'bg-teal-50' : 'hover:bg-slate-50'}`}>
                      <Avatar id={c.type === 'DIRECT' ? other?.userId ?? c.id : c.id} name={title || '?'} size={44} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="truncate font-medium">{title}</span>
                          {c.lastMessageAt && <span className="shrink-0 text-xs text-slate-500">{formatListStamp(c.lastMessageAt, locale, t('chats.yesterday'))}</span>}
                        </span>
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm text-slate-600">
                            {prefix}
                            {preview}
                          </span>
                          {c.unreadCount > 0 && (
                            <span aria-label={`${c.unreadCount}`} className={`inline-flex min-w-6 shrink-0 items-center justify-center rounded-full px-1.5 text-xs font-semibold text-white ${c.notifyMode === 'ALL' ? 'bg-teal-700' : 'bg-slate-400'}`}>
                              {c.unreadCount > 99 ? '99+' : c.unreadCount}
                            </span>
                          )}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {term && !searchable && <p className="text-sm text-slate-500">{t('chats.searchTooShort')}</p>}

        {searchable && (
          <section aria-label={t('chats.searchMessages')} data-testid="search-results">
            <h2 className="mb-1 text-xs font-semibold uppercase text-slate-500">{t('chats.searchMessages')}</h2>
            {searching && !found && <p className="text-sm text-slate-500">{t('loading')}</p>}
            {found && found.hits.length === 0 && visibleChats.length === 0 && <p className="text-sm text-slate-500">{t('chats.searchEmpty')}</p>}
            {found && found.hits.length > 0 && (
              <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
                {found.hits.map((m) => {
                  const c = chatOf(m.chatId);
                  const text = m.body ?? '';
                  const fileHit = !text.toLowerCase().includes(term.toLowerCase()) ? m.attachments.find((a) => a.name.toLowerCase().includes(term.toLowerCase())) : undefined;
                  return (
                    <li key={m.id}>
                      <Link href={`/chats/${m.chatId}?m=${m.seq}`} data-testid="search-hit" className="block px-3 py-2 hover:bg-slate-50">
                        <span className="flex items-baseline justify-between gap-2 text-xs text-slate-500">
                          <span className="truncate font-medium text-teal-800">{c?.title ?? '…'}</span>
                          <span className="shrink-0">{formatListStamp(m.createdAt, locale, t('chats.yesterday'))}</span>
                        </span>
                        <span className="block truncate text-xs text-slate-500">{m.authorId === meId ? t('chats.you') : nameOf(m.authorId)}</span>
                        <span className="line-clamp-2 break-words text-sm">
                          {fileHit ? <>📎 <Marked text={fileHit.name} term={term} /></> : <Marked text={snippet(text, term)} term={term} />}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
            {found?.hasMore && (
              <button type="button" onClick={more} className="mt-2 min-h-10 w-full rounded-lg text-sm text-teal-800 hover:bg-slate-100">
                {t('chats.searchMore')}
              </button>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
