'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { AssignmentDto } from '@hemcenter/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useChats } from '@/lib/chats';
import { useI18n } from '@/lib/i18n';
import { Button, Card, ErrorText, Field, Input, PageTitle, Select, useErrorText } from '@/components/ui';

export default function NewAssignmentPage() {
  const { t } = useI18n();
  const router = useRouter();
  const { user } = useAuth();
  const { people } = useChats();
  const errorText = useErrorText();
  const [form, setForm] = useState({ text: '', responsibleId: '', controllerId: '', dueDate: '' });
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const everyone = useMemo(() => Object.values(people).filter((p) => p.isActive).sort((a, b) => a.fullName.localeCompare(b.fullName)), [people]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const a = await api<AssignmentDto>('/assignments', { method: 'POST', body: { text: form.text, responsibleId: form.responsibleId, controllerId: form.controllerId || undefined, dueDate: form.dueDate } });
      router.push(`/assignments/${a.id}`);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <PageTitle>{t('asg.new')}</PageTitle>
      <Card>
        <form onSubmit={submit} className="space-y-3">
          <ErrorText>{error}</ErrorText>
          <Field label={t('asg.text')}><textarea required rows={3} maxLength={2000} aria-label={t('asg.text')} value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base" /></Field>
          <Field label={t('asg.responsible')}>
            <Select required aria-label={t('asg.responsible')} value={form.responsibleId} onChange={(e) => setForm({ ...form, responsibleId: e.target.value })}>
              <option value="">{t('asg.pickPerson')}</option>
              {everyone.map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}
            </Select>
          </Field>
          <Field label={t('asg.controller')}>
            <Select aria-label={t('asg.controller')} value={form.controllerId} onChange={(e) => setForm({ ...form, controllerId: e.target.value })}>
              <option value="">{user?.fullName}</option>
              {everyone.filter((p) => p.id !== user?.id).map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}
            </Select>
          </Field>
          <Field label={t('asg.due')}><Input type="date" required aria-label={t('asg.due')} value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} className="max-w-48" /></Field>
          <Button type="submit" disabled={busy || !form.text.trim() || !form.responsibleId || !form.dueDate}>{t('create')}</Button>
        </form>
      </Card>
    </div>
  );
}
