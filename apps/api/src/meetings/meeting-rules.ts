import type { DocData, Locale } from '@hemcenter/shared';
import { formatDocDate } from '../documents/render';

export interface ProtocolSource {
  chair: string;
  secretary: string;
  participants: string[];
  items: {
    title: string;
    heard: string | null;
    resolutions: { kind: 'DECISION' | 'INSTRUCTION'; text: string; responsible: string | null; due: string | null }[];
  }[];
}

const WORDS: Record<Locale, { heard: (n: number, title: string, text: string) => string; point: (n: number) => string; title: (subject: string, date: string) => string }> = {
  ru: {
    heard: (n, title, text) => `${n}. «${title}». Слушали: ${text}`,
    point: (n) => `п. ${n} повестки`,
    title: (subject, date) => `Протокол совещания «${subject}» от ${date}`,
  },
  kk: {
    heard: (n, title, text) => `${n}. «${title}». Тыңдалды: ${text}`,
    point: (n) => `күн тәртібінің ${n}-тармағы`,
    title: (subject, date) => `«${subject}» кеңесінің хаттамасы, ${date}`,
  },
};

export const protocolTitle = (subject: string, isoDay: string, lang: Locale) => WORDS[lang].title(subject, formatDocDate(isoDay));

/** What goes into the protocol template, from the record of the meeting. Empty parts are left out. */
export function protocolData(src: ProtocolSource, lang: Locale): DocData {
  const w = WORDS[lang];
  const data: DocData = { chair: src.chair, secretary: src.secretary };
  if (src.participants.length) data.participants = src.participants;
  if (src.items.length) data.agenda = src.items.map((i) => i.title);

  const heard = src.items.map((i, k) => (i.heard?.trim() ? w.heard(k + 1, i.title, i.heard.trim()) : null)).filter((x): x is string => !!x);
  if (heard.length) data.body = heard.join('\n');

  const decisions: string[] = [];
  const items: NonNullable<DocData['items']> = [];
  src.items.forEach((item, k) => {
    for (const r of item.resolutions) {
      const text = `${r.text.trim()} (${w.point(k + 1)})`;
      if (r.kind === 'DECISION') decisions.push(text);
      else items.push({ text, ...(r.responsible ? { responsible: r.responsible } : {}), ...(r.due ? { due: r.due } : {}) });
    }
  });
  if (decisions.length) data.decisions = decisions;
  if (items.length) data.items = items;
  return data;
}
