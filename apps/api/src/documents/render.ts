import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';
import type { DocData, Locale } from '@hemcenter/shared';

/** Everything a template can refer to. Lists get a running number `n`; `hasX` switches a whole section on or off. */
export interface RenderContext {
  org: string;
  title: string;
  number: string;
  date: string;
  author: string;
  preamble: string;
  body: string;
  recipient: string;
  signer: string;
  chair: string;
  secretary: string;
  participants: { n: number; name: string }[];
  agenda: { n: number; text: string }[];
  decisions: { n: number; text: string }[];
  items: { n: number; text: string; responsible: string; due: string }[];
  hasPreamble: boolean;
  hasBody: boolean;
  hasRecipient: boolean;
  hasParticipants: boolean;
  hasAgenda: boolean;
  hasDecisions: boolean;
  hasItems: boolean;
  /** Approval sheet lines, filled once documents go through approval. */
  approvals: { n: number; name: string; result: string; at: string; comment: string }[];
  hasApprovals: boolean;
}

/** Blank line to be filled by hand until the document is registered. */
export const NO_NUMBER = '______';

export const formatDocDate = (isoDay: string): string => {
  const [y, m, d] = isoDay.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
};

const clean = (s: unknown) => (typeof s === 'string' ? s.trim() : '');
const list = <T>(v: T[] | undefined): T[] => (Array.isArray(v) ? v : []);

export interface ContextInput {
  org: string;
  title: string;
  number: string | null;
  /** YYYY-MM-DD */
  date: string;
  author: string;
  data: DocData;
  approvals?: RenderContext['approvals'];
}

export function buildContext(i: ContextInput): RenderContext {
  const d = i.data ?? {};
  const participants = list(d.participants).map(clean).filter(Boolean).map((name, k) => ({ n: k + 1, name }));
  const agenda = list(d.agenda).map(clean).filter(Boolean).map((text, k) => ({ n: k + 1, text }));
  const decisions = list(d.decisions).map(clean).filter(Boolean).map((text, k) => ({ n: k + 1, text }));
  const items = list(d.items)
    .filter((x) => clean(x?.text))
    .map((x, k) => ({ n: k + 1, text: clean(x.text), responsible: clean(x.responsible), due: x.due ? formatDocDate(x.due) : '' }));
  const approvals = (i.approvals ?? []).map((a, k) => ({ ...a, n: k + 1 }));
  return {
    org: i.org,
    title: i.title,
    number: i.number ?? NO_NUMBER,
    date: formatDocDate(i.date),
    author: i.author,
    preamble: clean(d.preamble),
    body: clean(d.body),
    recipient: clean(d.recipient),
    signer: clean(d.signer),
    chair: clean(d.chair),
    secretary: clean(d.secretary),
    participants,
    agenda,
    decisions,
    items,
    hasPreamble: !!clean(d.preamble),
    hasBody: !!clean(d.body),
    hasRecipient: !!clean(d.recipient),
    hasParticipants: participants.length > 0,
    hasAgenda: agenda.length > 0,
    hasDecisions: decisions.length > 0,
    hasItems: items.length > 0,
    approvals,
    hasApprovals: approvals.length > 0,
  };
}

export class TemplateError extends Error {
  constructor(public readonly details: string[]) {
    super('TEMPLATE_INVALID');
  }
}

/** A zip that expands to more than this is refused: it is either broken or a "zip bomb". */
const MAX_UNPACKED_BYTES = 60 * 1024 * 1024;

function open(template: Buffer): PizZip {
  let zip: PizZip;
  try {
    zip = new PizZip(template);
  } catch {
    throw new TemplateError(['not a Word (.docx) file']);
  }
  const names = Object.keys(zip.files);
  if (!names.includes('word/document.xml')) throw new TemplateError(['word/document.xml is missing']);
  let total = 0;
  for (const f of Object.values(zip.files)) total += (f as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
  if (total > MAX_UNPACKED_BYTES) throw new TemplateError(['file is too large when unpacked']);
  return zip;
}

/** Fills a .docx template. Values are inserted as text (the library escapes them), never as markup. */
export function renderDocx(template: Buffer, ctx: RenderContext): Buffer {
  const zip = open(template);
  let doc: Docxtemplater;
  try {
    doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, delimiters: { start: '{', end: '}' }, nullGetter: () => '' });
    doc.render(ctx);
  } catch (e) {
    const sub = (e as { properties?: { errors?: { properties?: { explanation?: string }; message?: string }[] } }).properties?.errors;
    throw new TemplateError(sub?.length ? sub.map((x) => x.properties?.explanation ?? x.message ?? 'error') : [(e as Error).message]);
  }
  return doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** A template is accepted only if it fills in cleanly with a full set of sample data in both languages' shape. */
export function validateTemplate(template: Buffer, lang: Locale): void {
  const sample = buildContext({
    org: 'Org',
    title: 'Title',
    number: '1-X/2026',
    date: '2026-01-31',
    author: 'Author',
    data: {
      preamble: 'p',
      body: 'b',
      recipient: 'r',
      signer: 's',
      chair: 'c',
      secretary: 'q',
      participants: ['a', 'b'],
      agenda: ['x'],
      decisions: ['y'],
      items: [{ text: 't', responsible: 'r', due: '2026-02-01' }],
    },
    approvals: [{ n: 1, name: 'n', result: 'ok', at: 'now', comment: '' }],
  });
  void lang;
  renderDocx(template, sample);
}
