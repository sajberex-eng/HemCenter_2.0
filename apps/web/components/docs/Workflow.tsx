'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ApprovalStepDto, DocumentDto } from '@hemcenter/shared';
import { api, apiUpload } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useChats } from '@/lib/chats';
import { useI18n } from '@/lib/i18n';
import { saveProtected } from '@/lib/download';
import type { Key } from '@/lib/dictionaries';
import { Button, Card, ErrorText, Select, useErrorText } from '../ui';

interface Row {
  approverId: string;
  parallel: boolean;
}

const rowsFromSteps = (steps: ApprovalStepDto[]): Row[] => {
  const sorted = [...steps].sort((a, b) => a.stage - b.stage);
  return sorted.map((s, i) => ({ approverId: s.approverId, parallel: i > 0 && sorted[i - 1].stage === s.stage }));
};

const STEP_STYLE: Record<string, string> = { PENDING: 'bg-amber-100 text-amber-900', APPROVED: 'bg-green-100 text-green-800', RETURNED: 'bg-red-100 text-red-800' };

/** Everything between "draft" and "registered": the route, the decisions, the scan, the number, and the history. */
export function Workflow({ doc, onChange }: { doc: DocumentDto; onChange: (d: DocumentDto) => void }) {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const { people, nameOf, ensurePeople } = useChats();
  const errorText = useErrorText();
  const [rows, setRows] = useState<Row[]>(() => rowsFromSteps(doc.steps));
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const isAuthor = user?.id === doc.authorId;
  const isSecretary = !!user?.roles.some((r) => r === 'SECRETARY' || r === 'ADMIN');
  const canSend = isAuthor && (doc.status === 'DRAFT' || doc.status === 'RETURNED');

  useEffect(() => ensurePeople([...doc.steps.map((s) => s.approverId), ...doc.actions.map((a) => a.actorId)]), [doc.steps, doc.actions, ensurePeople]);
  useEffect(() => setRows((r) => (r.length === 0 ? rowsFromSteps(doc.steps) : r)), [doc.steps]);

  const colleagues = useMemo(() => Object.values(people).filter((p) => p.isActive && p.id !== doc.authorId).sort((a, b) => a.fullName.localeCompare(b.fullName)), [people, doc.authorId]);
  const stages = useMemo(() => [...new Set(doc.steps.map((s) => s.stage))].sort((a, b) => a - b), [doc.steps]);
  const stamp = (iso: string) => new Intl.DateTimeFormat(locale === 'kk' ? 'kk-KZ' : 'ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));

  async function run(fn: () => Promise<DocumentDto>) {
    setBusy(true);
    setError(undefined);
    try {
      onChange(await fn());
      setComment('');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const send = () =>
    run(() => api<DocumentDto>(`/documents/${doc.id}/submit`, { method: 'POST', body: { route: rows.filter((r) => r.approverId).map((r) => ({ approverId: r.approverId, parallelWithPrevious: r.parallel })) } }));
  const decide = (kind: 'approve' | 'return') => {
    if (kind === 'return' && !comment.trim()) return setError(t('docs.commentRequired'));
    return run(() => api<DocumentDto>(`/documents/${doc.id}/${kind}`, { method: 'POST', body: { comment: comment.trim() || undefined } }));
  };
  const upload = (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return run(() => apiUpload<DocumentDto>(`/documents/${doc.id}/scan`, form));
  };

  return (
    <div className="space-y-4">
      <ErrorText>{error}</ErrorText>

      {canSend && (
        <Card aria-label={t('docs.route')} data-testid="route-builder">
          <h2 className="mb-2 font-medium">{t('docs.route')}</h2>
          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <div className="min-w-48 flex-1">
                  <Select aria-label={`${t('docs.approver')} ${i + 1}`} value={r.approverId} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, approverId: e.target.value } : x)))}>
                    <option value="">{t('projects.pickPerson')}</option>
                    {colleagues.map((c) => <option key={c.id} value={c.id}>{c.fullName}</option>)}
                  </Select>
                </div>
                {i > 0 && (
                  <label className="flex min-h-11 items-center gap-2 text-sm">
                    <input type="checkbox" className="h-5 w-5" checked={r.parallel} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, parallel: e.target.checked } : x)))} />
                    {t('docs.parallel')}
                  </label>
                )}
                <button type="button" className="min-h-11 rounded px-2 text-sm text-red-700 hover:bg-red-50" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                  {t('docs.removeItem')}
                </button>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => setRows([...rows, { approverId: '', parallel: false }])}>{t('docs.addApprover')}</Button>
            <Button type="button" disabled={busy || rows.length === 0 || rows.some((r) => !r.approverId)} onClick={send}>
              {doc.status === 'RETURNED' ? t('docs.resubmit') : t('docs.submit')}
            </Button>
          </div>
        </Card>
      )}

      {doc.steps.length > 0 && (
        <Card aria-label={t('docs.approval')} data-testid="steps">
          <h2 className="mb-2 font-medium">{t('docs.approval')}</h2>
          <ol className="space-y-3">
            {stages.map((st) => (
              <li key={st}>
                <div className="text-xs text-slate-500">{t('docs.stage', { n: st })}</div>
                <ul className="divide-y divide-slate-100">
                  {doc.steps.filter((s) => s.stage === st).map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-sm" data-testid="step">
                      <span>{nameOf(s.approverId)}{s.comment ? <span className="text-slate-600"> — {s.comment}</span> : null}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STEP_STYLE[s.status]}`}>{t(`docs.step.${s.status}` as Key)}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </Card>
      )}

      {doc.awaitingMe && (
        <Card data-testid="decide">
          <p className="mb-2 text-sm font-medium">{t('docs.yourTurn')}</p>
          <textarea aria-label={t('docs.comment')} rows={2} maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)} className="mb-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-base" />
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={busy} onClick={() => decide('approve')}>{t('docs.approve')}</Button>
            <Button type="button" variant="danger" disabled={busy} onClick={() => decide('return')}>{t('docs.return')}</Button>
          </div>
        </Card>
      )}

      {(doc.status === 'APPROVED' || doc.status === 'SIGNED' || doc.scan) && (
        <Card aria-label={t('docs.scan')} data-testid="scan-card">
          <h2 className="mb-1 font-medium">{t('docs.scan')}</h2>
          {doc.status === 'APPROVED' && <p className="mb-2 text-sm text-slate-600">{t('docs.printHint')}</p>}
          {doc.status === 'SIGNED' && <p className="mb-2 text-sm text-slate-600">{t('docs.registerHint')}</p>}
          {doc.scan && (
            <p className="mb-2 text-sm">
              <button type="button" className="text-teal-800 underline" onClick={() => void saveProtected(`/documents/${doc.id}/scan`, doc.scan!.name)}>{t('docs.downloadScan')}: {doc.scan.name}</button>
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {(isAuthor || isSecretary) && (doc.status === 'APPROVED' || doc.status === 'SIGNED') && (
              <label className="inline-flex min-h-11 cursor-pointer items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium hover:bg-slate-50">
                {doc.scan ? t('docs.replaceScan') : t('docs.uploadScan')}
                <input type="file" accept="application/pdf,image/png,image/jpeg" className="sr-only" aria-label={doc.scan ? t('docs.replaceScan') : t('docs.uploadScan')} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f); }} />
              </label>
            )}
            {isSecretary && doc.status === 'SIGNED' && (
              <Button type="button" disabled={busy} onClick={() => confirm(t('docs.confirmRegister')) && run(() => api<DocumentDto>(`/documents/${doc.id}/register`, { method: 'POST' }))}>
                {t('docs.register')}
              </Button>
            )}
          </div>
        </Card>
      )}

      {doc.actions.length > 0 && (
        <Card aria-label={t('docs.sheet')} data-testid="sheet">
          <h2 className="mb-2 font-medium">{t('docs.sheet')}</h2>
          <ul className="space-y-1 text-sm">
            {doc.actions.map((a) => (
              <li key={a.id} data-testid="sheet-line">
                <span className="text-slate-500">{stamp(a.at)} · {t('docs.round', { n: a.round })} · </span>
                <span className="font-medium">{nameOf(a.actorId)}</span>: {t(`docs.action.${a.kind}` as Key)}
                {a.comment && a.kind !== 'REGISTER' ? <span className="text-slate-700"> — {a.comment}</span> : null}
                {a.kind === 'REGISTER' && a.comment ? <span className="text-slate-700"> № {a.comment}</span> : null}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
