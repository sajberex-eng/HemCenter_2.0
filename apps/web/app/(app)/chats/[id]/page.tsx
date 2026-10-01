'use client';

import Link from 'next/link';
import { use, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { MESSAGES_PAGE_SIZE, type ChatDto, type MessageDto } from '@hemcenter/shared';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useChats } from '@/lib/chats';
import { useI18n } from '@/lib/i18n';
import { chatTitle, dayKey, formatDayLabel } from '@/lib/chatUtils';
import { Avatar } from '@/components/chat/Avatar';
import { ChatInfo } from '@/components/chat/ChatInfo';
import { Composer } from '@/components/chat/Composer';
import { MessageBubble, type ReadState } from '@/components/chat/MessageBubble';
import { ErrorText, useErrorText } from '@/components/ui';

interface Page {
  messages: MessageDto[];
  hasMore: boolean;
}

/** Inserts or replaces by id, keeping the list ordered by message number. */
function merge(list: MessageDto[], incoming: MessageDto[]): MessageDto[] {
  const byId = new Map(list.map((m) => [m.id, m]));
  incoming.forEach((m) => byId.set(m.id, m));
  return [...byId.values()].sort((a, b) => a.seq - b.seq);
}

export default function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const { chats, loaded, nameOf, ensurePeople, setActiveChat, markReadLocal, subscribe, connected } = useChats();
  const errorText = useErrorText();
  const meId = user!.id;

  const chat: ChatDto | undefined = chats.find((c) => c.id === id);
  const [messages, setMessages] = useState<MessageDto[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [ready, setReady] = useState(false);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [replyTo, setReplyTo] = useState<MessageDto | null>(null);
  const [editing, setEditing] = useState<MessageDto | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [unseen, setUnseen] = useState(false);

  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true); // follow new messages only while the reader is at the bottom
  const prependFrom = useRef<number | null>(null);

  // ---- loading ------------------------------------------------------------------------------------------------
  // A resync after reconnecting merges the newest page without throwing away older pages the reader loaded.
  const firstLoadDone = useRef(false);
  const loadLatest = useCallback(async () => {
    try {
      const page = await api<Page>(`/chats/${id}/messages?limit=${MESSAGES_PAGE_SIZE}`);
      setMessages((prev) => merge(prev, page.messages));
      if (!firstLoadDone.current) setHasMore(page.hasMore);
      firstLoadDone.current = true;
      setReady(true);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setMissing(true);
      else setError(errorText(e));
    }
    // only the conversation id should restart loading (errorText is recreated on every render)
  }, [id]);

  useEffect(() => {
    firstLoadDone.current = false;
    setMessages([]);
    setReady(false);
    setMissing(false);
    setReplyTo(null);
    setEditing(null);
    setInfoOpen(false);
    stick.current = true;
    void loadLatest();
  }, [id, loadLatest]);

  async function loadOlder() {
    const oldest = messages[0]?.seq;
    if (!oldest) return;
    const el = scroller.current;
    prependFrom.current = el ? el.scrollHeight : null;
    try {
      const page = await api<Page>(`/chats/${id}/messages?limit=${MESSAGES_PAGE_SIZE}&before=${oldest}`);
      setMessages((prev) => merge(prev, page.messages));
      setHasMore(page.hasMore);
    } catch (e) {
      setError(errorText(e));
    }
  }

  // ---- live updates -------------------------------------------------------------------------------------------
  useEffect(
    () =>
      subscribe((e) => {
        if (e.type === 'resync') void loadLatest();
        else if ((e.type === 'message:new' || e.type === 'message:updated' || e.type === 'message:deleted') && e.message.chatId === id) {
          setMessages((prev) => merge(prev, [e.message]));
          if (e.type === 'message:new' && e.message.authorId !== meId && !stick.current) setUnseen(true);
        }
      }),
    [subscribe, id, meId, loadLatest],
  );

  // authors of loaded messages may not be in the directory (people who left)
  useEffect(() => ensurePeople(messages.map((m) => m.authorId)), [messages, ensurePeople]);

  // ---- scrolling ----------------------------------------------------------------------------------------------
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (prependFrom.current !== null) {
      el.scrollTop += el.scrollHeight - prependFrom.current; // keep the reader's place after older messages appear
      prependFrom.current = null;
    } else if (stick.current || messages[messages.length - 1]?.authorId === meId) {
      el.scrollTop = el.scrollHeight;
      stick.current = true;
      setUnseen(false);
    }
  }, [messages, meId]);

  function onScroll() {
    const el = scroller.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (stick.current) setUnseen(false);
  }

  // ---- read marks ---------------------------------------------------------------------------------------------
  useEffect(() => {
    setActiveChat(id);
    return () => setActiveChat(null);
  }, [id, setActiveChat]);

  const lastSeq = messages[messages.length - 1]?.seq ?? 0;
  const myRead = chat?.members.find((m) => m.userId === meId)?.lastReadSeq ?? 0;
  const hasChat = !!chat;
  useEffect(() => {
    if (!hasChat || lastSeq === 0 || lastSeq <= myRead) return;
    const mark = () => {
      if (document.visibilityState !== 'visible') return;
      api(`/chats/${id}/read`, { method: 'POST', body: { seq: lastSeq } }).then(() => markReadLocal(id, lastSeq)).catch(() => undefined);
    };
    mark();
    document.addEventListener('visibilitychange', mark);
    window.addEventListener('focus', mark);
    return () => {
      document.removeEventListener('visibilitychange', mark);
      window.removeEventListener('focus', mark);
    };
  }, [id, lastSeq, myRead, hasChat, markReadLocal]);

  // ---- derived data -------------------------------------------------------------------------------------------
  const title = chat ? chatTitle(chat, meId, nameOf) : '';
  const isGroup = chat?.type === 'GROUP';
  const others = useMemo(() => chat?.members.filter((m) => m.userId !== meId) ?? [], [chat, meId]);
  const candidates = useMemo(() => others.map((m) => ({ id: m.userId, name: nameOf(m.userId) })), [others, nameOf]);
  const mentionNames = useMemo(() => chat?.members.map((m) => nameOf(m.userId)) ?? [], [chat, nameOf]);

  const readState = (m: MessageDto): ReadState => {
    if (!isGroup) return { kind: 'direct', read: others.some((o) => o.lastReadSeq >= m.seq) };
    return { kind: 'group', read: others.filter((o) => o.lastReadSeq >= m.seq).length, total: others.length };
  };

  // ---- actions ------------------------------------------------------------------------------------------------
  async function send(body: string, mentionIds: string[]): Promise<boolean> {
    setBusy(true);
    setError(undefined);
    try {
      if (editing) {
        const updated = await api<MessageDto>(`/chats/${id}/messages/${editing.id}`, { method: 'PATCH', body: { body, mentionIds } });
        setMessages((prev) => merge(prev, [updated]));
        setEditing(null);
      } else {
        const created = await api<MessageDto>(`/chats/${id}/messages`, { method: 'POST', body: { body, mentionIds, ...(replyTo ? { replyToId: replyTo.id } : {}) } });
        setMessages((prev) => merge(prev, [created]));
        setReplyTo(null);
      }
      return true;
    } catch (e) {
      setError(errorText(e));
      return false; // the draft stays in the box
    } finally {
      setBusy(false);
    }
  }

  async function remove(m: MessageDto) {
    if (!confirm(t('chats.confirmDeleteMessage'))) return;
    try {
      const deleted = await api<MessageDto>(`/chats/${id}/messages/${m.id}`, { method: 'DELETE' });
      setMessages((prev) => merge(prev, [deleted]));
    } catch (e) {
      setError(errorText(e));
    }
  }

  // ---- render -------------------------------------------------------------------------------------------------
  if (missing || (loaded && !chat && ready)) {
    return (
      <div className="p-6 text-center">
        <p className="mb-3 text-slate-600">{t('err.CHAT_NOT_FOUND')}</p>
        <Link href="/chats" className="text-teal-700 underline">
          {t('chats.back')}
        </Link>
      </div>
    );
  }

  const bannerFor = editing
    ? { label: t('chats.editing'), text: editing.body ?? '', onCancel: () => setEditing(null) }
    : replyTo
      ? { label: t('chats.replyingTo', { name: nameOf(replyTo.authorId) }), text: replyTo.body ?? '', onCancel: () => setReplyTo(null) }
      : undefined;

  let lastDay = '';
  return (
    <section className="flex h-dvh w-full flex-col bg-slate-50 md:h-full md:overflow-hidden md:rounded-xl md:border md:border-slate-200" aria-label={title}>
      <header className="safe-top flex items-center gap-2 border-b border-slate-200 bg-white px-2 py-2">
        <Link href="/chats" aria-label={t('chats.back')} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded text-2xl text-slate-600 hover:bg-slate-100 md:hidden">
          ‹
        </Link>
        <button type="button" onClick={() => setInfoOpen(true)} className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded px-1 text-left hover:bg-slate-50" aria-label={t('chats.info')}>
          <Avatar id={isGroup ? id : others[0]?.userId ?? id} name={title || '?'} />
          <span className="min-w-0">
            <span className="block truncate font-medium">{title}</span>
            {isGroup && chat && <span className="block text-xs text-slate-500">{t('chats.membersCount', { n: chat.members.length })}</span>}
          </span>
        </button>
      </header>

      {!connected && (
        <div role="status" className="bg-amber-100 px-3 py-1 text-center text-xs text-amber-900">
          {t('chats.connecting')}
        </div>
      )}

      <div ref={scroller} onScroll={onScroll} className="relative min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3" data-testid="messages">
        {hasMore && (
          <div className="text-center">
            <button type="button" onClick={loadOlder} className="min-h-9 rounded-full bg-white px-4 text-xs text-teal-800 shadow-sm hover:bg-slate-100">
              {t('chats.loadOlder')}
            </button>
          </div>
        )}
        {ready && messages.length === 0 && <p className="py-8 text-center text-sm text-slate-500">{t('chats.noMessages')}</p>}
        {messages.map((m) => {
          const k = dayKey(m.createdAt);
          const separator = k !== lastDay;
          lastDay = k;
          return (
            <div key={m.id} className="space-y-2">
              {separator && (
                <div className="py-1 text-center">
                  <span className="rounded-full bg-white/80 px-3 py-0.5 text-xs text-slate-500 shadow-sm">{formatDayLabel(m.createdAt, locale, t('chats.today'), t('chats.yesterday'))}</span>
                </div>
              )}
              <MessageBubble
                message={m}
                mine={m.authorId === meId}
                authorName={isGroup ? nameOf(m.authorId) : undefined}
                mentionNames={mentionNames}
                replyAuthorName={m.replyTo ? nameOf(m.replyTo.authorId) : undefined}
                readState={readState(m)}
                onReply={() => { setEditing(null); setReplyTo(m); }}
                onEdit={() => { setReplyTo(null); setEditing(m); }}
                onDelete={() => remove(m)}
              />
            </div>
          );
        })}
      </div>

      {unseen && (
        <button
          type="button"
          onClick={() => {
            const el = scroller.current;
            if (el) el.scrollTop = el.scrollHeight;
          }}
          className="mx-auto -mt-10 mb-2 min-h-9 rounded-full bg-teal-700 px-4 text-xs text-white shadow-lg"
        >
          {t('chats.newMessages')} ↓
        </button>
      )}

      {error && (
        <div className="px-3 pb-1">
          <ErrorText>{error}</ErrorText>
        </div>
      )}

      <Composer
        candidates={candidates}
        banner={bannerFor}
        initialText={editing?.body ?? undefined}
        editKey={editing?.id}
        busy={busy}
        onSend={send}
      />

      {infoOpen && chat && <ChatInfo chat={chat} title={title} onClose={() => setInfoOpen(false)} />}
    </section>
  );
}
