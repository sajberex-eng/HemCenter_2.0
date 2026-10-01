'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { UserDto } from '@hemcenter/shared';
import { api, apiUpload } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Button, Card, ErrorText, Field, Input, PageTitle, Select, useErrorText } from '@/components/ui';

interface Suggestion {
  userId: string;
  fullName: string;
  score: number;
}
interface Preview {
  sessionId: string;
  fileName: string;
  title: string;
  dateOrder: 'DMY' | 'MDY';
  dateOrderAmbiguous: boolean;
  timeZone: string;
  counts: { messages: number; systemNotices: number; skippedLines: number; files: number; filesFound: number; filesMissing: number; filesBlocked: number; omittedMedia: number };
  range: { from: string; to: string } | null;
  authors: { name: string; count: number; suggestions: Suggestion[]; preselected: string | null }[];
  sample: { first: { at: string; author: string; text: string }[]; last: { at: string; author: string; text: string }[] };
}
interface Result {
  chatId: string;
  messages: number;
  files: number;
  members: number;
  outsiders: number;
}

const ZONES = ['Asia/Almaty', 'Asia/Aqtau', 'Asia/Aqtobe', 'Asia/Oral', 'Europe/Moscow', 'UTC'];

export default function ImportPage() {
  const { t, locale } = useI18n();
  const errorText = useErrorText();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [staff, setStaff] = useState<UserDto[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({}); // '' = outside participant
  const [title, setTitle] = useState('');
  const [order, setOrder] = useState<'DMY' | 'MDY'>('DMY');
  const [zone, setZone] = useState('Asia/Almaty');
  const [busy, setBusy] = useState<'upload' | 'import' | null>(null);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<Result | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api<UserDto[]>('/users').then((u) => setStaff(u.sort((a, b) => a.fullName.localeCompare(b.fullName)))).catch(() => undefined);
  }, []);

  function adopt(p: Preview, keepMapping = false) {
    setPreview(p);
    setOrder(p.dateOrder);
    setZone(p.timeZone);
    if (!keepMapping) {
      setTitle(p.title);
      setMapping(Object.fromEntries(p.authors.map((a) => [a.name, a.preselected ?? ''])));
    }
  }

  async function onFile(file: File) {
    setError(undefined);
    setResult(null);
    setBusy('upload');
    try {
      const form = new FormData();
      form.append('file', file, file.name);
      adopt(await apiUpload<Preview>('/import/whatsapp', form));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
      if (picker.current) picker.current.value = '';
    }
  }

  async function recalc() {
    if (!preview) return;
    setError(undefined);
    try {
      adopt(await api<Preview>(`/import/whatsapp/${preview.sessionId}?order=${order}&tz=${encodeURIComponent(zone)}`), true);
    } catch (e) {
      setError(errorText(e));
    }
  }

  const members = useMemo(() => new Set(Object.values(mapping).filter(Boolean)).size, [mapping]);

  async function run() {
    if (!preview || !confirm(t('import.confirm', { title, n: preview.counts.messages }))) return;
    setError(undefined);
    setBusy('import');
    try {
      const res = await api<Result>(`/import/whatsapp/${preview.sessionId}/commit`, {
        method: 'POST',
        body: { title: title.trim(), mapping: Object.fromEntries(Object.entries(mapping).map(([n, id]) => [n, id || null])), dateOrder: order, timeZone: zone },
      });
      setResult(res);
      setPreview(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  async function cancel() {
    if (preview) await api(`/import/whatsapp/${preview.sessionId}`, { method: 'DELETE' }).catch(() => undefined);
    setPreview(null);
    setError(undefined);
  }

  const fmt = (iso: string) => new Intl.DateTimeFormat(locale === 'kk' ? 'kk-KZ' : 'ru-RU', { dateStyle: 'short', timeStyle: 'short', timeZone: zone }).format(new Date(iso));

  return (
    <div className="space-y-4">
      <PageTitle>{t('import.title')}</PageTitle>
      <ErrorText>{error}</ErrorText>

      {result && (
        <Card className="space-y-3 border-teal-300 bg-teal-50" data-testid="import-done">
          <h2 className="font-medium">{t('import.done')}</h2>
          <p className="text-sm">{t('import.doneText', { messages: result.messages, files: result.files, members: result.members, outsiders: result.outsiders })}</p>
          <p className="text-xs text-slate-600">{t('import.privacy')}</p>
          <Button variant="secondary" onClick={() => setResult(null)}>{t('import.again')}</Button>
        </Card>
      )}

      {!preview && !result && (
        <Card className="space-y-3">
          <p className="text-sm text-slate-700">{t('import.how')}</p>
          <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">{t('import.privacy')}</p>
          <input ref={picker} type="file" accept=".zip,.txt,application/zip,text/plain" hidden data-testid="import-file" onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} />
          <Button disabled={busy !== null} onClick={() => picker.current?.click()}>{t('import.choose')}</Button>
          {busy === 'upload' && <p role="status" className="text-sm text-slate-600">{t('import.analyzing')}</p>}
        </Card>
      )}

      {preview && (
        <>
          <Card className="space-y-3">
            <h2 className="font-medium">{t('import.summary')} — {preview.fileName}</h2>
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div><dt className="text-slate-500">{t('import.messages')}</dt><dd className="text-lg font-semibold" data-testid="import-count">{preview.counts.messages}</dd></div>
              <div>
                <dt className="text-slate-500">{t('import.files')}</dt>
                <dd className="text-lg font-semibold">{preview.counts.files}</dd>
                <dd className="text-xs text-slate-500">{t('import.filesFound')}: {preview.counts.filesFound}; {t('import.filesSkipped')}: {preview.counts.filesBlocked + preview.counts.filesMissing}</dd>
              </div>
              <div className="col-span-2"><dt className="text-slate-500">{t('import.period')}</dt><dd>{preview.range ? `${fmt(preview.range.from)} — ${fmt(preview.range.to)}` : '—'}</dd></div>
            </dl>
            <p className="text-xs text-slate-500">
              {t('import.system')}: {preview.counts.systemNotices} · {t('import.unreadable')}: {preview.counts.skippedLines}
            </p>
          </Card>

          <Card className="space-y-3" data-testid="date-order">
            <h2 className="font-medium">{t('import.dateOrder')}</h2>
            {preview.dateOrderAmbiguous && <p role="note" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">{t('import.dateOrderAmbiguous')}</p>}
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={t('import.dateOrder')}>
                <Select value={order} onChange={(e) => setOrder(e.target.value as 'DMY' | 'MDY')}>
                  <option value="DMY">{t('import.dmy')}</option>
                  <option value="MDY">{t('import.mdy')}</option>
                </Select>
              </Field>
              <Field label={t('import.timeZone')}>
                <Select value={zone} onChange={(e) => setZone(e.target.value)}>
                  {ZONES.map((z) => <option key={z} value={z}>{z}</option>)}
                </Select>
              </Field>
              <div className="flex items-end">
                <Button variant="secondary" onClick={recalc}>{t('import.recalc')}</Button>
              </div>
            </div>
            <details>
              <summary className="cursor-pointer text-sm text-teal-800">{t('import.sample')}</summary>
              <div className="mt-2 grid gap-3 text-xs sm:grid-cols-2">
                {([['import.sampleFirst', preview.sample.first], ['import.sampleLast', preview.sample.last]] as const).map(([label, lines]) => (
                  <div key={label}>
                    <div className="mb-1 font-medium text-slate-600">{t(label)}</div>
                    <ul className="space-y-1">
                      {lines.map((l, i) => (
                        <li key={i} className="rounded bg-slate-50 px-2 py-1">
                          <span className="text-slate-500">{fmt(l.at)}</span> <span className="font-medium">{l.author}:</span> {l.text}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </details>
          </Card>

          <Card className="space-y-3">
            <h2 className="font-medium">{t('import.authors')}</h2>
            <p className="text-sm text-slate-600">{t('import.authorsHint')}</p>
            <ul className="divide-y divide-slate-100">
              {preview.authors.map((a) => {
                const suggestedIds = new Set(a.suggestions.map((s) => s.userId));
                return (
                  <li key={a.name} className="grid gap-2 py-3 sm:grid-cols-[1fr_1fr] sm:items-center" data-testid="author-row">
                    <div>
                      <div className="font-medium">{a.name}</div>
                      <div className="text-xs text-slate-500">{t('import.messages')}: {a.count}</div>
                    </div>
                    <Select aria-label={a.name} value={mapping[a.name] ?? ''} onChange={(e) => setMapping({ ...mapping, [a.name]: e.target.value })}>
                      <option value="">{t('import.outside')}</option>
                      {a.suggestions.length > 0 && (
                        <optgroup label={t('import.suggested')}>
                          {a.suggestions.map((s) => <option key={s.userId} value={s.userId}>{s.fullName}</option>)}
                        </optgroup>
                      )}
                      <optgroup label={t('import.everyone')}>
                        {staff.filter((u) => !suggestedIds.has(u.id)).map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
                      </optgroup>
                    </Select>
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card className="space-y-3">
            <Field label={t('import.chatTitle')}>
              <Input value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <p className="text-sm text-slate-700" data-testid="import-members">{t('import.members', { n: members })}</p>
            {members === 0 && <p role="note" className="text-sm text-amber-800">{t('import.needMembers')}</p>}
            {busy === 'import' && <p role="status" className="text-sm text-slate-600">{t('import.running')}</p>}
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy !== null || members === 0 || !title.trim()} onClick={run}>{t('import.run')}</Button>
              <Button variant="secondary" disabled={busy !== null} onClick={cancel}>{t('import.cancel')}</Button>
            </div>
          </Card>
        </>
      )}

      {result && (
        <Link href={`/chats`} className="inline-block text-sm text-teal-800 underline">{t('import.open')}</Link>
      )}
    </div>
  );
}
