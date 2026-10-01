/** Wall-clock fields as written in a WhatsApp export. */
export interface Local {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

// Building an Intl.DateTimeFormat is expensive (about a third of a millisecond), and an import converts every message
// twice; one formatter per zone brings 20,000 messages from tens of seconds down to a fraction of a second.
const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Offset of `timeZone` from UTC, in milliseconds, at the given instant. */
function offsetMs(utcMs: number, timeZone: string): number {
  const parts = formatter(timeZone).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asLocalUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asLocalUtc - Math.floor(utcMs / 1000) * 1000;
}

/**
 * The instant that shows `local` on a wall clock in `timeZone`. Kazakhstan changed its offset in 2024 (Almaty UTC+6 to
 * UTC+5), so the offset must be looked up for the date itself, not assumed. During the repeated hour of a change the
 * earlier instant is returned; the error is at most that hour.
 */
export function zonedToUtc(local: Local, timeZone: string): Date {
  const naive = Date.UTC(local.y, local.mo - 1, local.d, local.h, local.mi, local.s);
  const first = naive - offsetMs(naive, timeZone);
  return new Date(naive - offsetMs(first, timeZone));
}
