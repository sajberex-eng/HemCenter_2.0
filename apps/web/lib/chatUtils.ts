import type { ChatDto, Locale } from '@hemcenter/shared';

export function chatTitle(chat: ChatDto, meId: string, nameOf: (id: string) => string): string {
  if (chat.type === 'GROUP') return chat.title ?? '';
  const other = chat.members.find((m) => m.userId !== meId);
  return other ? nameOf(other.userId) : '';
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return ((parts[0][0] ?? '') + (parts.length > 1 ? parts[1][0] : '')).toUpperCase();
}

const PALETTE = ['#0f766e', '#1d4ed8', '#7c3aed', '#be185d', '#b45309', '#15803d', '#0369a1', '#a21caf'];
/** Stable colour per person, so the same colleague always looks the same. */
export function colorFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

const intlLocale = (l: Locale) => (l === 'kk' ? 'kk-KZ' : 'ru-RU');

export const formatTime = (iso: string, l: Locale) => new Intl.DateTimeFormat(intlLocale(l), { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Short stamp for the chat list: time today, otherwise the date. */
export function formatListStamp(iso: string, l: Locale, yesterday: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (sameDay(d, now)) return formatTime(iso, l);
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return yesterday;
  return new Intl.DateTimeFormat(intlLocale(l), { day: '2-digit', month: '2-digit', year: '2-digit' }).format(d);
}

export function formatDayLabel(iso: string, l: Locale, today: string, yesterday: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (sameDay(d, now)) return today;
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return yesterday;
  return new Intl.DateTimeFormat(intlLocale(l), { day: 'numeric', month: 'long', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' }).format(d);
}

export const dayKey = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

export type Piece = { kind: 'text'; text: string } | { kind: 'link'; text: string; href: string } | { kind: 'mention'; text: string };

const URL_RE = /https?:\/\/[^\s<>"']+/g;

/**
 * Splits a message into plain text, links and @mentions. Only http(s) links become clickable, and text is
 * never interpreted as HTML (React escapes it), so a message cannot inject markup or javascript: URLs.
 */
export function tokenize(body: string, mentionNames: string[]): Piece[] {
  const pieces: Piece[] = [];
  const pushText = (text: string) => {
    if (!text) return;
    const names = mentionNames.filter(Boolean).sort((a, b) => b.length - a.length);
    if (names.length === 0) return void pieces.push({ kind: 'text', text });
    const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const re = new RegExp(`@(?:${escaped.join('|')})`, 'g');
    let last = 0;
    for (const m of text.matchAll(re)) {
      if (m.index > last) pieces.push({ kind: 'text', text: text.slice(last, m.index) });
      pieces.push({ kind: 'mention', text: m[0] });
      last = m.index + m[0].length;
    }
    if (last < text.length) pieces.push({ kind: 'text', text: text.slice(last) });
  };
  let last = 0;
  for (const m of body.matchAll(URL_RE)) {
    // trailing punctuation belongs to the sentence, not the link
    const url = m[0].replace(/[).,;:!?]+$/, '');
    pushText(body.slice(last, m.index));
    pieces.push({ kind: 'link', text: url, href: url });
    last = m.index + url.length;
  }
  pushText(body.slice(last));
  return pieces;
}

/** A mention is "@" at the start or after whitespace, then up to 40 characters; names contain spaces, so spaces are allowed. */
const MENTION_AT_END = /(^|\s)@([^@\n]{0,40})$/;

/** The text typed after an "@" that ends the given text (the part before the caret), or null if none. */
export function mentionQueryAt(beforeCaret: string): string | null {
  const m = MENTION_AT_END.exec(beforeCaret);
  return m ? m[2] : null;
}

/** Replaces the unfinished "@query" at the end of the text with "@name ". */
export function completeMention(beforeCaret: string, name: string): string {
  return beforeCaret.replace(MENTION_AT_END, (_, lead: string) => `${lead}@${name} `);
}
