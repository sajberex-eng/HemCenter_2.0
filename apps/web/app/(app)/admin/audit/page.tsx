'use client';

import { useCallback, useEffect, useState } from 'react';
import type { UserDto } from '@hemcenter/shared';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { saveProtected } from '@/lib/download';
import { Button, ErrorText, Field, Input, PageTitle, Select, useErrorText } from '@/components/ui';

interface Row {
  id: string;
  at: string;
  actorId: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  ip: string | null;
}

const PAGE = 50;
/** Groups of actions, by the beginning of their code. */
const ACTION_GROUPS = ['auth.', 'user.', 'chat.', 'message.', 'file.', 'project.', 'milestone.', 'task.', 'decision.', 'document', 'meeting.', 'assignment.', 'oversight.', 'push.', 'import.'];

export default function AuditPage() {
  const { t, locale } = useI18n();
  const errorText = useErrorText();
  const [rows, setRows] = useState<Row[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string>();
  const [filter, setFilter] = useState({ actorId: '', action: '', from: '', to: '' });
  const [applied, setApplied] = useState(filter);

  const query = (f: typeof filter) => new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();

  const load = useCallback(
    async (skip: number) => {
      try {
        const page = await api<Row[]>(`/audit?take=${PAGE}&skip=${skip}&${query(applied)}`);
        setRows((prev) => (skip === 0 ? page : [...prev, ...page]));
        setMore(page.length === PAGE);
      } catch (e) {
        setError(errorText(e));
      }
    },
    [applied],
  );

  useEffect(() => {
    load(0);
    api<UserDto[]>('/users?includeInactive=true').then((us) => setNames(Object.fromEntries(us.map((u) => [u.id, u.fullName]))));
  }, [load]);

  const fmt = new Intl.DateTimeFormat(locale === 'kk' ? 'kk-KZ' : 'ru-RU', { dateStyle: 'short', timeStyle: 'medium' });

  return (
    <div className="space-y-4">
      <PageTitle>{t('audit.title')}</PageTitle>
      <p className="text-sm text-slate-600">{t('audit.note')}</p>
      <form
        className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied(filter);
        }}
      >
        <div className="min-w-48 flex-1">
          <Field label={t('audit.person')}>
            <Select aria-label={t('audit.person')} value={filter.actorId} onChange={(e) => setFilter({ ...filter, actorId: e.target.value })}>
              <option value="">{t('audit.anyone')}</option>
              {Object.entries(names).sort((a, b) => a[1].localeCompare(b[1])).map(([id, n]) => <option key={id} value={id}>{n}</option>)}
            </Select>
          </Field>
        </div>
        <div className="min-w-40">
          <Field label={t('audit.action')}>
            <Select aria-label={t('audit.action')} value={filter.action} onChange={(e) => setFilter({ ...filter, action: e.target.value })}>
              <option value="">{t('audit.anyAction')}</option>
              {ACTION_GROUPS.map((g) => <option key={g} value={g}>{g}*</option>)}
            </Select>
          </Field>
        </div>
        <Field label={t('audit.from')}><Input type="date" aria-label={t('audit.from')} value={filter.from} onChange={(e) => setFilter({ ...filter, from: e.target.value })} /></Field>
        <Field label={t('audit.to')}><Input type="date" aria-label={t('audit.to')} value={filter.to} onChange={(e) => setFilter({ ...filter, to: e.target.value })} /></Field>
        <Button type="submit">{t('audit.apply')}</Button>
        <Button type="button" variant="secondary" onClick={() => void saveProtected(`/audit/export?${query(applied)}`, 'audit.csv')}>{t('audit.export')}</Button>
      </form>
      <ErrorText>{error}</ErrorText>
      {rows.length === 0 && !error && <p className="text-slate-500">{t('audit.empty')}</p>}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2">{t('audit.at')}</th>
              <th className="px-3 py-2">{t('audit.actor')}</th>
              <th className="px-3 py-2">{t('audit.action')}</th>
              <th className="px-3 py-2">{t('audit.object')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="whitespace-nowrap px-3 py-2">{fmt.format(new Date(r.at))}</td>
                <td className="px-3 py-2">{r.actorId ? names[r.actorId] ?? r.actorId.slice(0, 8) : t('none')}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.action}</td>
                <td className="px-3 py-2 text-xs text-slate-500">{r.entityType ? `${r.entityType} ${r.entityId?.slice(0, 8) ?? ''}` : t('none')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {more && <Button variant="secondary" onClick={() => load(rows.length)}>{t('audit.more')}</Button>}
    </div>
  );
}
