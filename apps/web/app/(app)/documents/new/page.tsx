'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { DocumentDto, DocumentKindDto } from '@hemcenter/shared';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { emptyForm } from '@/lib/docs';
import { PageTitle, useErrorText } from '@/components/ui';
import { DocumentForm } from '@/components/docs/DocumentForm';

const today = () => new Date().toLocaleDateString('en-CA');

export default function NewDocumentPage() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const errorText = useErrorText();
  const [kinds, setKinds] = useState<DocumentKindDto[]>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<DocumentKindDto[]>('/document-kinds').then(setKinds, () => setKinds([]));
  }, []);

  if (!kinds) return <p className="p-6 text-slate-500">{t('loading')}</p>;
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageTitle>{t('docs.new')}</PageTitle>
      <DocumentForm
        kinds={kinds}
        initial={{ kindId: kinds[0]?.id ?? '', lang: locale, title: '', docDate: today(), form: emptyForm() }}
        submitLabel={t('create')}
        error={error}
        busy={busy}
        onSubmit={async (v) => {
          setBusy(true);
          setError(undefined);
          try {
            const d = await api<DocumentDto>('/documents', { method: 'POST', body: v });
            router.push(`/documents/${d.id}`);
          } catch (e) {
            setError(errorText(e));
            setBusy(false);
          }
        }}
      />
    </div>
  );
}
