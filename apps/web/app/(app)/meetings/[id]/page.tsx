'use client';

import Link from 'next/link';
import { use, useCallback, useEffect, useMemo, useState } from 'react';
import { LOCALES, MEETING_STATUSES, type DocumentDto, type Locale, type MeetingDto, type MeetingItemDto, type MeetingStatus } from '@hemcenter/shared';
import { api } from '@/lib/api';
import { useChats } from '@/lib/chats';
import { useI18n } from '@/lib/i18n';
import { formatDate } from '@/lib/chatUtils';
import type { Key } from '@/lib/dictionaries';
import { Button, Card, ErrorText, Field, Input, PageTitle, Select, useErrorText } from '@/components/ui';
import { formatWhen } from '../page';

export default function MeetingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t, locale } = useI18n();
  const { people, nameOf, ensurePeople } = useChats();
  const errorText = useErrorText();
  const [m, setM] = useState<MeetingDto>();
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string>();
  const [lang, setLang] = useState<Locale>(locale);
  const [newItem, setNewItem] = useState('');
  const [protocolId, setProtocolId] = useState<string | null>(null);

  useEffect(() => {
    api<MeetingDto>(`/meetings/${id}`).then(
      (x) => {
        setM(x);
        ensurePeople([...x.participantIds, x.chairId, x.secretaryId]);
      },
      () => setMissing(true),
    );
  }, [id, ensurePeople]);

  const run = useCallback(
    async (fn: () => Promise<MeetingDto>) => {
      setError(undefined);
      try {
        setM(await fn());
      } catch (e) {
        setError(errorText(e));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const addable = useMemo(() => Object.values(people).filter((p) => p.isActive && !m?.participantIds.includes(p.id)).sort((a, b) => a.fullName.localeCompare(b.fullName)), [people, m?.participantIds]);

  if (missing) return <p className="p-6 text-slate-600">{t('err.MEETING_NOT_FOUND')}</p>;
  if (!m) return <p className="p-6 text-slate-500">{t('loading')}</p>;
  const locked = m.protocolStatus !== null && m.protocolStatus !== 'DRAFT' && m.protocolStatus !== 'RETURNED';
  const edit = m.canEdit && !locked;

  async function makeProtocol() {
    setError(undefined);
    try {
      const r = await api<{ documentId: string; meeting: MeetingDto }>(`/meetings/${id}/protocol`, { method: 'POST', body: { lang } });
      setM(r.meeting);
      setProtocolId(r.documentId);
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href="/meetings" className="text-sm text-teal-800 underline">‹ {t('meet.title')}</Link>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PageTitle>{m.subject}</PageTitle>
        <Link href={`/chats/${m.chatId}`} className="inline-flex min-h-11 items-center rounded-lg bg-teal-700 px-4 text-sm font-medium text-white hover:bg-teal-800">{t('meet.openChat')}</Link>
      </div>
      <ErrorText>{error}</ErrorText>
      {locked && <p role="note" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="locked-note">{t('meet.protocolLocked')}</p>}

      <Card>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div><dt className="text-slate-500">{t('meet.startsAt')}</dt><dd>{formatWhen(m.startsAt, locale)}</dd></div>
          {m.place && <div><dt className="text-slate-500">{t('meet.place')}</dt><dd>{m.place}</dd></div>}
          <div><dt className="text-slate-500">{t('meet.chair')}</dt><dd>{nameOf(m.chairId)}</dd></div>
          <div><dt className="text-slate-500">{t('meet.secretary')}</dt><dd>{nameOf(m.secretaryId)}</dd></div>
          <div>
            <dt className="text-slate-500">{t('projects.status')}</dt>
            <dd>
              {m.canEdit ? (
                <Select aria-label={t('projects.status')} value={m.status} onChange={(e) => run(() => api<MeetingDto>(`/meetings/${id}`, { method: 'PATCH', body: { status: e.target.value as MeetingStatus } }))}>
                  {MEETING_STATUSES.map((s) => <option key={s} value={s}>{t(`meet.status.${s}` as Key)}</option>)}
                </Select>
              ) : t(`meet.status.${m.status}` as Key)}
            </dd>
          </div>
        </dl>
        <div className="mt-3">
          <div className="text-sm text-slate-500">{t('meet.participants')}</div>
          <ul className="mt-1 flex flex-wrap gap-2" data-testid="participants">
            {m.participantIds.map((p) => (
              <li key={p} className="flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-sm">
                {nameOf(p)}
                {edit && ![m.chairId, m.secretaryId, m.createdById].includes(p) && (
                  <button type="button" aria-label={`${t('projects.removeMember')}: ${nameOf(p)}`} className="text-slate-500 hover:text-red-700" onClick={() => run(() => api<MeetingDto>(`/meetings/${id}/participants/${p}`, { method: 'DELETE' }))}>×</button>
                )}
              </li>
            ))}
          </ul>
          {edit && (
            <div className="mt-2 max-w-sm">
              <Select aria-label={t('meet.addParticipant')} value="" onChange={(e) => e.target.value && run(() => api<MeetingDto>(`/meetings/${id}/participants/${e.target.value}`, { method: 'PUT' }))}>
                <option value="">{t('meet.addParticipant')}</option>
                {addable.map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}
              </Select>
            </div>
          )}
        </div>
      </Card>

      <section aria-label={t('meet.agendaTitle')} className="space-y-3">
        <h2 className="font-medium">{t('meet.agendaTitle')}</h2>
        {m.items.length === 0 && <p className="text-sm text-slate-500">{t('meet.noItems')}</p>}
        {m.items.map((item) => (
          <Item key={item.id} meeting={m} item={item} edit={edit} run={run} />
        ))}
        {edit && (
          <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); const title = newItem; setNewItem(''); void run(() => api<MeetingDto>(`/meetings/${id}/items`, { method: 'POST', body: { title } })); }}>
            <div className="min-w-48 flex-1"><Input aria-label={t('meet.itemTitle')} placeholder={t('meet.itemTitle')} maxLength={500} value={newItem} onChange={(e) => setNewItem(e.target.value)} /></div>
            <Button type="submit" variant="secondary" disabled={!newItem.trim()}>{t('meet.addItem')}</Button>
          </form>
        )}
      </section>

      {m.canEdit && (
        <Card data-testid="protocol-card">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-48">
              <Field label={t('meet.protocolLang')}>
                <Select aria-label={t('meet.protocolLang')} value={lang} onChange={(e) => setLang(e.target.value as Locale)}>
                  {LOCALES.map((l) => <option key={l} value={l}>{t(`docs.lang.${l}` as Key)}</option>)}
                </Select>
              </Field>
            </div>
            {!locked && <Button type="button" onClick={makeProtocol}>{m.protocolId ? t('meet.refreshProtocol') : t('meet.makeProtocol')}</Button>}
            {(m.protocolId || protocolId) && (
              <Link href={`/documents/${m.protocolId ?? protocolId}`} className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium hover:bg-slate-50">{t('meet.openProtocol')}</Link>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

function Item({ meeting, item, edit, run }: { meeting: MeetingDto; item: MeetingItemDto; edit: boolean; run: (fn: () => Promise<MeetingDto>) => Promise<void> }) {
  const { t, locale } = useI18n();
  const { nameOf } = useChats();
  const [heard, setHeard] = useState(item.heard ?? '');
  const [form, setForm] = useState<{ kind: 'DECISION' | 'INSTRUCTION'; text: string; responsibleId: string; due: string; decisionId: string } | null>(null);
  const base = `/meetings/${meeting.id}`;
  const used = new Set(meeting.items.flatMap((i) => i.resolutions.map((r) => r.decisionId)));

  return (
    <Card data-testid="agenda-item">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-medium">{item.position}. {item.title}</h3>
        {edit && (
          <button type="button" className="min-h-9 rounded px-2 text-sm text-red-700 hover:bg-red-50" onClick={() => confirm(t('confirmDelete')) && run(() => api<MeetingDto>(`${base}/items/${item.id}`, { method: 'DELETE' }))}>{t('delete')}</button>
        )}
      </div>
      {edit ? (
        <Field label={t('meet.heard')}>
          <textarea aria-label={`${t('meet.heard')}: ${item.title}`} rows={2} maxLength={4000} value={heard} onChange={(e) => setHeard(e.target.value)} onBlur={() => heard !== (item.heard ?? '') && run(() => api<MeetingDto>(`${base}/items/${item.id}`, { method: 'PATCH', body: { heard } }))} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base" />
        </Field>
      ) : (
        item.heard && <p className="mt-1 whitespace-pre-wrap text-sm"><span className="text-slate-500">{t('meet.heard')}: </span>{item.heard}</p>
      )}

      <ul className="mt-2 space-y-1 text-sm">
        {item.resolutions.map((r) => (
          <li key={r.id} data-testid="resolution" className="flex flex-wrap items-start justify-between gap-2 border-t border-slate-100 pt-1">
            <span>
              <span className="font-medium">{r.kind === 'DECISION' ? t('meet.decided') : t('meet.instructed')}:</span> {r.text}
              {r.kind === 'INSTRUCTION' && <span className="text-slate-600"> — {r.responsibleId ? nameOf(r.responsibleId) : ''}{r.due ? `, ${formatDate(r.due, locale)}` : ''}</span>}
            </span>
            {edit && <button type="button" className="min-h-9 rounded px-2 text-red-700 hover:bg-red-50" onClick={() => run(() => api<MeetingDto>(`${base}/resolutions/${r.id}`, { method: 'DELETE' }))}>{t('delete')}</button>}
          </li>
        ))}
      </ul>

      {edit && !form && (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={() => setForm({ kind: 'DECISION', text: '', responsibleId: '', due: '', decisionId: '' })}>{t('meet.addDecision')}</Button>
          <Button type="button" variant="secondary" onClick={() => setForm({ kind: 'INSTRUCTION', text: '', responsibleId: '', due: '', decisionId: '' })}>{t('meet.addInstruction')}</Button>
        </div>
      )}
      {edit && form && (
        <form
          className="mt-2 space-y-2 rounded-xl border border-slate-200 p-3"
          onSubmit={async (e) => {
            e.preventDefault();
            await run(() => api<MeetingDto>(`${base}/items/${item.id}/resolutions`, { method: 'POST', body: { kind: form.kind, text: form.text || undefined, responsibleId: form.responsibleId || undefined, due: form.due || undefined, decisionId: form.decisionId || undefined } }));
            setForm(null);
          }}
        >
          {form.kind === 'DECISION' && meeting.chatDecisions.some((d) => !used.has(d.id)) && (
            <Select aria-label={t('meet.fromChat')} value={form.decisionId} onChange={(e) => setForm({ ...form, decisionId: e.target.value, text: meeting.chatDecisions.find((d) => d.id === e.target.value)?.text ?? form.text })}>
              <option value="">{t('meet.fromChat')}</option>
              {meeting.chatDecisions.filter((d) => !used.has(d.id)).map((d) => <option key={d.id} value={d.id}>{d.text.slice(0, 80)} · {t(`decision.status.${d.status}` as Key)}</option>)}
            </Select>
          )}
          <Input required aria-label={form.kind === 'DECISION' ? t('meet.decisionText') : t('meet.instructionText')} placeholder={form.kind === 'DECISION' ? t('meet.decisionText') : t('meet.instructionText')} maxLength={2000} value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} />
          {form.kind === 'INSTRUCTION' && (
            <div className="flex flex-wrap gap-2">
              <div className="min-w-48 flex-1">
                <Select aria-label={t('meet.responsible')} value={form.responsibleId} onChange={(e) => setForm({ ...form, responsibleId: e.target.value })}>
                  <option value="">{t('tasks.assigneePick')}</option>
                  {meeting.participantIds.map((p) => <option key={p} value={p}>{nameOf(p)}</option>)}
                </Select>
              </div>
              <Input type="date" required aria-label={t('meet.due')} value={form.due} onChange={(e) => setForm({ ...form, due: e.target.value })} className="w-44" />
            </div>
          )}
          <div className="flex gap-2">
            <Button type="submit" disabled={!form.text.trim() || (form.kind === 'INSTRUCTION' && (!form.responsibleId || !form.due))}>{t('create')}</Button>
            <Button type="button" variant="secondary" onClick={() => setForm(null)}>{t('cancel')}</Button>
          </div>
        </form>
      )}
    </Card>
  );
}
