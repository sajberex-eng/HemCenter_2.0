'use client';

import { useState, type FormEvent } from 'react';
import { LOCALES, type DocumentKindDto, type Locale } from '@hemcenter/shared';
import { useI18n } from '@/lib/i18n';
import { dataFromForm, fieldsOf, kindName, type DocField, type DocForm } from '@/lib/docs';
import type { Key } from '@/lib/dictionaries';
import { Button, ErrorText, Field, Input, Select } from '../ui';

export interface DocFormValue {
  kindId: string;
  lang: Locale;
  title: string;
  docDate: string;
  form: DocForm;
}

const LABEL: Record<Exclude<DocField, 'items'>, Key> = {
  preamble: 'docs.preamble',
  body: 'docs.body',
  recipient: 'docs.recipient',
  signer: 'docs.signer',
  chair: 'docs.chair',
  secretary: 'docs.secretary',
  participants: 'docs.participants',
  agenda: 'docs.agenda',
  decisions: 'docs.decisions',
};
const MULTILINE: DocField[] = ['preamble', 'body', 'participants', 'agenda', 'decisions'];

/** Used both to start a document and to correct a draft. Kind and language are fixed once the document exists. */
export function DocumentForm({ kinds, initial, lockKind, submitLabel, error, busy, onSubmit }: {
  kinds: DocumentKindDto[];
  initial: DocFormValue;
  lockKind?: boolean;
  submitLabel: string;
  error?: string;
  busy?: boolean;
  onSubmit: (v: { kindId: string; lang: Locale; title: string; docDate: string; data: ReturnType<typeof dataFromForm> }) => void;
}) {
  const { t, locale } = useI18n();
  const [v, setV] = useState(initial);
  const kind = kinds.find((k) => k.id === v.kindId);
  const fields = fieldsOf(kind);
  const set = <K extends keyof DocForm>(k: K, value: DocForm[K]) => setV({ ...v, form: { ...v.form, [k]: value } });

  function submit(e: FormEvent) {
    e.preventDefault();
    onSubmit({ kindId: v.kindId, lang: v.lang, title: v.title, docDate: v.docDate, data: dataFromForm(v.form, fields) });
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <ErrorText>{error}</ErrorText>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('docs.kind')}>
          <Select aria-label={t('docs.kind')} value={v.kindId} disabled={lockKind} onChange={(e) => setV({ ...v, kindId: e.target.value })}>
            {kinds.map((k) => <option key={k.id} value={k.id}>{kindName(k, locale)}</option>)}
          </Select>
        </Field>
        <Field label={t('docs.lang')}>
          <Select aria-label={t('docs.lang')} value={v.lang} disabled={lockKind} onChange={(e) => setV({ ...v, lang: e.target.value as Locale })}>
            {LOCALES.map((l) => <option key={l} value={l}>{t(`docs.lang.${l}` as Key)}</option>)}
          </Select>
        </Field>
      </div>
      <Field label={t('docs.titleLabel')}>
        <Input required maxLength={200} value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} aria-label={t('docs.titleLabel')} />
      </Field>
      <Field label={t('docs.date')}>
        <Input type="date" required value={v.docDate} onChange={(e) => setV({ ...v, docDate: e.target.value })} aria-label={t('docs.date')} className="max-w-48" />
      </Field>

      {fields.filter((f): f is Exclude<DocField, 'items'> => f !== 'items').map((f) => (
        <Field key={f} label={t(LABEL[f])}>
          {MULTILINE.includes(f) ? (
            <textarea aria-label={t(LABEL[f])} rows={f === 'body' ? 5 : 3} value={v.form[f]} onChange={(e) => set(f, e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base" />
          ) : (
            <Input aria-label={t(LABEL[f])} maxLength={300} value={v.form[f]} onChange={(e) => set(f, e.target.value)} />
          )}
        </Field>
      ))}

      {fields.includes('items') && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t('docs.items')}</legend>
          {v.form.items.map((it, i) => (
            <div key={i} className="space-y-2 rounded-xl border border-slate-200 p-3" data-testid="doc-item">
              <Input aria-label={t('docs.itemText')} placeholder={t('docs.itemText')} maxLength={2000} value={it.text} onChange={(e) => set('items', v.form.items.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
              <div className="flex flex-wrap gap-2">
                <div className="min-w-40 flex-1">
                  <Input aria-label={t('docs.itemResponsible')} placeholder={t('docs.itemResponsible')} maxLength={200} value={it.responsible} onChange={(e) => set('items', v.form.items.map((x, j) => (j === i ? { ...x, responsible: e.target.value } : x)))} />
                </div>
                <Input type="date" aria-label={t('docs.itemDue')} value={it.due} onChange={(e) => set('items', v.form.items.map((x, j) => (j === i ? { ...x, due: e.target.value } : x)))} className="w-44" />
                <button type="button" className="min-h-11 rounded px-2 text-sm text-red-700 hover:bg-red-50" onClick={() => set('items', v.form.items.filter((_, j) => j !== i))}>
                  {t('docs.removeItem')}
                </button>
              </div>
            </div>
          ))}
          <Button type="button" variant="secondary" onClick={() => set('items', [...v.form.items, { text: '', responsible: '', due: '' }])}>
            {t('docs.addItem')}
          </Button>
        </fieldset>
      )}

      <Button type="submit" disabled={busy || !v.title.trim() || !v.kindId}>{submitLabel}</Button>
    </form>
  );
}
