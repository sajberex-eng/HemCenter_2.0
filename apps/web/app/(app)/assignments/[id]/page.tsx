'use client';

import Link from 'next/link';
import { use, useCallback, useEffect, useState } from 'react';
import type { AssignmentDto, ExecutionReportDto } from '@hemcenter/shared';
import { api, apiUpload } from '@/lib/api';
import { useChats } from '@/lib/chats';
import { useI18n } from '@/lib/i18n';
import { formatDate } from '@/lib/chatUtils';
import { saveProtected } from '@/lib/download';
import { STATUS_STYLE } from '@/lib/assignments';
import type { Key } from '@/lib/dictionaries';
import { Button, Card, ErrorText, Field, Input, PageTitle, useErrorText } from '@/components/ui';

export default function AssignmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t, locale } = useI18n();
  const { nameOf, ensurePeople, subscribe } = useChats();
  const errorText = useErrorText();
  const [a, setA] = useState<AssignmentDto>();
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [reportText, setReportText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [fileKey, setFileKey] = useState(0);
  const [due, setDue] = useState({ newDue: '', reason: '' });
  const [note, setNote] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const x = await api<AssignmentDto>(`/assignments/${id}`);
      setA(x);
      ensurePeople([x.responsibleId, x.controllerId, x.createdById, ...x.coResponsibleIds, ...x.reports.map((r) => r.authorId), ...x.events.map((e) => e.actorId)]);
    } catch {
      setMissing(true);
    }
  }, [id, ensurePeople]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => subscribe((e) => { if (e.type === 'notification:new') void load(); }), [subscribe, load]);

  async function run(fn: () => Promise<AssignmentDto>, after?: () => void) {
    setBusy(true);
    setError(undefined);
    try {
      setA(await fn());
      after?.();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  if (missing) return <p className="p-6 text-slate-600">{t('err.ASSIGNMENT_NOT_FOUND')}</p>;
  if (!a) return <p className="p-6 text-slate-500">{t('loading')}</p>;
  const pending: ExecutionReportDto | undefined = a.reports.find((r) => r.status === 'PENDING');
  const pendingDue = a.dueChanges.find((d) => d.status === 'PENDING');
  const post = (path: string, body?: unknown) => () => api<AssignmentDto>(`/assignments/${id}/${path}`, { method: 'POST', body: body ?? {} });

  function sendReport() {
    const form = new FormData();
    form.append('text', reportText);
    files.forEach((f) => form.append('files', f));
    return run(() => apiUpload<AssignmentDto>(`/assignments/${id}/report`, form), () => {
      setReportText('');
      setFiles([]);
      setFileKey((k) => k + 1);
    });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href="/assignments" className="text-sm text-teal-800 underline">‹ {t('asg.title')}</Link>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <PageTitle>{a.text}</PageTitle>
        <span className="flex items-center gap-2">
          {a.overdue && <span className="rounded-full bg-red-100 px-3 py-1 text-sm font-medium text-red-800" data-testid="overdue">{t('asg.overdue')}</span>}
          <span className={`rounded-full px-3 py-1 text-sm font-medium ${STATUS_STYLE[a.status]}`} data-testid="assignment-status">{t(`asg.status.${a.status}` as Key)}</span>
        </span>
      </div>
      <ErrorText>{error}</ErrorText>

      <Card>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div><dt className="text-slate-500">{t('asg.responsible')}</dt><dd>{nameOf(a.responsibleId)}</dd></div>
          <div><dt className="text-slate-500">{t('asg.controller')}</dt><dd>{nameOf(a.controllerId)}</dd></div>
          <div><dt className="text-slate-500">{t('asg.due')}</dt><dd data-testid="due">{formatDate(a.dueDate, locale)}</dd></div>
          {a.originalDue !== a.dueDate && <div><dt className="text-slate-500">{t('asg.originalDue')}</dt><dd>{formatDate(a.originalDue, locale)}</dd></div>}
          {a.coResponsibleIds.length > 0 && <div><dt className="text-slate-500">{t('asg.co')}</dt><dd>{a.coResponsibleIds.map(nameOf).join(', ')}</dd></div>}
          <div>
            <dt className="text-slate-500">{t('asg.source')}</dt>
            <dd className="flex flex-wrap gap-3">
              {t(`asg.source.${a.sourceKind}` as Key)}
              {a.sourceDocumentId && <Link className="text-teal-800 underline" href={`/documents/${a.sourceDocumentId}`}>{t('asg.openDocument')}</Link>}
              {a.sourceChatId && <Link className="text-teal-800 underline" href={`/chats/${a.sourceChatId}`}>{t('asg.openChat')}</Link>}
            </dd>
          </div>
          {a.removedReason && <div className="sm:col-span-2 text-slate-700">{t('asg.removedBecause', { reason: a.removedReason })}</div>}
        </dl>
      </Card>

      {a.can.start && <Button disabled={busy} onClick={() => run(post('start'))}>{t('asg.start')}</Button>}

      {a.can.report && (
        <Card data-testid="report-form">
          <Field label={t('asg.reportText')}>
            <textarea aria-label={t('asg.reportText')} rows={3} maxLength={4000} value={reportText} onChange={(e) => setReportText(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base" />
          </Field>
          <div className="mt-2">
            <label className="text-sm text-slate-600">{t('asg.files')}</label>
            <input key={fileKey} type="file" multiple aria-label={t('asg.files')} className="mt-1 block w-full text-sm" onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 5))} />
          </div>
          <div className="mt-3"><Button disabled={busy || !reportText.trim()} onClick={sendReport}>{t('asg.report')}</Button></div>
        </Card>
      )}

      {a.reports.length > 0 && (
        <Card aria-label={t('asg.reports')}>
          <h2 className="mb-2 font-medium">{t('asg.reports')}</h2>
          <ul className="space-y-3">
            {a.reports.map((r) => (
              <li key={r.id} className="border-t border-slate-100 pt-2 first:border-0 first:pt-0" data-testid="report">
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="font-medium">{nameOf(r.authorId)}</span>
                  <span className="text-xs text-slate-600" data-testid="report-status">{t(`asg.report.${r.status}` as Key)}</span>
                </div>
                <p className="whitespace-pre-wrap text-sm">{r.text}</p>
                {r.files.map((f) => (
                  <button key={f.id} type="button" className="mr-3 text-sm text-teal-800 underline" onClick={() => void saveProtected(`/report-files/${f.id}`, f.name)}>📎 {f.name}</button>
                ))}
                {r.reviewComment && <p className="mt-1 text-sm text-slate-700">{nameOf(r.reviewerId ?? '')}: {r.reviewComment}</p>}
              </li>
            ))}
          </ul>
          {a.can.review && pending && (
            <div className="mt-3 space-y-2" data-testid="review">
              <textarea aria-label={t('asg.comment')} rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base" />
              <div className="flex flex-wrap gap-2">
                <Button disabled={busy} onClick={() => run(post(`reports/${pending.id}/accept`, { comment: note || undefined }), () => setNote(''))}>{t('asg.accept')}</Button>
                <Button variant="danger" disabled={busy} onClick={() => (note.trim() ? run(post(`reports/${pending.id}/return`, { comment: note }), () => setNote('')) : setError(t('err.COMMENT_REQUIRED')))}>{t('asg.returnReport')}</Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {(a.dueChanges.length > 0 || a.can.requestDue) && (
        <Card aria-label={t('asg.dueRequests')} data-testid="due-card">
          <h2 className="mb-2 font-medium">{t('asg.dueRequests')}</h2>
          <ul className="space-y-1 text-sm">
            {a.dueChanges.map((d) => (
              <li key={d.id} data-testid="due-change">
                {formatDate(d.oldDue, locale)} → {formatDate(d.newDue, locale)} · {d.reason} · <span className="text-slate-600">{t(`asg.dueStatus.${d.status}` as Key)}</span>
                {d.decisionNote ? <span className="text-slate-700"> — {d.decisionNote}</span> : null}
              </li>
            ))}
          </ul>
          {a.can.decideDue && pendingDue && (
            <div className="mt-2 space-y-2">
              <Input aria-label={t('asg.comment')} placeholder={t('asg.comment')} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="flex gap-2">
                <Button disabled={busy} onClick={() => run(post(`due-requests/${pendingDue.id}/approve`, { comment: note || undefined }), () => setNote(''))}>{t('asg.approve')}</Button>
                <Button variant="danger" disabled={busy} onClick={() => run(post(`due-requests/${pendingDue.id}/reject`, { comment: note || undefined }), () => setNote(''))}>{t('asg.reject')}</Button>
              </div>
            </div>
          )}
          {a.can.requestDue && (
            <div className="mt-3 space-y-2">
              <div className="flex flex-wrap gap-2">
                <Input type="date" aria-label={t('asg.newDue')} value={due.newDue} onChange={(e) => setDue({ ...due, newDue: e.target.value })} className="w-44" />
                <div className="min-w-48 flex-1"><Input aria-label={t('asg.reason')} placeholder={t('asg.reason')} maxLength={2000} value={due.reason} onChange={(e) => setDue({ ...due, reason: e.target.value })} /></div>
              </div>
              <Button variant="secondary" disabled={busy || !due.newDue || !due.reason.trim()} onClick={() => run(() => api<AssignmentDto>(`/assignments/${id}/due-requests`, { method: 'POST', body: { newDue: due.newDue, reason: due.reason } }), () => setDue({ newDue: '', reason: '' }))}>{t('asg.requestDue')}</Button>
            </div>
          )}
        </Card>
      )}

      {a.can.remove && (
        <div>
          {removing === null ? (
            <Button variant="danger" onClick={() => setRemoving('')}>{t('asg.remove')}</Button>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-48 flex-1"><Input aria-label={t('asg.removeReason')} placeholder={t('asg.removeReason')} maxLength={2000} value={removing} onChange={(e) => setRemoving(e.target.value)} /></div>
              <Button variant="danger" disabled={busy || !removing.trim()} onClick={() => run(post('remove', { reason: removing }), () => setRemoving(null))}>{t('asg.remove')}</Button>
              <Button variant="secondary" onClick={() => setRemoving(null)}>{t('cancel')}</Button>
            </div>
          )}
        </div>
      )}

      <Card aria-label={t('asg.history')}>
        <h2 className="mb-2 font-medium">{t('asg.history')}</h2>
        <ul className="space-y-1 text-sm">
          {a.events.map((e) => (
            <li key={e.id} data-testid="event">
              <span className="text-slate-500">{new Intl.DateTimeFormat(locale === 'kk' ? 'kk-KZ' : 'ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(e.at))} · </span>
              <span className="font-medium">{nameOf(e.actorId)}</span>: {t(`asg.event.${e.kind}` as Key)}
              {e.comment ? <span className="text-slate-700"> — {e.comment}</span> : null}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
