'use client';

import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { Card, PageTitle, PatientDataWarning } from '@/components/ui';

export default function Home() {
  const { user } = useAuth();
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      <PageTitle>{t('home.greeting', { name: user?.fullName ?? '' })}</PageTitle>
      <PatientDataWarning />
      <Card>
        <p className="text-slate-600">{t('home.soon')}</p>
      </Card>
    </div>
  );
}
