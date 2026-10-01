import { describe, expect, it } from 'vitest';
import { inQuietHours, isQuietNow, tomorrowMorning, wantsAlert } from './prefs';

const at = (h: number, m = 0) => new Date(2026, 9, 1, h, m);

describe('quiet hours', () => {
  it('works inside a day and across midnight', () => {
    expect(inQuietHours('13:00', '14:00', 13 * 60 + 30)).toBe(true);
    expect(inQuietHours('13:00', '14:00', 14 * 60)).toBe(false);
    expect(inQuietHours('22:00', '07:00', 23 * 60)).toBe(true);
    expect(inQuietHours('22:00', '07:00', 6 * 60 + 59)).toBe(true);
    expect(inQuietHours('22:00', '07:00', 7 * 60)).toBe(false);
  });

  it('ignores incomplete or equal settings', () => {
    expect(inQuietHours(null, '07:00', 0)).toBe(false);
    expect(inQuietHours('22:00', '22:00', 22 * 60)).toBe(false);
    expect(inQuietHours('bad', '07:00', 0)).toBe(false);
  });
});

describe('isQuietNow', () => {
  it('honours do-not-disturb until its end time', () => {
    const p = { dndUntil: at(15).toISOString(), quietStart: null, quietEnd: null };
    expect(isQuietNow(p, at(14, 59))).toBe(true);
    expect(isQuietNow(p, at(15, 1))).toBe(false);
    expect(isQuietNow(null, at(12))).toBe(false);
  });
});

describe('wantsAlert', () => {
  const none = { dndUntil: null, quietStart: null, quietEnd: null };
  it('follows the chat mode', () => {
    expect(wantsAlert('ALL', false, none)).toBe(true);
    expect(wantsAlert('MENTIONS', false, none)).toBe(false);
    expect(wantsAlert('MENTIONS', true, none)).toBe(true);
    expect(wantsAlert('NONE', true, none)).toBe(false);
  });

  it('is silenced by do-not-disturb even for mentions', () => {
    const dnd = { dndUntil: at(15).toISOString(), quietStart: null, quietEnd: null };
    expect(wantsAlert('ALL', true, dnd, at(14))).toBe(false);
  });
});

describe('tomorrowMorning', () => {
  it('is 08:00 on the next day', () => {
    const t = tomorrowMorning(at(23, 30));
    expect([t.getDate(), t.getHours(), t.getMinutes()]).toEqual([2, 8, 0]);
  });
});
