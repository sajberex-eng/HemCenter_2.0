'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, use, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  /** True when newer messages exist beyond what was returned (a window around a search hit). */
  hasNewer?: boolean;
}

/** Inserts or replaces by id, keeping the list ordered by message number. */
function merge(list: MessageDto[], incoming: MessageDto[]): MessageDto[] {
  const byId = new Map(list.map((m) => [m.id, m]));
  incoming.forEach((m) => byId.set(m.id, m));
  return [...byId.values()].sort((a, b) => a.seq - b.seq);
}

/**
 * Applies an edited or deleted message, and refreshes quotes of it inside replies: a reply keeps a copy of the
 * quoted text, which must not outlive a deletion on pages that are already open.
 */
function applyChange(list: MessageDto[], changed: MessageDto): MessageDto[] {
  return merge(list, [changed]).map((m) =>
    m.replyTo?.id === changed.id ? { ...m, replyTo: { ...m.replyTo, body: changed.deleted ? null : changed.body } } : m,
  );
}

export default function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  // useSearchParams needs a Suspense boundary
  return (
    <Suspense fallback={null}>
      <Conversation params={params} />
    </Suspense>
  );
}

function Conversation({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const jumpParam = useSearchParams().get('m');
  const jump = jumpParam && /^\d+$/.test(jumpParam) ? Number(jumpParam) : null;
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
  const [hasNewer, setHasNewer] = useState(false);
  const [highlightSeq, setHighlightSeq] = useState<number | null>(null);
  const [pins, setPins] = useState<MessageDto[]>([]);
  const [pinIndex, setPinIndex] = useState(0);

  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true); // follow new messages only while the reader is at the bottom
  const prependFrom = useRef<number | null>(null);
  const pendingJump = useRef<number | null>(null); // scroll to this message number once it is rendered

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

  /** Opens the conversation at a search hit: a window of messages around it instead of the newest ones. */
  const loadAround = useCallback(
    async (seq: number) => {
      try {
        const page = await api<Page>(`/chats/${id}/messages?around=${seq}`);
        setMessages(page.messages);
        setHasMore(page.hasMore);
        setHasNewer(!!page.hasNewer);
        pendingJump.current = seq;
        firstLoadDone.current = true;
        setReady(true);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) setMissing(true);
        else setError(errorText(e));
      }
    },
    [id],
  );

  const loadPins = useCallback(() => {
    api<MessageDto[]>(`/chats/${id}/pins`).then((list) => { setPins(list); setPinIndex(0); }).catch(() => undefined);
  }, [id]);

  useEffect(() => {
    firstLoadDone.current = false;
    setMessages([]);
    setReady(false);
    setMissing(false);
    setReplyTo(null);
    setEditing(null);
    setInfoOpen(false);
    setHasNewer(false);
    setHighlightSeq(null);
    stick.current = jump === null;
    if (jump !== null) void loadAround(jump);
    else void loadLatest();
  }, [id, jump, loadLatest, loadAround]);

  useEffect(() => {
    setPins([]);
    loadPins();
  }, [id, loadPins]);

  /** Back from a search hit to the end of the conversation. */
  function goLatest() {
    if (jump !== null) router.replace(`/chats/${id}`);
    else {
      setHasNewer(false);
      setMessages([]);
      firstLoadDone.current = false;
      stick.current = true;
      void loadLatest();
    }
  }

  async function loadNewer() {
    const newest = messages[messages.length - 1]?.seq;
    if (!newest) return;
    try {
      const page = await api<Page>(`/chats/${id}/messages?limit=${MESSAGES_PAGE_SIZE}&after=${newest}`);
      setMessages((prev) => merge(prev, page.messages));
      setHasNewer(!!page.hasNewer);
    } catch (e) {
      setError(errorText(e));
    }
  }

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
        if (e.type === 'resync') {
          if (!hasNewer) void loadLatest(); // inside a window around a hit, merging the newest page would leave a gap
          loadPins();
        } else if (e.type === 'chat:pins' && e.chatId === id) loadPins();
        else if ((e.type === 'message:new' || e.type === 'message:updated' || e.type === 'message:deleted') && e.message.chatId === id) {
          // new messages are not appended while the reader is in the middle of history: "to the latest" brings them
          if (e.type === 'message:new' && hasNewer) return;
          setMessages((prev) => (e.type === 'message:new' ? merge(prev, [e.message]) : applyChange(prev, e.message)));
          if (e.type === 'message:new' && e.message.authorId !== meId && !stick.current) setUnseen(true);
        }
      }),
    [subscribe, id, meId, loadLatest, loadPins, hasNewer],
  );

  // authors of loaded messages may not be in the directory (people who left)
  useEffect(() => ensurePeople(messages.map((m) => m.authorId)), [messages, ensurePeople]);

  // ---- scrolling ----------------------------------------------------------------------------------------------
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (pendingJump.current !== null) {
      const target = el.querySelector<HTMLElement>(`[data-seq="${pendingJump.current}"]`);
      if (target) {
        target.scrollIntoView({ block: 'center' });
        setHighlightSeq(pendingJump.current);
        pendingJump.current = null;
      }
    } else if (prependFrom.current !== null) {
      el.scrollTop += el.scrollHeight - prependFrom.current; // keep the reader's place after older messages appear
      prependFrom.current = null;
    } else if (stick.current || messages[messages.length - 1]?.authorId === meId) {
      el.scrollTop = el.scrollHeight;
      stick.current = true;
      setUnseen(false);
    }
  }, [messages, meId]);

  // the emphasis around a message fades after a moment
  useEffect(() => {
    if (highlightSeq === null) return;
    const t = setTimeout(() => setHighlightSeq(null), 2500);
    return () => clearTimeout(t);
  }, [highlightSeq]);

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
  const isGroup = chat?.type === 'GROUP' || chat?.type === 'ARCHIVE'; // archives show who wrote each message
  const readOnly = chat?.type === 'ARCHIVE';
  const others = useMemo(() => chat?.members.filter((m) => m.userId !== meId) ?? [], [chat, meId]);
  const candidates = useMemo(() => others.map((m) => ({ id: m.userId, name: nameOf(m.userId) })), [others, nameOf]);
  const mentionNames = useMemo(() => chat?.members.map((m) => nameOf(m.userId)) ?? [], [chat, nameOf]);

  const readState = (m: MessageDto): ReadState => {
    if (!isGroup) return { kind: 'direct', read: others.some((o) => o.lastReadSeq >= m.seq) };
    return { kind: 'group', read: others.filter((o) => o.lastReadSeq >= m.seq).length, total: others.length };
  };

  // ---- actions ------------------------------------------------------------------------------------------------
  async function send(body: string, mentionIds: string[], attachmentIds: string[]): Promise<boolean> {
    setBusy(true);
    setError(undefined);
    try {
      if (editing) {
        const updated = await api<MessageDto>(`/chats/${id}/messages/${editing.id}`, { method: 'PATCH', body: { body, mentionIds } });
        setMessages((prev) => applyChange(prev, updated));
        setEditing(null);
      } else {
        if (hasNewer) goLatest(); // writing from the middle of history: show the conversation's end first
        const created = await api<MessageDto>(`/chats/${id}/messages`, { method: 'POST', body: { body, mentionIds, ...(attachmentIds.length ? { attachmentIds } : {}), ...(replyTo ? { replyToId: replyTo.id } : {}) } });
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

  const iAmOwner = chat?.members.find((m) => m.userId === meId)?.role === 'OWNER';
  const canPin = chat?.type === 'DIRECT' || iAmOwner;
  const isPinned = (m: MessageDto) => pins.some((p) => p.id === m.id);

  async function togglePin(m: MessageDto) {
    setError(undefined);
    try {
      if (isPinned(m)) {
        await api(`/chats/${id}/pins/${m.id}`, { method: 'DELETE' });
        loadPins();
      } else {
        setPins(await api<MessageDto[]>(`/chats/${id}/pins`, { method: 'POST', body: { messageId: m.id } }));
        setPinIndex(0);
      }
    } catch (e) {
      setError(errorText(e));
    }
  }

  /** Scrolls to a message that is already on the page, otherwise opens the conversation around it. */
  function jumpTo(m: MessageDto) {
    const el = scroller.current?.querySelector<HTMLElement>(`[data-seq="${m.seq}"]`);
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setHighlightSeq(m.seq);
    } else {
      router.push(`/chats/${id}?m=${m.seq}`);
    }
  }

  async function remove(m: MessageDto) {
    if (!confirm(t('chats.confirmDeleteMessage'))) return;
    try {
      const deleted = await api<MessageDto>(`/chats/${id}/messages/${m.id}`, { method: 'DELETE' });
      setMessages((prev) => applyChange(prev, deleted));
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
            {isGroup && chat && (
              <span className="block text-xs text-slate-500">
                {readOnly ? `${t('chats.archive')} · ` : ''}
                {t('chats.membersCount', { n: chat.members.length })}
              </span>
            )}
          </span>
        </button>
      </header>

      {pins.length > 0 && (
        <button
          type="button"
          data-testid="pin-bar"
          onClick={() => {
            const pin = pins[pinIndex % pins.length];
            setPinIndex((i) => (i + 1) % pins.length); // tapping again moves to the next pinned message
            jumpTo(pin);
          }}
          className="flex min-h-11 w-full items-center gap-2 border-b border-slate-200 bg-white px-3 text-left text-sm hover:bg-slate-50"
        >
          <span aria-hidden="true">📌</span>
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-medium text-teal-800">
              {t('chats.pinned')}
              {pins.length > 1 ? ` ${(pinIndex % pins.length) + 1}/${pins.length}` : ''}
            </span>
            <span className="block truncate text-slate-700">{pins[pinIndex % pins.length].body || (pins[pinIndex % pins.length].attachments[0] ? `📎 ${pins[pinIndex % pins.length].attachments[0].name}` : '')}</span>
          </span>
        </button>
      )}

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
                readState={readOnly ? undefined : readState(m)}
                readOnly={readOnly}
                highlighted={highlightSeq === m.seq}
                canPin={canPin}
                pinned={isPinned(m)}
                onTogglePin={() => togglePin(m)}
                onReply={() => { setEditing(null); setReplyTo(m); }}
                onEdit={() => { setReplyTo(null); setEditing(m); }}
                onDelete={() => remove(m)}
              />
            </div>
          );
        })}
        {hasNewer && (
          <div className="flex flex-wrap justify-center gap-2 py-2">
            <button type="button" onClick={loadNewer} className="min-h-9 rounded-full bg-white px-4 text-xs text-teal-800 shadow-sm hover:bg-slate-100">
              {t('chats.loadNewer')}
            </button>
            <button type="button" onClick={goLatest} className="min-h-9 rounded-full bg-teal-700 px-4 text-xs text-white shadow-sm hover:bg-teal-800">
              {t('chats.toLatest')}
            </button>
          </div>
        )}
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

      {readOnly ? (
        <p role="note" data-testid="archive-note" className="safe-bottom border-t border-slate-200 bg-slate-100 px-3 py-3 text-center text-sm text-slate-600">
          {t('chats.archiveReadOnly')}
        </p>
      ) : (
      <Composer
          key={id}
          chatId={id}
          candidates={candidates}
          banner={bannerFor}
          initialText={editing?.body ?? undefined}
          editKey={editing?.id}
          busy={busy}
          onSend={send}
        />
      )}

      {infoOpen && chat && <ChatInfo chat={chat} title={title} onClose={() => setInfoOpen(false)} />}
    </section>
  );
}
