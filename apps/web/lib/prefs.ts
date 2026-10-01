/** Minutes since midnight for "HH:mm", or null when malformed. */
export function parseClock(v: string | null | undefined): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(v ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Whether `nowMin` falls into the quiet window; the window may wrap past midnight (22:00-07:00). */
export function inQuietHours(start: string | null, end: string | null, nowMin: number): boolean {
  const s = parseClock(start);
  const e = parseClock(end);
  if (s === null || e === null || s === e) return false;
  return s < e ? nowMin >= s && nowMin < e : nowMin >= s || nowMin < e;
}

export interface Quiet {
  dndUntil: string | null;
  quietStart: string | null;
  quietEnd: string | null;
}

/** True while do-not-disturb or quiet hours are in effect (in the device's local time). */
export function isQuietNow(p: Quiet | null, now: Date = new Date()): boolean {
  if (!p) return false;
  if (p.dndUntil && new Date(p.dndUntil) > now) return true;
  return inQuietHours(p.quietStart, p.quietEnd, now.getHours() * 60 + now.getMinutes());
}

/** 08:00 tomorrow, local time. */
export function tomorrowMorning(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  d.setHours(8, 0, 0, 0);
  return d;
}

/** Whether an in-app alert (toast and sound) is wanted for a message, given the chat mode. */
export function wantsAlert(mode: 'ALL' | 'MENTIONS' | 'NONE', mentioned: boolean, prefs: Quiet | null, now: Date = new Date()): boolean {
  if (mode === 'NONE') return false;
  if (mode === 'MENTIONS' && !mentioned) return false;
  return !isQuietNow(prefs, now);
}
