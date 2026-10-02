'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { MeetingDto } from '@hemcenter/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useChats } from '@/lib/chats';
import { useI18n } from '@/lib/i18n';
import { toLines } from '@/lib/docs';
import { Button, Card, ErrorText, Field, Input, PageTitle, Select, useErrorText } from '@/components/ui';

/** "2026-10-15T14:00" typed in the browser's time zone, as a moment in time. */
const toIso = (local: string) => new Date(local).toISOString();

export default function NewMeetingPage() {
  const { t } = useI18n();
  const router = useRouter();
  const { user } = useAuth();
  const { people } = useChats();
  const errorText = useErrorText();
  const [form, setForm] = useState({ subject: '', startsAt: '', place: '', chairId: '', secretaryId: '', agenda: '' });
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const colleagues = useMemo(() => Object.values(people).filter((p) => p.isActive && p.id !== user?.id).sort((a, b) => a.fullName.localeCompare(b.fullName)), [people, user?.id]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const m = await api<MeetingDto>('/meetings', {
        method: 'POST',
        body: { subject: form.subject, startsAt: toIso(form.startsAt), place: form.place || undefined, chairId: form.chairId || undefined, secretaryId: form.secretaryId || undefined, participantIds: picked, agenda: toLines(form.agenda) },
      });
      router.push(`/meetings/${m.id}`);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  const choose = (label: string, key: 'chairId' | 'secretaryId') => (
    <Field label={label}>
      <Select aria-label={label} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })}>
        <option value="">{user?.fullName}</option>
        {colleagues.map((c) => <option key={c.id} value={c.id}>{c.fullName}</option>)}
      </Select>
    </Field>
  );

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageTitle>{t('meet.new')}</PageTitle>
      <Card>
        <form onSubmit={submit} className="space-y-3">
          <ErrorText>{error}</ErrorText>
          <Field label={t('meet.subject')}><Input required maxLength={200} aria-label={t('meet.subject')} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('meet.startsAt')}><Input type="datetime-local" required aria-label={t('meet.startsAt')} value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} /></Field>
            <Field label={t('meet.place')}><Input maxLength={300} aria-label={t('meet.place')} value={form.place} onChange={(e) => setForm({ ...form, place: e.target.value })} /></Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {choose(t('meet.chair'), 'chairId')}
            {choose(t('meet.secretary'), 'secretaryId')}
          </div>
          <Field label={t('meet.agenda')}>
            <textarea aria-label={t('meet.agenda')} rows={4} value={form.agenda} onChange={(e) => setForm({ ...form, agenda: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base" />
          </Field>
          <fieldset>
            <legend className="mb-1 text-sm font-medium">{t('meet.participants')}</legend>
            <ul className="max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
              {colleagues.map((c) => (
                <li key={c.id}>
                  <label className="flex min-h-11 items-center gap-3 px-3">
                    <input type="checkbox" className="h-5 w-5" checked={picked.includes(c.id)} onChange={() => setPicked((p) => (p.includes(c.id) ? p.filter((x) => x !== c.id) : [...p, c.id]))} />
                    <span>{c.fullName}</span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
          <div className="sticky bottom-16 -mx-4 border-t border-slate-100 bg-white px-4 py-2 md:bottom-0">
            <Button type="submit" disabled={busy || !form.subject.trim() || !form.startsAt}>{t('create')}</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
