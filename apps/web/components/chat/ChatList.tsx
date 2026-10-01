'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useChats } from '@/lib/chats';
import { useI18n } from '@/lib/i18n';
import { chatTitle, formatListStamp } from '@/lib/chatUtils';
import { Avatar } from './Avatar';

export function ChatList() {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const { chats, loaded, nameOf } = useChats();
  const pathname = usePathname();
  const meId = user!.id;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 pb-3">
        <h1 className="text-xl font-semibold text-slate-900">{t('chats.title')}</h1>
        <Link href="/chats/new" className="inline-flex min-h-11 items-center rounded-lg bg-teal-700 px-4 text-sm font-medium text-white hover:bg-teal-800">
          {t('chats.new')}
        </Link>
      </div>

      {loaded && chats.length === 0 && <p className="py-8 text-center text-slate-500">{t('chats.empty')}</p>}

      <ul className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200 bg-white">
        {chats.map((c) => {
          const title = chatTitle(c, meId, nameOf);
          const last = c.lastMessage;
          const preview = !last ? t('chats.noMessages') : last.deleted ? t('chats.deletedMessage') : last.body ?? '';
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
    </div>
  );
}
