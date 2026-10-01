'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ChatDto, MessageDto, ServerEvents, UserDto } from '@hemcenter/shared';
import { api } from './api';
import { useAuth } from './auth';
import { useI18n } from './i18n';
import { createSocket } from './socket';
import { loadSettings, playPing, syncPush, type NotificationSettings } from './push';
import { wantsAlert } from './prefs';

export type ChatEvent =
  | { type: 'message:new' | 'message:updated' | 'message:deleted'; message: MessageDto }
  | { type: 'chat:read'; chatId: string; userId: string; lastReadSeq: number }
  | { type: 'chat:updated'; chatId: string }
  | { type: 'chat:pins'; chatId: string }
  | { type: 'resync' };

export interface Toast {
  id: string;
  chatId: string;
  title: string;
  body: string;
}

interface ChatsState {
  chats: ChatDto[];
  loaded: boolean;
  connected: boolean;
  totalUnread: number;
  people: Record<string, UserDto>;
  nameOf: (id: string) => string;
  ensurePeople: (ids: string[]) => void;
  reload: () => Promise<void>;
  upsertChat: (chat: ChatDto) => void;
  /** The conversation currently on screen; its incoming messages are not counted as unread. */
  setActiveChat: (id: string | null) => void;
  markReadLocal: (chatId: string, seq: number) => void;
  subscribe: (handler: (e: ChatEvent) => void) => () => void;
  toasts: Toast[];
  dismissToast: (id: string) => void;
  /** Reload do-not-disturb / quiet hours after they were changed. */
  refreshPrefs: () => void;
}

const Ctx = createContext<ChatsState | null>(null);

const byRecency = (a: ChatDto, b: ChatDto) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? '');

