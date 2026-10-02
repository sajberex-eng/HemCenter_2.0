'use client';

import { useEffect, useState } from 'react';
import type { WorkloadDto } from '@hemcenter/shared';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { Key } from '@/lib/dictionaries';
import { Card } from './ui';

/** The person's own shares per project and the total, with a warning above 100% (TZ 3.4). */
export function WorkloadSection() {
  const { t } = useI18n();
  const [load, setLoad] = useState<WorkloadDto>();
  useEffect(() => {
    api<WorkloadDto>('/workload/me').then(setLoad, () => undefined);
  }, []);
  if (!load) return null;
  return (
    <Card aria-label={t('workload.mine')} data-testid="my-workload">
      <h2 className="mb-2 font-medium">{t('workload.mine')}</h2>
      {load.projects.length === 0 ? (
        <p className="text-sm text-slate-500">{t('workload.none')}</p>
      ) : (
        <>
          <ul className="divide-y divide-slate-100 text-sm">
            {load.projects.map((p) => (
              <li key={p.projectId} className="flex justify-between py-1.5">
                <span>{p.name} <span className="text-xs text-slate-500">({t(`projects.status.${p.status}` as Key)})</span></span>
                <span>{p.allocation}%</span>
              </li>
            ))}
          </ul>
          <p className={`mt-2 text-sm font-medium ${load.overloaded ? 'text-red-700' : 'text-slate-700'}`} role={load.overloaded ? 'note' : undefined} data-testid="my-workload-total">
            {load.overloaded ? `⚠ ${t('workload.warning', { n: load.total })}` : t('workload.ok', { n: load.total })}
          </p>
        </>
      )}
    </Card>
  );
}
