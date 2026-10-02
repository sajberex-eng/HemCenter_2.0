'use client';

import Link from 'next/link';
import { use, useEffect, useMemo, useState } from 'react';
import type { MessageDto } from '@hemcenter/shared';
import { api } from '@/lib/api';
import { AttachmentBaseProvider } from '@/lib/attachmentBase';
import { useI18n } from '@/lib/i18n';
import { dayKey, formatDayLabel } from '@/lib/chatUtils';
import { MessageBubble } from '@/components/chat/MessageBubble';
import { ErrorText, useErrorText } from '@/components/ui';
import { oversightTitle } from '@/lib/oversight';

interface OversightDetail {
  id: string;
  type: 'DIRECT' | 'GROUP' | 'ARCHIVE';
  title: string | null;
  lastSeq: number;
  members: { userId: string; fullName: string }[];
}
interface Page {
  messages: MessageDto[];
  hasMore: boolean;
}

const noop = () => undefined;

export default function OversightChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t, locale } = useI18n();
  const errorText = useErrorText();
  const [chat, setChat] = useState<OversightDetail>();
  const [messages, setMessages] = useState<MessageDto[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string>();

  // opening the chat is one logged action, then the newest page is read
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const c = await api<OversightDetail>(`/oversight/chats/${id}`);
        const page = await api<Page>(`/oversight/chats/${id}/messages`);
        if (!alive) return;
        setChat(c);
        setMessages(page.messages);
        setHasMore(page.hasMore);
      } catch (e) {
        if (alive) setError(errorText(e));
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function loadOlder() {
    try {
      const page = await api<Page>(`/oversight/chats/${id}/messages?before=${messages[0].seq}`);
      setMessages((prev) => [...page.messages, ...prev]);
      setHasMore(page.hasMore);
    } catch (e) {
      setError(errorText(e));
    }
  }

  const names = useMemo(() => new Map(chat?.members.map((m) => [m.userId, m.fullName]) ?? []), [chat]);
  const nameOf = (uid: string) => names.get(uid) ?? '…';
  const mentionNames = useMemo(() => [...names.values()], [names]);
  const title = chat ? oversightTitle(chat, t('oversight.untitled')) : '';

  let lastDay = '';
  return (
    <AttachmentBaseProvider value="/oversight/attachments">
      <section className="mx-auto flex h-dvh max-w-3xl flex-col bg-slate-50 md:h-[calc(100dvh-2rem)] md:overflow-hidden md:rounded-xl md:border md:border-slate-200" aria-label={title}>
        <header className="safe-top flex items-center gap-2 border-b border-slate-200 bg-white px-2 py-2">
          <Link href="/oversight" aria-label={t('oversight.back')} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded text-2xl text-slate-600 hover:bg-slate-100">
            ‹
          </Link>
          <div className="min-w-0">
            <div className="truncate font-medium">{title}</div>
            {chat && <div className="text-xs text-slate-500">{chat.members.map((m) => m.fullName).join(', ')}</div>}
          </div>
        </header>
        <p role="note" data-testid="oversight-banner" className="bg-amber-50 px-3 py-1 text-center text-xs text-amber-900">
          {t('oversight.banner')}
        </p>
        <ErrorText>{error}</ErrorText>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3" data-testid="messages">
          {hasMore && (
            <div className="text-center">
              <button type="button" onClick={loadOlder} className="min-h-9 rounded-full bg-white px-4 text-xs text-teal-800 shadow-sm hover:bg-slate-100">
                {t('chats.loadOlder')}
              </button>
            </div>
          )}
          {messages.map((m) => {
            const k = dayKey(m.createdAt);
            const separator = k !== lastDay;
            lastDay = k;
            return (
              <div key={m.id} className="space-y-2">
                {separator && <div className="py-1 text-center text-xs text-slate-500">{formatDayLabel(m.createdAt, locale, t('chats.today'), t('chats.yesterday'))}</div>}
                <MessageBubble
                  message={m}
                  mine={false}
                  authorName={nameOf(m.authorId)}
                  mentionNames={mentionNames}
                  replyAuthorName={m.replyTo ? nameOf(m.replyTo.authorId) : undefined}
                  readOnly
                  onReply={noop}
                  onEdit={noop}
                  onDelete={noop}
                />
              </div>
            );
          })}
        </div>
        <p role="note" className="safe-bottom border-t border-slate-200 bg-slate-100 px-3 py-3 text-center text-sm text-slate-600">
          {t('oversight.readOnly')}
        </p>
      </section>
    </AttachmentBaseProvider>
  );
}
