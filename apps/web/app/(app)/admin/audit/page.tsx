'use client';

import { useCallback, useEffect, useState } from 'react';
import type { UserDto } from '@hemcenter/shared';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Button, ErrorText, PageTitle, useErrorText } from '@/components/ui';

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

export default function AuditPage() {
  const { t, locale } = useI18n();
  const errorText = useErrorText();
  const [rows, setRows] = useState<Row[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string>();

  const load = useCallback(
    async (skip: number) => {
      try {
        const page = await api<Row[]>(`/audit?take=${PAGE}&skip=${skip}`);
        setRows((prev) => (skip === 0 ? page : [...prev, ...page]));
        setMore(page.length === PAGE);
      } catch (e) {
        setError(errorText(e));
      }
    },
    [],
  );

  useEffect(() => {
    load(0);
    api<UserDto[]>('/users?includeInactive=true').then((us) => setNames(Object.fromEntries(us.map((u) => [u.id, u.fullName]))));
  }, [load]);

  const fmt = new Intl.DateTimeFormat(locale === 'kk' ? 'kk-KZ' : 'ru-RU', { dateStyle: 'short', timeStyle: 'medium' });

  return (
    <div className="space-y-4">
      <PageTitle>{t('audit.title')}</PageTitle>
      <ErrorText>{error}</ErrorText>
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