export function ChatsProvider({ children }: { children: ReactNode }) {
  const { user, refreshUser } = useAuth();
  const { t } = useI18n();
  const [chats, setChats] = useState<ChatDto[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [connected, setConnected] = useState(true);
  const [people, setPeople] = useState<Record<string, UserDto>>({});
  const [toasts, setToasts] = useState<Toast[]>([]);
  const prefs = useRef<NotificationSettings | null>(null);
  // settled once the do-not-disturb settings have been fetched (alerts must not be decided before that)
  const prefsReady = useRef<Promise<unknown>>(Promise.resolve());
  const peopleRef = useRef<Record<string, UserDto>>({});
  peopleRef.current = people;
  const activeChat = useRef<string | null>(null);
  const handlers = useRef(new Set<(e: ChatEvent) => void>());
  const requested = useRef(new Set<string>());
  // always the latest list, readable from long-lived socket handlers
  const chatsSnapshot = useRef<ChatDto[]>([]);
  chatsSnapshot.current = chats;
  const meId = user?.id ?? null;

  const emit = useCallback((e: ChatEvent) => handlers.current.forEach((h) => h(e)), []);

  const reload = useCallback(async () => {
    const list = await api<ChatDto[]>('/chats');
    setChats(list.sort(byRecency));
    setLoaded(true);
  }, []);

  const ensurePeople = useCallback((ids: string[]) => {
    const missing = ids.filter((id) => !requested.current.has(id));
    missing.forEach((id) => requested.current.add(id));
    if (!missing.length) return;
    // the directory covers active colleagues; people who left or were blocked are fetched one by one
    Promise.allSettled(missing.map((id) => api<UserDto>(`/users/${id}`))).then((results) => {
      const found = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
      if (found.length) setPeople((p) => ({ ...p, ...Object.fromEntries(found.map((u) => [u.id, u])) }));
    });
  }, []);

  const refreshPrefs = useCallback(() => {
    prefsReady.current = loadSettings().then((p) => (prefs.current = p)).catch(() => undefined);
  }, []);

  // notification preferences, and make sure this device's push subscription is known to the server
  useEffect(() => {
    if (!meId) return;
    refreshPrefs();
    void syncPush();
  }, [meId, refreshPrefs]);

  // staff directory
  useEffect(() => {
    if (!meId) return;
    api<UserDto[]>('/users').then((list) => {
      list.forEach((u) => requested.current.add(u.id));
      setPeople(Object.fromEntries(list.map((u) => [u.id, u])));
    }).catch(() => undefined);
  }, [meId]);

  // authors we do not know yet
  useEffect(() => {
    ensurePeople(chats.flatMap((c) => [...c.members.map((m) => m.userId), ...(c.lastMessage ? [c.lastMessage.authorId] : [])]));
  }, [chats, ensurePeople]);

  // live connection
  useEffect(() => {
    if (!meId) {
      setChats([]);
      setLoaded(false);
      return;
    }
    const socket = createSocket();

    const bump = (m: MessageDto) =>
      setChats((prev) => {
        const chat = prev.find((c) => c.id === m.chatId);
        if (!chat) return prev;
        const seenNow = activeChat.current === m.chatId && document.visibilityState === 'visible';
        const incoming = m.authorId !== meId && !seenNow ? 1 : 0;
        const next = prev.map((c) =>
          c.id === m.chatId ? { ...c, lastMessage: m, lastMessageAt: m.createdAt, unreadCount: c.unreadCount + incoming } : c,
        );
        return next.sort(byRecency);
      });

    const on = <E extends keyof ServerEvents>(event: E, fn: (p: ServerEvents[E]) => void) => socket.on(event as string, fn as (...a: unknown[]) => void);

    /**
     * Pop-up and sound for a message in a chat that is not on screen. Decided only when the chat's own setting
     * and the person's do-not-disturb settings are known: right after a page load a message can arrive before
     * either has been fetched, and guessing "notify" would ring for a chat the person muted.
     */
    const alertFor = async (m: MessageDto, list: ChatDto[]) => {
      if (m.authorId === meId) return;
      const chat = list.find((c) => c.id === m.chatId);
      if (!chat) return; // unknown chat: stay quiet, the unread counter still shows it
      await prefsReady.current;
      if (activeChat.current === m.chatId && document.visibilityState === 'visible') return;
      if (!wantsAlert(chat.notifyMode, m.mentionIds.includes(meId), prefs.current)) return;
      const author = peopleRef.current[m.authorId]?.fullName ?? '…';
      const title = chat.type === 'GROUP' && chat.title ? `${chat.title} · ${author}` : author;
      // inside the app the text may be shown: it is our own screen, not a third-party push service
      const body = m.body || (m.attachments[0] ? `📎 ${m.attachments[0].name}` : '');
      setToasts((prev) => [...prev.filter((x) => x.chatId !== m.chatId), { id: m.id, chatId: m.chatId, title, body }].slice(-3));
      playPing();
    };

    on('message:new', (m) => {
      if (chatsHas(m.chatId)) {
        bump(m);
        void alertFor(m, chatsSnapshot.current);
      } else {
        // the list is not loaded yet (or this is a brand-new chat): fetch it, then decide with the real settings
        api<ChatDto[]>('/chats')
          .then((list) => {
            setChats(list.sort(byRecency));
            setLoaded(true);
            return alertFor(m, list);
          })
          .catch(() => undefined);
      }
      emit({ type: 'message:new', message: m });
    });
    on('message:updated', (m) => {
      setChats((prev) => prev.map((c) => (c.lastMessage?.id === m.id ? { ...c, lastMessage: m } : c)));
      emit({ type: 'message:updated', message: m });
    });
    on('message:deleted', (m) => {
      setChats((prev) => prev.map((c) => (c.lastMessage?.id === m.id ? { ...c, lastMessage: m } : c)));
      emit({ type: 'message:deleted', message: m });
      reload().catch(() => undefined); // unread counters may have changed
    });
    on('chat:read', (e) => {
      setChats((prev) =>
        prev.map((c) => {
          if (c.id !== e.chatId) return c;
          const members = c.members.map((m) => (m.userId === e.userId ? { ...m, lastReadSeq: Math.max(m.lastReadSeq, e.lastReadSeq) } : m));
          // I read it on another device
          const unread = e.userId === meId && c.lastMessage && e.lastReadSeq >= c.lastMessage.seq ? 0 : c.unreadCount;
          return { ...c, members, unreadCount: unread };
        }),
      );
      emit({ type: 'chat:read', ...e });
    });
    on('chat:pins', (e) => emit({ type: 'chat:pins', chatId: e.chatId }));
    on('chat:updated', (e) => {
      reload().catch(() => undefined);
      emit({ type: 'chat:updated', chatId: e.chatId });
    });

    const chatsHas = (id: string) => chatsSnapshot.current.some((c) => c.id === id);

    const markLive = (on: boolean) => {
      // lets automated tests (and support staff in DevTools) see whether live updates are flowing
      document.documentElement.dataset.live = on ? '1' : '0';
    };
    socket.on('connect', () => {
      markLive(true);
      setConnected(true);
      // anything that happened while we were offline is picked up by a full resync
      api<ChatDto[]>('/chats').then((list) => {
        setChats(list.sort(byRecency));
        setLoaded(true);
        emit({ type: 'resync' });
      }).catch(() => undefined);
    });
    socket.on('disconnect', () => {
      markLive(false);
      setConnected(false);
    });
    socket.on('connect_error', () => {
      markLive(false);
      setConnected(false);
    });
    socket.on('auth:error', () => {
      // the session is gone (blocked, signed out elsewhere): this either recovers or sends us to the login screen
      refreshUser().catch(() => window.location.assign('/login'));
    });
    socket.connect();
    return () => {
      socket.close();
    };
    // reconnect only when the signed-in user changes; the handlers read everything else through refs
  }, [meId]);

  const totalUnread = useMemo(() => chats.reduce((n, c) => n + c.unreadCount, 0), [chats]);

  // tab title and app icon badge
  useEffect(() => {
    document.title = totalUnread > 0 ? `(${totalUnread}) ${t('appName')}` : t('appName');
    try {
      const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
      if (totalUnread > 0) nav.setAppBadge?.(totalUnread)?.catch(() => undefined);
      else nav.clearAppBadge?.()?.catch(() => undefined);
    } catch {
      /* badges are optional */
    }
  }, [totalUnread, t]);

  const value = useMemo<ChatsState>(
    () => ({
      chats,
      loaded,
      connected,
      totalUnread,
      people,
      nameOf: (id) => people[id]?.fullName ?? '…',
      ensurePeople,
      reload,
      upsertChat: (chat) => setChats((prev) => [chat, ...prev.filter((c) => c.id !== chat.id)].sort(byRecency)),
      setActiveChat: (id) => {
        activeChat.current = id;
      },
      markReadLocal: (chatId, seq) =>
        setChats((prev) =>
          prev.map((c) =>
            c.id === chatId
              ? { ...c, unreadCount: 0, members: c.members.map((m) => (m.userId === meId ? { ...m, lastReadSeq: Math.max(m.lastReadSeq, seq) } : m)) }
              : c,
          ),
        ),
      subscribe: (h) => {
        handlers.current.add(h);
        return () => handlers.current.delete(h);
      },
      toasts,
      dismissToast: (id) => setToasts((prev) => prev.filter((x) => x.id !== id)),
      refreshPrefs,
    }),
    [chats, loaded, connected, totalUnread, people, ensurePeople, reload, meId, toasts, refreshPrefs],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useChats(): ChatsState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useChats must be used inside ChatsProvider');
  return v;
}
