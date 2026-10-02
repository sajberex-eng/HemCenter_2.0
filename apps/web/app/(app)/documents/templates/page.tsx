'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { LOCALES, type DocumentKindDto, type DocumentTemplateDto } from '@hemcenter/shared';
import { api, apiUpload, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { saveProtected } from '@/lib/download';
import { kindName } from '@/lib/docs';
import type { Key } from '@/lib/dictionaries';
import { Button, Card, ErrorText, Field, Input, PageTitle, useErrorText } from '@/components/ui';

export default function TemplatesPage() {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const errorText = useErrorText();
  const [kinds, setKinds] = useState<DocumentKindDto[]>([]);
  const [templates, setTemplates] = useState<DocumentTemplateDto[]>([]);
  const [error, setError] = useState<string>();
  const [details, setDetails] = useState<string[]>([]);
  const [notice, setNotice] = useState<string>();
  const [newKind, setNewKind] = useState({ nameRu: '', nameKk: '', prefix: '' });
  const allowed = !!user?.roles.some((r) => r === 'SECRETARY' || r === 'ADMIN');

  const load = useCallback(async () => {
    const [k, tp] = await Promise.all([api<DocumentKindDto[]>('/document-kinds?all=1'), api<DocumentTemplateDto[]>('/document-templates')]);
    setKinds(k);
    setTemplates(tp);
  }, []);
  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  async function upload(kindId: string, lang: string, file: File) {
    setError(undefined);
    setDetails([]);
    setNotice(undefined);
    const form = new FormData();
    form.append('kindId', kindId);
    form.append('lang', lang);
    form.append('file', file);
    try {
      await apiUpload('/document-templates', form);
      setNotice(t('docs.uploaded'));
      await load();
    } catch (e) {
      setError(errorText(e));
      if (e instanceof ApiError) setDetails(e.details);
    }
  }

  async function addKind(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    try {
      await api('/document-kinds', { method: 'POST', body: newKind });
      setNewKind({ nameRu: '', nameKk: '', prefix: '' });
      await load();
    } catch (err) {
      setError(errorText(err));
    }
  }

  if (!allowed) return <p className="p-6 text-slate-600">{t('err.FORBIDDEN')}</p>;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href="/documents" className="text-sm text-teal-800 underline">‹ {t('docs.title')}</Link>
      <PageTitle>{t('docs.templatesTitle')}</PageTitle>
      <p className="text-sm text-slate-600">{t('docs.templatesHint')}</p>
      <ErrorText>{error}</ErrorText>
      {details.length > 0 && <ul className="list-disc pl-5 text-sm text-red-800">{details.map((d, i) => <li key={i}>{d}</li>)}</ul>}
      {notice && <p role="status" className="text-sm text-green-800">{notice}</p>}

      {kinds.map((k) => (
        <Card key={k.id} data-testid="kind-card">
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <h2 className="font-medium">{kindName(k, locale)}</h2>
            <span className="text-sm text-slate-500">{k.prefix}</span>
          </div>
          {LOCALES.map((lang) => {
            const versions = templates.filter((x) => x.kindId === k.id && x.lang === lang).sort((a, b) => b.version - a.version);
            return (
              <div key={lang} className="border-t border-slate-100 py-2" data-testid={`templates-${lang}`}>
                <div className="mb-1 text-sm font-medium">{t(`docs.lang.${lang}` as Key)}</div>
                <ul className="mb-2 space-y-1 text-sm">
                  {versions.map((v, i) => (
                    <li key={v.id} className="flex items-center justify-between gap-2">
                      <span>{t('docs.version', { n: v.version })} {i === 0 && <span className="rounded bg-teal-100 px-1.5 text-xs text-teal-800">{t('docs.activeVersion')}</span>}</span>
                      <button type="button" className="min-h-9 rounded px-2 text-teal-800 underline" onClick={() => void saveProtected(`/document-templates/${v.id}/file`, `${kindName(k, locale)} (${lang}) v${v.version}.docx`)}>
                        {t('docs.downloadDocx')}
                      </button>
                    </li>
                  ))}
                </ul>
                <label className="inline-flex min-h-11 cursor-pointer items-center rounded-lg border border-slate-300 bg-white px-3 text-sm hover:bg-slate-50">
                  {t('docs.upload')}
                  <input
                    type="file"
                    accept=".docx"
                    className="sr-only"
                    aria-label={`${t('docs.upload')}: ${kindName(k, locale)} (${lang})`}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      if (f) void upload(k.id, lang, f);
                    }}
                  />
                </label>
              </div>
            );
          })}
        </Card>
      ))}

      <Card>
        <form onSubmit={addKind} className="space-y-3">
          <h2 className="font-medium">{t('docs.newKind')}</h2>
          <Field label={t('docs.kindNameRu')}><Input required maxLength={150} value={newKind.nameRu} onChange={(e) => setNewKind({ ...newKind, nameRu: e.target.value })} aria-label={t('docs.kindNameRu')} /></Field>
          <Field label={t('docs.kindNameKk')}><Input required maxLength={150} value={newKind.nameKk} onChange={(e) => setNewKind({ ...newKind, nameKk: e.target.value })} aria-label={t('docs.kindNameKk')} /></Field>
          <Field label={t('docs.kindPrefix')}><Input required maxLength={8} value={newKind.prefix} onChange={(e) => setNewKind({ ...newKind, prefix: e.target.value })} aria-label={t('docs.kindPrefix')} className="max-w-32" /></Field>
          <Button type="submit" disabled={!newKind.nameRu.trim() || !newKind.nameKk.trim() || !newKind.prefix.trim()}>{t('create')}</Button>
        </form>
      </Card>
    </div>
  );
}
