'use client';

import Link from 'next/link';
import { use, useCallback, useEffect, useState } from 'react';
import { EDITABLE_DOCUMENT_STATUSES, type DocumentDto, type DocumentKindDto } from '@hemcenter/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useChats } from '@/lib/chats';
import { useI18n } from '@/lib/i18n';
import { formatDate } from '@/lib/chatUtils';
import { saveProtected } from '@/lib/download';
import { formFromData, kindName, STATUS_STYLE } from '@/lib/docs';
import type { Key } from '@/lib/dictionaries';
import { Button, Card, ErrorText, PageTitle, useErrorText } from '@/components/ui';
import { DocumentForm } from '@/components/docs/DocumentForm';
import { Workflow } from '@/components/docs/Workflow';

export default function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const { nameOf, ensurePeople, subscribe } = useChats();
  const errorText = useErrorText();
  const [doc, setDoc] = useState<DocumentDto>();
  const [kinds, setKinds] = useState<DocumentKindDto[]>([]);
  const [missing, setMissing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<'docx' | 'pdf' | 'save' | null>(null);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    try {
      const d = await api<DocumentDto>(`/documents/${id}`);
      setDoc(d);
      ensurePeople([d.authorId]);
    } catch {
      setMissing(true);
    }
  }, [id, ensurePeople]);

  // another person's decision arrives while this page is open
  useEffect(() => subscribe((e) => { if (e.type === 'document:updated' && e.documentId === id) void load(); }), [subscribe, id, load]);

  useEffect(() => {
    void load();
    api<DocumentKindDto[]>('/document-kinds?all=1').then(setKinds, () => undefined);
  }, [load]);

  async function download(format: 'docx' | 'pdf') {
    if (!doc) return;
    setBusy(format);
    setError(undefined);
    try {
      await saveProtected(`/documents/${id}/file?format=${format}`, `${doc.title}.${format}`);
      if (format === 'pdf' || doc?.status === 'REGISTERED') await load(); // the hash appears once the file exists
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  if (missing) return <p className="p-6 text-slate-600">{t('err.DOCUMENT_NOT_FOUND')}</p>;
  if (!doc) return <p className="p-6 text-slate-500">{t('loading')}</p>;
  const kind = kinds.find((k) => k.id === doc.kindId);
  const canEdit = user?.id === doc.authorId && EDITABLE_DOCUMENT_STATUSES.includes(doc.status);
  const d = doc.data;
  const lines = (label: string, v?: string | string[]) =>
    v && v.length > 0 ? (
      <div>
        <dt className="text-slate-500">{label}</dt>
        <dd className="whitespace-pre-wrap">{Array.isArray(v) ? v.map((x, i) => <div key={i}>{i + 1}. {x}</div>) : v}</dd>
      </div>
    ) : null;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href="/documents" className="text-sm text-teal-800 underline">‹ {t('docs.title')}</Link>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PageTitle>{doc.title}</PageTitle>
        <span className={`rounded-full px-3 py-1 text-sm font-medium ${STATUS_STYLE[doc.status]}`} data-testid="document-status">{t(`docs.status.${doc.status}` as Key)}</span>
      </div>
      <ErrorText>{error}</ErrorText>

      {editing && kind ? (
        <Card>
          <DocumentForm
            kinds={[kind]}
            lockKind
            initial={{ kindId: doc.kindId, lang: doc.lang, title: doc.title, docDate: doc.docDate, form: formFromData(doc.data) }}
            submitLabel={t('save')}
            busy={busy === 'save'}
            onSubmit={async (v) => {
              setBusy('save');
              setError(undefined);
              try {
                await api(`/documents/${id}`, { method: 'PATCH', body: { title: v.title, docDate: v.docDate, data: v.data } });
                setEditing(false);
                await load();
              } catch (e) {
                setError(errorText(e));
              } finally {
                setBusy(null);
              }
            }}
          />
        </Card>
      ) : (
        <Card>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-slate-500">{t('docs.kind')}</dt>
              <dd>{kind ? kindName(kind, locale) : ''} · {t(`docs.lang.${doc.lang}` as Key)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">{t('docs.number')}</dt>
              <dd data-testid="document-number">{doc.registrationNumber ?? t('docs.noNumber')}</dd>
            </div>
            <div>
              <dt className="text-slate-500">{t('docs.date')}</dt>
              <dd>{formatDate(doc.docDate, locale)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">{t('docs.author')}</dt>
              <dd>{nameOf(doc.authorId)}</dd>
            </div>
            {lines(t('docs.recipient'), d.recipient)}
            {lines(t('docs.chair'), d.chair)}
            {lines(t('docs.secretary'), d.secretary)}
            {lines(t('docs.preamble'), d.preamble)}
            {lines(t('docs.body'), d.body)}
            {lines(t('docs.participants'), d.participants)}
            {lines(t('docs.agenda'), d.agenda)}
            {lines(t('docs.decisions'), d.decisions)}
            {d.items && d.items.length > 0 && (
              <div className="sm:col-span-2">
                <dt className="text-slate-500">{t('docs.items')}</dt>
                <dd>
                  <ol className="list-decimal pl-5">
                    {d.items.map((i, k) => (
                      <li key={k}>{i.text}{i.responsible ? ` — ${i.responsible}` : ''}{i.due ? `, ${formatDate(i.due, locale)}` : ''}</li>
                    ))}
                  </ol>
                </dd>
              </div>
            )}
            {lines(t('docs.signer'), d.signer)}
            {doc.pdfSha256 && (
              <div className="sm:col-span-2">
                <dt className="text-slate-500">{t('docs.sha')}</dt>
                <dd className="break-all font-mono text-xs">{doc.pdfSha256}</dd>
              </div>
            )}
            {doc.docxSha256 && (
              <div className="sm:col-span-2">
                <dt className="text-slate-500">{t('docs.shaDocx')}</dt>
                <dd className="break-all font-mono text-xs">{doc.docxSha256}</dd>
              </div>
            )}
          </dl>
        </Card>
      )}

      {!editing && (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={busy !== null} onClick={() => download('docx')}>{busy === 'docx' ? t('docs.preparing') : t('docs.downloadDocx')}</Button>
          {doc.pdfEnabled && <Button variant="secondary" disabled={busy !== null} onClick={() => download('pdf')}>{busy === 'pdf' ? t('docs.preparing') : t('docs.downloadPdf')}</Button>}
          {canEdit && <Button onClick={() => setEditing(true)}>{t('docs.edit')}</Button>}
        </div>
      )}
      {!editing && <Workflow doc={doc} onChange={setDoc} />}
    </div>
  );
}
