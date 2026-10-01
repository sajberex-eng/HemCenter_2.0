/** Pure helpers for the WhatsApp import: matching names to colleagues and naming the chat. */

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const digits = (s: string) => s.replace(/\D/g, '');

export interface Candidate {
  id: string;
  fullName: string;
  phone: string | null;
}

export interface Suggestion {
  userId: string;
  fullName: string;
  /** 0..1, how sure the match is. */
  score: number;
}

/**
 * A WhatsApp display name is whatever the person typed ("Иван П.", "Ivan Petrov", "+7 701 555 12 34"). Compare it to
 * the staff directory: a phone number must match the end of a stored phone; otherwise every word of the display name
 * must match a word of the full name, where a one-letter word ("Н.") counts as an initial.
 */
export function suggestUsers(waName: string, users: Candidate[], limit = 3): Suggestion[] {
  const phone = digits(waName);
  const out: Suggestion[] = [];
  if (phone.length >= 10 && !/\p{L}/u.test(waName)) {
    const tail = phone.slice(-10);
    for (const u of users) if (u.phone && digits(u.phone).slice(-10) === tail) out.push({ userId: u.id, fullName: u.fullName, score: 1 });
    return out.slice(0, limit);
  }
  const words = norm(waName).split(' ').filter(Boolean);
  if (words.length === 0) return [];
  for (const u of users) {
    const name = norm(u.fullName).split(' ').filter(Boolean);
    let matched = 0;
    for (const w of words) {
      if (w.length === 1 ? name.some((n) => n.startsWith(w)) : name.includes(w)) matched++;
    }
    if (matched === 0) continue;
    // reward matching all of the display name; a single common first name alone is only a weak hint
    const coverage = matched / words.length;
    const score = words.length === 1 ? coverage * 0.5 : coverage;
    if (score >= 0.5) out.push({ userId: u.id, fullName: u.fullName, score: Math.round(score * 100) / 100 });
  }
  return out.sort((a, b) => b.score - a.score || a.fullName.localeCompare(b.fullName)).slice(0, limit);
}

/**
 * Whether the best suggestion is safe to preselect: a clear winner with a full match. Several people with equally
 * good matches (two colleagues called "Айгерим") must be decided by a human.
 */
export function confidentChoice(s: Suggestion[]): Suggestion | null {
  if (s.length === 0 || s[0].score < 0.99) return null;
  return s.length > 1 && s[1].score >= s[0].score ? null : s[0];
}

/** "Чат WhatsApp с Бухгалтерия.zip" -> "Бухгалтерия"; "WhatsApp Chat with Team.txt" -> "Team". */
export function titleFromFileName(fileName: string): string {
  const base = fileName.replace(/^.*[\\/]/, '').replace(/\.(zip|txt)$/i, '').replace(/\(\d+\)$/, '').trim();
  const stripped = base
    .replace(/^(чат\s+whatsapp\s+(с|c)|whatsapp\s+chat\s+with|whatsapp\s+chat\s+-|whatsapp\s+чат\s+с|whatsapp\s+[-–]\s*)\s*/i, '')
    .replace(/^_chat$/i, '')
    .trim();
  return (stripped || base || 'WhatsApp').slice(0, 100);
}

export const PLACEHOLDER_OMITTED = '[файл не включён в экспорт / файл экспортқа қосылмаған]';
export const placeholderMissing = (name: string) => `[вложение отсутствует в архиве / тіркеме мұрағатта жоқ: ${name}]`;

/** Checks that a time zone name is one the runtime knows. */
export function isKnownTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
