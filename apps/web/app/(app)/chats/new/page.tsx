'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { ChatDto } from '@hemcenter/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useChats } from '@/lib/chats';
import { useI18n } from '@/lib/i18n';
import { Avatar } from '@/components/chat/Avatar';
import { Button, ErrorText, Field, Input, useErrorText } from '@/components/ui';

export default function NewChatPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const { people, upsertChat } = useChats();
  const router = useRouter();
  const errorText = useErrorText();
  const [mode, setMode] = useState<'direct' | 'group'>('direct');
  const [q, setQ] = useState('');
  const [title, setTitle] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const list = useMemo(
    () =>
      Object.values(people)
        .filter((p) => p.isActive && p.id !== user?.id && p.fullName.toLowerCase().includes(q.trim().toLowerCase()))
        .sort((a, b) => a.fullName.localeCompare(b.fullName)),
    [people, q, user?.id],
  );

  async function openDirect(id: string) {
    setBusy(true);
    setError(undefined);
    try {
      const chat = await api<ChatDto>('/chats/direct', { method: 'POST', body: { userId: id } });
      upsertChat(chat);
      router.replace(`/chats/${chat.id}`);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }

  async function createGroup(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const chat = await api<ChatDto>('/chats/groups', { method: 'POST', body: { title: title.trim(), memberIds: selected } });
      upsertChat(chat);
      router.replace(`/chats/${chat.id}`);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <div className="mx-auto w-full max-w-lg space-y-4 md:self-start">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t('chats.new')}</h1>
        <button type="button" onClick={() => router.back()} className="min-h-11 rounded px-3 text-sm text-slate-600 hover:bg-slate-100">
          {t('cancel')}
        </button>
      </div>

      <div role="tablist" className="inline-flex overflow-hidden rounded-lg border border-slate-300 text-sm">
        {(['direct', 'group'] as const).map((m) => (
          <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={`min-h-11 px-4 ${mode === m ? 'bg-teal-700 text-white' : 'bg-white text-slate-700'}`}>
            {m === 'direct' ? t('chats.newDirect') : t('chats.newGroup')}
          </button>
        ))}
      </div>

      <form onSubmit={createGroup} className="space-y-4">
        {mode === 'group' && (
          <Field label={t('chats.groupTitle')}>
            <Input required maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
        )}
        <Input type="search" aria-label={t('chats.searchPeople')} placeholder={t('chats.searchPeople')} value={q} onChange={(e) => setQ(e.target.value)} />
        <ul className="max-h-[50dvh] divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200 bg-white">
          {list.map((p) => (
            <li key={p.id}>
              {mode === 'direct' ? (
                <button type="button" disabled={busy} onClick={() => openDirect(p.id)} className="flex min-h-14 w-full items-center gap-3 px-3 text-left hover:bg-slate-50">
                  <Avatar id={p.id} name={p.fullName} />
                  <span>{p.fullName}</span>
                </button>
              ) : (
                <label className="flex min-h-14 cursor-pointer items-center gap-3 px-3 hover:bg-slate-50">
                  <input type="checkbox" className="size-5" checked={selected.includes(p.id)} onChange={() => toggle(p.id)} />
                  <Avatar id={p.id} name={p.fullName} />
                  <span>{p.fullName}</span>
                </label>
              )}
            </li>
          ))}
        </ul>
        <ErrorText>{error}</ErrorText>
        {mode === 'group' && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-slate-600">{t('chats.selected', { n: selected.length })}</span>
            <Button type="submit" disabled={busy || selected.length === 0 || !title.trim()}>
              {t('chats.createGroup')}
            </Button>
          </div>
        )}
      </form>
    </div>
  );
}
