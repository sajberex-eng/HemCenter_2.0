'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { NOTIFY_MODES, type ChatDto, type NotifyMode } from '@hemcenter/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useChats } from '@/lib/chats';
import { useI18n } from '@/lib/i18n';
import type { Key } from '@/lib/dictionaries';
import { Button, ErrorText, Field, Input, Select, useErrorText } from '../ui';
import { Avatar } from './Avatar';

export function ChatInfo({ chat, title, onClose }: { chat: ChatDto; title: string; onClose: () => void }) {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const { people, nameOf, upsertChat, reload } = useChats();
  const router = useRouter();
  const errorText = useErrorText();
  const [error, setError] = useState<string>();
  const [newTitle, setNewTitle] = useState(chat.title ?? '');
  const [adding, setAdding] = useState(false);
  const [toAdd, setToAdd] = useState<string[]>([]);
  const [views, setViews] = useState<{ count: number; lastAt: string | null }>();
  const meId = user!.id;
  const isGroup = chat.type === 'GROUP';
  const iAmOwner = chat.members.find((m) => m.userId === meId)?.role === 'OWNER';

  const candidates = useMemo(
    () => Object.values(people).filter((p) => p.isActive && !chat.members.some((m) => m.userId === p.id)).sort((a, b) => a.fullName.localeCompare(b.fullName)),
    [people, chat.members],
  );

  // members are told how often management has opened this chat (never by whom)
  useEffect(() => {
    let alive = true;
    api<{ count: number; lastAt: string | null }>(`/chats/${chat.id}/oversight`).then((v) => alive && setViews(v), () => undefined);
    return () => {
      alive = false;
    };
  }, [chat.id]);

  async function run(fn: () => Promise<unknown>) {
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    }
  }

  const setMode = (notifyMode: NotifyMode) =>
    run(async () => {
      await api(`/chats/${chat.id}/me`, { method: 'PATCH', body: { notifyMode } });
      upsertChat({ ...chat, notifyMode });
    });

  const rename = () =>
    run(async () => {
      upsertChat(await api<ChatDto>(`/chats/${chat.id}`, { method: 'PATCH', body: { title: newTitle.trim() } }));
    });

  const add = () =>
    run(async () => {
      upsertChat(await api<ChatDto>(`/chats/${chat.id}/members`, { method: 'POST', body: { userIds: toAdd } }));
      setToAdd([]);
      setAdding(false);
    });

  const remove = (id: string) =>
    run(async () => {
      if (!confirm(t('chats.confirmRemove'))) return;
      await api(`/chats/${chat.id}/members/${id}`, { method: 'DELETE' });
      await reload();
    });

  const leave = () =>
    run(async () => {
      if (!confirm(t('chats.confirmLeave'))) return;
      await api(`/chats/${chat.id}/members/${meId}`, { method: 'DELETE' });
      await reload();
      router.replace('/chats');
    });

  return (
    <div className="fixed inset-0 z-30 flex justify-end bg-black/30" onClick={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={t('chats.info')}
        onClick={(e) => e.stopPropagation()}
        className="safe-top safe-bottom flex h-full w-full max-w-md flex-col gap-4 overflow-y-auto bg-white p-4 shadow-xl"
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">{title}</h2>
            {isGroup && <p className="text-sm text-slate-500">{t('chats.membersCount', { n: chat.members.length })}</p>}
          </div>
          <button type="button" aria-label={t('chats.close')} onClick={onClose} className="min-h-11 min-w-11 rounded text-2xl text-slate-500 hover:bg-slate-100">
            ×
          </button>
        </div>

        <ErrorText>{error}</ErrorText>

        <p role="note" data-testid="oversight-note" className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          {t('chats.oversightNote')}{' '}
          {views && (views.count === 0 ? t('chats.oversightNone') : t('chats.oversightViews', { n: views.count, date: views.lastAt ? new Date(views.lastAt).toLocaleString(locale === 'kk' ? 'kk-KZ' : 'ru-RU') : '' }))}
        </p>

        <Field label={t('chats.notifications')}>
          <Select value={chat.notifyMode} onChange={(e) => setMode(e.target.value as NotifyMode)}>
            {NOTIFY_MODES.map((m) => (
              <option key={m} value={m}>
                {t(`chats.notify.${m}` as Key)}
              </option>
            ))}
          </Select>
        </Field>

        {isGroup && iAmOwner && (
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void rename();
            }}
          >
            <div className="flex-1">
              <Field label={t('chats.rename')}>
                <Input value={newTitle} maxLength={100} onChange={(e) => setNewTitle(e.target.value)} />
              </Field>
            </div>
            <Button type="submit" variant="secondary" disabled={!newTitle.trim() || newTitle.trim() === chat.title}>
              {t('save')}
            </Button>
          </form>
        )}

        {isGroup && (
          <section aria-label={t('chats.members')}>
            <h3 className="mb-2 font-medium">{t('chats.members')}</h3>
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {chat.members.map((m) => (
                <li key={m.userId} className="flex min-h-14 items-center gap-3 px-3">
                  <Avatar id={m.userId} name={nameOf(m.userId)} size={36} />
                  <span className="min-w-0 flex-1 truncate">
                    {nameOf(m.userId)}
                    {m.role === 'OWNER' && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{t('chats.owner')}</span>}
                  </span>
                  {iAmOwner && m.userId !== meId && (
                    <button type="button" onClick={() => remove(m.userId)} className="min-h-9 rounded px-2 text-sm text-red-700 hover:bg-red-50">
                      {t('chats.removeMember')}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {isGroup && iAmOwner && (
          <section>
            {!adding ? (
              <Button variant="secondary" onClick={() => setAdding(true)}>
                {t('chats.addMembers')}
              </Button>
            ) : (
              <div className="space-y-2">
                <ul className="max-h-60 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
                  {candidates.map((p) => (
                    <li key={p.id}>
                      <label className="flex min-h-12 cursor-pointer items-center gap-3 px-3 hover:bg-slate-50">
                        <input type="checkbox" className="size-5" checked={toAdd.includes(p.id)} onChange={() => setToAdd((s) => (s.includes(p.id) ? s.filter((x) => x !== p.id) : [...s, p.id]))} />
                        <span>{p.fullName}</span>
                      </label>
                    </li>
                  ))}
                </ul>
                <div className="flex gap-2">
                  <Button onClick={add} disabled={toAdd.length === 0}>
                    {t('chats.addMembers')}
                  </Button>
                  <Button variant="secondary" onClick={() => setAdding(false)}>
                    {t('cancel')}
                  </Button>
                </div>
              </div>
            )}
          </section>
        )}

        {isGroup && (
          <Button variant="danger" onClick={leave} className="mt-auto">
            {t('chats.leave')}
          </Button>
        )}
      </aside>
    </div>
  );
}
