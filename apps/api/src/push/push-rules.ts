/** Pure rules for push notifications: who may receive one, where it may be sent, and what it says. */

/**
 * The server POSTs to the "endpoint" URL that the client reports, so it must be a real push service and never an
 * address the client picked (otherwise: server-side request forgery against internal services).
 */
const PUSH_HOST_SUFFIXES = [
  '.googleapis.com', // Chrome / Android (FCM)
  '.push.services.mozilla.com', // Firefox
  '.push.apple.com', // Safari / iOS
  '.notify.windows.com', // Edge (WNS)
];

export function isAllowedPushEndpoint(raw: string, extraHosts: string[] = (process.env.PUSH_ENDPOINT_HOSTS ?? '').split(',').map((h) => h.trim()).filter(Boolean)): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.username || u.password) return false;
  if (u.port && u.port !== '443') return false;
  const host = u.hostname.toLowerCase();
  if (/^[\d.]+$/.test(host) || host.includes(':')) return false; // IP literals are never push services
  return extraHosts.includes(host) || PUSH_HOST_SUFFIXES.some((s) => host.endsWith(s));
}

export type NotifyMode = 'ALL' | 'MENTIONS' | 'NONE';

/** Minutes since local midnight for "HH:mm", or null if malformed. */
export function parseClock(v: string | null | undefined): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(v ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** True when `nowMin` falls in the quiet window; the window may wrap past midnight (e.g. 22:00-07:00). */
export function inQuietHours(start: string | null, end: string | null, nowMin: number): boolean {
  const s = parseClock(start);
  const e = parseClock(end);
  if (s === null || e === null || s === e) return false;
  return s < e ? nowMin >= s && nowMin < e : nowMin >= s || nowMin < e;
}

/** Local minutes since midnight in the given IANA zone (Kazakhstan: Asia/Almaty). */
export function localMinutes(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return get('hour') * 60 + get('minute');
}

export interface Recipient {
  userId: string;
  notifyMode: NotifyMode;
  dndUntil: Date | null;
  quietStart: string | null;
  quietEnd: string | null;
}

/** Decides whether this person gets a push for a message. Mentions follow the same do-not-disturb rules. */
export function shouldNotify(r: Recipient, msg: { authorId: string; mentionIds: string[] }, now: Date, timeZone: string): boolean {
  if (r.userId === msg.authorId) return false;
  if (r.notifyMode === 'NONE') return false;
  if (r.notifyMode === 'MENTIONS' && !msg.mentionIds.includes(r.userId)) return false;
  if (r.dndUntil && r.dndUntil > now) return false;
  if (inQuietHours(r.quietStart, r.quietEnd, localMinutes(now, timeZone))) return false;
  return true;
}

/** "Иванов Александр Петрович" -> "Иванов А." */
export function shortName(fullName: string): string {
  const [last, first] = fullName.trim().split(/\s+/);
  return first ? `${last} ${first[0]}.` : (last ?? '');
}

const TEXT = {
  ru: { message: 'Новое сообщение от {name}', mention: '{name} упомянул(а) вас', title: 'HemCenter' },
  kk: { message: '{name}: жаңа хабарлама', mention: '{name} сізді атады', title: 'HemCenter' },
} as const;

export interface PushPayload {
  title: string;
  body: string;
  /** Collapses repeated notifications of one chat into one. */
  tag: string;
  url: string;
}

/**
 * The notification deliberately carries NO message text or file names: it travels through the push services
 * of Google/Apple/Mozilla. Only the sender's short name and the chat id (needed to open the right chat).
 */
export function buildPayload(locale: 'ru' | 'kk', authorFullName: string, chatId: string, mentioned: boolean): PushPayload {
  const t = TEXT[locale];
  return {
    title: t.title,
    body: (mentioned ? t.mention : t.message).replace('{name}', shortName(authorFullName)),
    tag: `chat:${chatId}`,
    url: `/chats/${chatId}`,
  };
}
