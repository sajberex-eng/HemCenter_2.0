'use client';

import { useEffect, useState } from 'react';
import type { UserDto } from '@hemcenter/shared';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Card, Input, PageTitle } from '@/components/ui';
import { useOrg } from '@/lib/useOrg';

export default function StaffPage() {
  const { t } = useI18n();
  const org = useOrg();
  const [q, setQ] = useState('');
  const [users, setUsers] = useState<UserDto[]>([]);

  useEffect(() => {
    const id = setTimeout(() => {
      api<UserDto[]>(`/users?q=${encodeURIComponent(q)}`).then(setUsers).catch(() => setUsers([]));
    }, 250);
    return () => clearTimeout(id);
  }, [q]);

  return (
    <div className="space-y-4">
      <PageTitle>{t('staff.title')}</PageTitle>
      <Input type="search" placeholder={t('search')} value={q} onChange={(e) => setQ(e.target.value)} />
      {users.length === 0 && <p className="text-slate-500">{t('staff.empty')}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {users.map((u) => (
          <Card key={u.id}>
            <div className="font-medium">{u.fullName}</div>
            <div className="text-sm text-slate-600">{[org.position(u.positionId), org.department(u.departmentId)].filter(Boolean).join(' · ') || t('none')}</div>
            {u.phone && (
              <a href={`tel:${u.phone}`} className="mt-1 block text-sm text-teal-700">
                {u.phone}
              </a>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
