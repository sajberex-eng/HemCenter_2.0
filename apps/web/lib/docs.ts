import type { DocData, DocumentKindDto, Locale } from '@hemcenter/shared';

export type DocField = 'preamble' | 'body' | 'recipient' | 'signer' | 'chair' | 'secretary' | 'participants' | 'agenda' | 'decisions' | 'items';

/** Which parts of the form a kind shows. Kinds the secretary adds get the general set. */
export const FIELDS_BY_KIND: Record<string, DocField[]> = {
  PROTOCOL: ['chair', 'secretary', 'participants', 'agenda', 'body', 'decisions', 'items'],
  ORDER: ['preamble', 'body', 'items', 'signer'],
  DIRECTIVE: ['preamble', 'body', 'items', 'signer'],
  MEMO: ['recipient', 'preamble', 'body', 'items'],
};
export const GENERAL_FIELDS: DocField[] = ['recipient', 'preamble', 'body', 'items', 'signer'];
export const fieldsOf = (kind: Pick<DocumentKindDto, 'code'> | undefined): DocField[] => (kind?.code && FIELDS_BY_KIND[kind.code]) || GENERAL_FIELDS;

export const kindName = (k: Pick<DocumentKindDto, 'nameRu' | 'nameKk'>, locale: Locale) => (locale === 'kk' ? k.nameKk : k.nameRu);

export const STATUS_STYLE: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-700',
  IN_REVIEW: 'bg-amber-100 text-amber-900',
  RETURNED: 'bg-red-100 text-red-800',
  APPROVED: 'bg-teal-100 text-teal-800',
  SIGNED: 'bg-sky-100 text-sky-800',
  REGISTERED: 'bg-green-100 text-green-800',
};

export const toLines = (text: string): string[] => text.split('\n').map((l) => l.trim()).filter(Boolean);
export const fromLines = (lines: string[] | undefined): string => (lines ?? []).join('\n');

/** The form keeps every field as a plain string; this turns it into what the server expects, leaving out what is empty. */
export interface DocForm {
  preamble: string;
  body: string;
  recipient: string;
  signer: string;
  chair: string;
  secretary: string;
  participants: string;
  agenda: string;
  decisions: string;
  items: { text: string; responsible: string; due: string }[];
}

export const emptyForm = (): DocForm => ({ preamble: '', body: '', recipient: '', signer: '', chair: '', secretary: '', participants: '', agenda: '', decisions: '', items: [] });

export const formFromData = (d: DocData): DocForm => ({
  preamble: d.preamble ?? '',
  body: d.body ?? '',
  recipient: d.recipient ?? '',
  signer: d.signer ?? '',
  chair: d.chair ?? '',
  secretary: d.secretary ?? '',
  participants: fromLines(d.participants),
  agenda: fromLines(d.agenda),
  decisions: fromLines(d.decisions),
  items: (d.items ?? []).map((i) => ({ text: i.text, responsible: i.responsible ?? '', due: i.due ?? '' })),
});

export function dataFromForm(f: DocForm, fields: DocField[]): DocData {
  const on = (x: DocField) => fields.includes(x);
  const out: DocData = {};
  for (const k of ['preamble', 'body', 'recipient', 'signer', 'chair', 'secretary'] as const) if (on(k) && f[k].trim()) out[k] = f[k].trim();
  for (const k of ['participants', 'agenda', 'decisions'] as const) if (on(k) && toLines(f[k]).length) out[k] = toLines(f[k]);
  if (on('items')) {
    const items = f.items.filter((i) => i.text.trim()).map((i) => ({ text: i.text.trim(), ...(i.responsible.trim() ? { responsible: i.responsible.trim() } : {}), ...(i.due ? { due: i.due } : {}) }));
    if (items.length) out.items = items;
  }
  return out;
}
