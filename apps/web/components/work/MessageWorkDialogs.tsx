'use client';

import { useState, type FormEvent } from 'react';
import type { MessageDto } from '@hemcenter/shared';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Button, ErrorText, Field, Input, Select, useErrorText } from '../ui';
import { Modal } from './Modal';

export interface Candidate {
  id: string;
  name: string;
}

const firstLine = (body: string | null) => (body ?? '').split('\n')[0].slice(0, 120);

/** Makes a task from a message. The responsible person has no default: it has to be chosen. */
export function TaskDialog({ chatId, message, candidates, onClose }: { chatId: string; message: MessageDto; candidates: Candidate[]; onClose: () => void }) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const [title, setTitle] = useState(firstLine(message.body));
  const [assigneeId, setAssigneeId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!assigneeId) return setError(t('tasks.assigneePick'));
    setBusy(true);
    setError(undefined);
    try {
      await api(`/chats/${chatId}/messages/${message.id}/task`, { method: 'POST', body: { title, assigneeId, dueDate: dueDate || undefined } });
      onClose();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <Modal title={t('tasks.fromMessage')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <ErrorText>{error}</ErrorText>
        <Field label={t('tasks.titleLabel')}>
          <Input required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label={t('tasks.assignee')}>
          <Select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} aria-label={t('tasks.assignee')}>
            <option value="">{t('tasks.assigneePick')}</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('tasks.due')}>
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} aria-label={t('tasks.due')} />
        </Field>
        <Button type="submit" disabled={busy || !title.trim()}>
          {t('create')}
        </Button>
      </form>
    </Modal>
  );
}

/** Makes a decision from a message: the chosen colleagues have to confirm it. */
export function DecisionDialog({ chatId, message, candidates, onClose }: { chatId: string; message: MessageDto; candidates: Candidate[]; onClose: () => void }) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const [text, setText] = useState((message.body ?? '').slice(0, 1000));
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await api(`/chats/${chatId}/messages/${message.id}/decision`, { method: 'POST', body: { text, addresseeIds: picked } });
      onClose();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <Modal title={t('decision.create')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <ErrorText>{error}</ErrorText>
        <Field label={t('decision.text')}>
          <textarea required rows={3} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} aria-label={t('decision.text')} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base" />
        </Field>
        <fieldset>
          <legend className="mb-1 text-sm font-medium">{t('decision.addressees')}</legend>
          {candidates.length === 0 && <p className="text-sm text-slate-500">{t('decision.noAddressees')}</p>}
          <ul className="max-h-48 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
            {candidates.map((c) => (
              <li key={c.id}>
                <label className="flex min-h-11 items-center gap-3 px-3">
                  <input type="checkbox" checked={picked.includes(c.id)} onChange={() => toggle(c.id)} className="h-5 w-5" />
                  <span>{c.name}</span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
        <Button type="submit" disabled={busy || !text.trim() || picked.length === 0}>
          {t('create')}
        </Button>
      </form>
    </Modal>
  );
}
