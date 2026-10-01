'use client';

import { useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useOrg } from '@/lib/useOrg';
import { Button, Card, ErrorText, Field, Input, PageTitle, Select, useErrorText } from '@/components/ui';

type Kind = 'departments' | 'positions';

function Section({ kind }: { kind: Kind }) {
  const { t } = useI18n();
  const org = useOrg();
  const errorText = useErrorText();
  const [form, setForm] = useState({ nameRu: '', nameKk: '', parentId: '' });
  const [error, setError] = useState<string>();
  const items = kind === 'departments' ? org.departments : org.positions;

  async function add(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    try {
      const body: Record<string, unknown> = { nameRu: form.nameRu.trim(), nameKk: form.nameKk.trim() };
      if (kind === 'departments' && form.parentId) body.parentId = form.parentId;
      await api(`/${kind}`, { method: 'POST', body });
      setForm({ nameRu: '', nameKk: '', parentId: '' });
      await org.reload();
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function remove(id: string) {
    if (!confirm(t('confirmDelete'))) return;
    setError(undefined);
    try {
      await api(`/${kind}/${id}`, { method: 'DELETE' });
      await org.reload();
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <Card className="space-y-3">
      <h2 className="font-medium">{kind === 'departments' ? t('org.departments') : t('org.positions')}</h2>
      <ErrorText>{error}</ErrorText>
      <ul className="divide-y divide-slate-100">
        {items.map((i) => (
          <li key={i.id} className="flex items-center justify-between gap-2 py-2 text-sm">
            <span>
              {i.nameRu} <span className="text-slate-400">/</span> {i.nameKk}
            </span>
            <Button variant="danger" onClick={() => remove(i.id)}>{t('delete')}</Button>
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="grid gap-3 sm:grid-cols-2">
        <Field label={t('field.nameRu')}>
          <Input required minLength={2} value={form.nameRu} onChange={(e) => setForm({ ...form, nameRu: e.target.value })} />
        </Field>
        <Field label={t('field.nameKk')}>
          <Input required minLength={2} value={form.nameKk} onChange={(e) => setForm({ ...form, nameKk: e.target.value })} />
        </Field>
        {kind === 'departments' && (
          <Field label={t('field.parent')}>
            <Select value={form.parentId} onChange={(e) => setForm({ ...form, parentId: e.target.value })}>
              <option value="">{t('none')}</option>
              {org.departments.map((d) => <option key={d.id} value={d.id}>{org.name(d)}</option>)}
            </Select>
          </Field>
        )}
        <div className="sm:col-span-2">
          <Button type="submit">{kind === 'departments' ? t('org.addDepartment') : t('org.addPosition')}</Button>
        </div>
      </form>
    </Card>
  );
}

export default function OrgPage() {
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      <PageTitle>{t('org.title')}</PageTitle>
      <Section kind="departments" />
      <Section kind="positions" />
    </div>
  );
}
