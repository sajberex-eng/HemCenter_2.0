/**
 * Parser for WhatsApp "Export chat" text files. Pure and tolerant: it never throws on odd input, it counts
 * what it could not understand so the administrator sees it in the preview.
 *
 * Formats seen in the wild (the phone's language and OS change the details):
 *   Android:  22.03.2024, 14:35 - Иван Петров: Добрый день
 *             3/22/24, 2:35 PM - John: Hello
 *   iOS:      [22.03.2024, 14:35:12] Иван Петров: Добрый день
 *             [22/03/24, 2:35:12 PM] John: Hello
 * A message may continue on following lines that carry no date. Lines without "Name:" are system notices.
 */

export type DateOrder = 'DMY' | 'MDY';

export interface ParsedMessage {
  /** Local wall-clock time as written in the file (the phone's time zone is not stored in exports). */
  local: { y: number; mo: number; d: number; h: number; mi: number; s: number };
  /** null for system notices (people joined, group renamed, encryption notice...). */
  author: string | null;
  text: string;
  /** File name when the message refers to an attached file. */
  file: string | null;
  /** The export says a media file was left out ("<Media omitted>"), so there is nothing to attach. */
  omittedMedia: boolean;
}

export interface ParseResult {
  messages: ParsedMessage[];
  order: DateOrder;
  /** Lines before the first dated line, or that were neither a message nor a continuation. */
  skippedLines: number;
}

// Invisible marks that WhatsApp inserts (LRM, RLM, BOM, narrow no-break space before AM/PM) are removed up front.
const INVISIBLE = /[‎‏‪-‮﻿]/g;

const DATE = String.raw`(\d{1,2})[./](\d{1,2})[./](\d{2,4})`;
const TIME = String.raw`(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?(?:\s?([AaPp])\.?\s?[Mm]\.?)?`;

// iOS: [date, time] rest      Android: date, time - rest   (also "date time - rest" and "date, time rest" in some locales)
const IOS = new RegExp(String.raw`^\[${DATE},?\s+${TIME}\]\s?(.*)$`);
const ANDROID = new RegExp(String.raw`^${DATE},?\s+${TIME}\s?[-–—]\s?(.*)$`);

interface Header {
  a: number;
  b: number;
  y: number;
  h: number;
  mi: number;
  s: number;
  rest: string;
}

function header(line: string): Header | null {
  const m = IOS.exec(line) ?? ANDROID.exec(line);
  if (!m) return null;
  // groups: 1-3 date, 4 hour, 5 minute, 6 seconds (optional), 7 a/p (optional), 8 the rest of the line
  let h = Number(m[4]);
  const mi = Number(m[5]);
  const s = m[6] ? Number(m[6]) : 0;
  const ampm = m[7]?.toLowerCase();
  if (ampm) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (ampm === 'p' ? 12 : 0);
  }
  if (h > 23 || mi > 59 || s > 59) return null;
  let y = Number(m[3]);
  if (m[3].length === 2) y += 2000;
  return { a: Number(m[1]), b: Number(m[2]), y, h, mi, s, rest: m[8] };
}

/** "dd.mm" unless some date has a first number above 12 (impossible month) or only the second does. */
export function detectDateOrder(headers: { a: number; b: number }[], hint?: DateOrder): DateOrder {
  if (headers.some((x) => x.a > 12 && x.b <= 12)) return 'DMY';
  if (headers.some((x) => x.b > 12 && x.a <= 12)) return 'MDY';
  return hint ?? 'DMY'; // ambiguous (every date has both numbers <= 12): the Kazakh/Russian convention
}

// WhatsApp's placeholders for media that were left out of the export, in the languages we expect.
const MEDIA_OMITTED = /^(<(media omitted|медиа скрыто|медиафайлы не включены|мультимедиа не включено|медиа жоқ)>|<attached:[^>]*>|‎?image omitted|‎?video omitted|‎?sticker omitted|‎?audio omitted|‎?document omitted)$/i;
const ATTACHED_IOS = /<(?:attached|прикреплено|тіркелген):\s*([^>]+)>/i;
const ATTACHED_ANDROID = /^(.+?)\s+\((?:file attached|файл добавлен|файл прикреплён|файл тіркелді)\)$/i;

/** Splits "Author: text". A colon inside the author part would be ambiguous, so the first ": " wins. */
function splitAuthor(rest: string): { author: string | null; text: string } {
  const i = rest.indexOf(': ');
  // a real name is short and has no line break; longer prefixes are part of a system notice ("... changed the subject to "A: B"")
  if (i > 0 && i <= 80) return { author: rest.slice(0, i).trim(), text: rest.slice(i + 2) };
  return { author: null, text: rest };
}

export function parseWhatsApp(raw: string, hint?: DateOrder): ParseResult {
  const lines = raw.replace(INVISIBLE, '').replace(/ /g, ' ').split(/\r\n|\n|\r/);
  type Draft = { h: Header; lines: string[] };
  const drafts: Draft[] = [];
  let skipped = 0;
  for (const line of lines) {
    const h = header(line);
    if (h) drafts.push({ h, lines: [h.rest] });
    else if (drafts.length > 0) drafts[drafts.length - 1].lines.push(line); // continuation of the previous message
    else if (line.trim()) skipped++;
  }

  const order = detectDateOrder(drafts.map((d) => d.h), hint);
  const messages: ParsedMessage[] = [];
  for (const { h, lines: parts } of drafts) {
    const mo = order === 'DMY' ? h.b : h.a;
    const d = order === 'DMY' ? h.a : h.b;
    if (mo < 1 || mo > 12 || d < 1 || d > 31) {
      skipped++;
      continue;
    }
    const joined = parts.join('\n').replace(/\n+$/, '');
    const { author, text: body } = splitAuthor(parts[0]);
    // a system notice has no author; its continuation lines (if any) stay part of it
    const full = author === null ? joined : [body, ...parts.slice(1)].join('\n').replace(/\n+$/, '');
    let text = full;
    let file: string | null = null;
    let omittedMedia = false;
    const ios = ATTACHED_IOS.exec(full);
    const android = ATTACHED_ANDROID.exec(full.split('\n')[0]);
    if (ios) {
      file = ios[1].trim();
      text = full.replace(ios[0], '').trim();
    } else if (android) {
      file = android[1].trim();
      text = full.split('\n').slice(1).join('\n').trim();
    } else if (MEDIA_OMITTED.test(full.trim())) {
      text = '';
      omittedMedia = true;
    }
    messages.push({ local: { y: h.y, mo, d, h: h.h, mi: h.mi, s: h.s }, author, text, file, omittedMedia });
  }
  return { messages, order, skippedLines: skipped };
}
