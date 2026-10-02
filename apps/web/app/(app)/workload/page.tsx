'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { WorkloadMatrixDto } from '@hemcenter/shared';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Card, ErrorText, PageTitle, useErrorText } from '@/components/ui';

/** Rows are people, columns are projects, cells are shares of working time; totals above 100% are flagged. */
export default function WorkloadPage() {
  const { t } = useI18n();
  const errorText = useErrorText();
  const [matrix, setMatrix] = useState<WorkloadMatrixDto>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    api<WorkloadMatrixDto>('/workload/matrix').then(setMatrix, (e) => setError(errorText(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-4">
      <PageTitle>{t('workload.title')}</PageTitle>
      <ErrorText>{error}</ErrorText>
      {matrix && matrix.people.length === 0 && <p className="text-slate-500">{t('workload.empty')}</p>}
      {matrix && matrix.people.length > 0 && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-max text-sm" data-testid="matrix">
            <thead>
              <tr className="border-b border-slate-200 text-left">
                <th className="sticky left-0 bg-white px-3 py-2 font-medium">{t('workload.person')}</th>
                {matrix.projects.map((p) => (
                  <th key={p.id} className="px-3 py-2 font-medium">
                    <Link href={`/projects/${p.id}`} className="text-teal-800 underline">{p.name}</Link>
                  </th>
                ))}
                <th className="px-3 py-2 font-medium">{t('workload.total')}</th>
              </tr>
            </thead>
            <tbody>
              {matrix.people.map((p) => (
                <tr key={p.userId} className={`border-b border-slate-100 ${p.overloaded ? 'bg-red-50' : ''}`} data-testid="matrix-row">
                  <td className={`sticky left-0 px-3 py-2 font-medium ${p.overloaded ? 'bg-red-50' : 'bg-white'}`}>{p.fullName}</td>
                  {matrix.projects.map((pr) => {
                    const cell = p.cells.find((c) => c.projectId === pr.id);
                    return <td key={pr.id} className="px-3 py-2 text-center">{cell ? `${cell.allocation}%` : ''}</td>;
                  })}
                  <td className="px-3 py-2 text-center font-semibold">
                    {p.total}%
                    {p.overloaded && <span role="note" className="ml-2 text-red-700" data-testid="matrix-overload">⚠ {t('workload.warning', { n: p.total })}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
