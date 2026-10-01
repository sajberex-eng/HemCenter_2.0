import { describe, expect, it } from 'vitest';
import { buildPayload, inQuietHours, isAllowedPushEndpoint, localMinutes, shortName, shouldNotify, type Recipient } from '../src/push/push-rules';

describe('isAllowedPushEndpoint (SSRF guard)', () => {
  it('accepts the real push services over https', () => {
    for (const u of [
      'https://fcm.googleapis.com/fcm/send/abc',
      'https://updates.push.services.mozilla.com/wpush/v2/xyz',
      'https://web.push.apple.com/QGx',
      'https://wns2-par02p.notify.windows.com/w/?token=1',
    ]) expect(isAllowedPushEndpoint(u, []), u).toBe(true);
  });

  it('refuses plain http, internal addresses and look-alike hosts', () => {
    for (const u of [
      'http://fcm.googleapis.com/x',
      'https://localhost/x',
      'https://127.0.0.1/x',
      'https://169.254.169.254/latest/meta-data',
      'https://[::1]/x',
      'https://10.0.0.5:443/x',
      'https://evil.com/fcm.googleapis.com',
      'https://fcm.googleapis.com.evil.com/x',
      'https://googleapis.com.attacker.kz/x',
      'https://user:pass@fcm.googleapis.com/x',
      'https://fcm.googleapis.com:8443/x',
      'ftp://fcm.googleapis.com/x',
      'not a url',
      '',
    ]) expect(isAllowedPushEndpoint(u, []), u).toBe(false);
  });

  it('allows extra hosts that the operator lists explicitly', () => {
    expect(isAllowedPushEndpoint('https://push.example.kz/x', [])).toBe(false);
    expect(isAllowedPushEndpoint('https://push.example.kz/x', ['push.example.kz'])).toBe(true);
  });
});

describe('quiet hours', () => {
  it('handles a window inside one day and one that wraps past midnight', () => {
    expect(inQuietHours('13:00', '14:00', 13 * 60 + 30)).toBe(true);
    expect(inQuietHours('13:00', '14:00', 14 * 60)).toBe(false); // the end minute is outside
    expect(inQuietHours('22:00', '07:00', 23 * 60)).toBe(true);
    expect(inQuietHours('22:00', '07:00', 3 * 60)).toBe(true);
    expect(inQuietHours('22:00', '07:00', 12 * 60)).toBe(false);
  });

  it('ignores missing, equal or malformed settings', () => {
    expect(inQuietHours(null, '07:00', 60)).toBe(false);
    expect(inQuietHours('22:00', '22:00', 22 * 60)).toBe(false);
    expect(inQuietHours('25:00', '07:00', 60)).toBe(false);
    expect(inQuietHours('7:00', '8:00', 450)).toBe(false);
  });

  it('reads the clock in the configured zone', () => {
    const utc = new Date('2026-10-01T20:30:00Z'); // 01:30 the next day in Almaty (UTC+5)
    expect(localMinutes(utc, 'Asia/Almaty')).toBe(90);
    expect(localMinutes(utc, 'UTC')).toBe(20 * 60 + 30);
  });
});

describe('shouldNotify', () => {
  const now = new Date('2026-10-01T07:00:00Z'); // 12:00 Almaty
  const base: Recipient = { userId: 'bob', notifyMode: 'ALL', dndUntil: null, quietStart: null, quietEnd: null };
  const msg = { authorId: 'ann', mentionIds: [] as string[] };
  const ask = (r: Partial<Recipient>, m = msg, at = now) => shouldNotify({ ...base, ...r }, m, at, 'Asia/Almaty');

  it('notifies by default, never the author', () => {
    expect(ask({})).toBe(true);
    expect(ask({ userId: 'ann' })).toBe(false);
  });

  it('respects the per-chat mode', () => {
    expect(ask({ notifyMode: 'NONE' })).toBe(false);
    expect(ask({ notifyMode: 'MENTIONS' })).toBe(false);
    expect(ask({ notifyMode: 'MENTIONS' }, { authorId: 'ann', mentionIds: ['bob'] })).toBe(true);
    expect(ask({ notifyMode: 'MENTIONS' }, { authorId: 'ann', mentionIds: ['carl'] })).toBe(false);
  });

  it('respects do-not-disturb and quiet hours, even for mentions', () => {
    const mention = { authorId: 'ann', mentionIds: ['bob'] };
    expect(ask({ dndUntil: new Date(now.getTime() + 60_000) })).toBe(false);
    expect(ask({ dndUntil: new Date(now.getTime() - 60_000) })).toBe(true); // already over
    expect(ask({ quietStart: '11:00', quietEnd: '13:00' })).toBe(false);
    expect(ask({ quietStart: '11:00', quietEnd: '13:00' }, mention)).toBe(false);
    expect(ask({ quietStart: '22:00', quietEnd: '07:00' })).toBe(true);
  });
});

describe('payload', () => {
  it('shortens names', () => {
    expect(shortName('Иванов Александр Петрович')).toBe('Иванов А.');
    expect(shortName('Сидоров')).toBe('Сидоров');
    expect(shortName('  Құрманов   Ержан ')).toBe('Құрманов Е.');
  });

  it('speaks the recipient\'s language and carries only the sender and the chat', () => {
    const ru = buildPayload('ru', 'Иванов Александр', 'chat-1', false);
    expect(ru).toEqual({ title: 'HemCenter', body: 'Новое сообщение от Иванов А.', tag: 'chat:chat-1', url: '/chats/chat-1' });
    expect(buildPayload('ru', 'Иванов Александр', 'c', true).body).toBe('Иванов А. упомянул(а) вас');
    expect(buildPayload('kk', 'Құрманов Ержан', 'c', false).body).toBe('Құрманов Е.: жаңа хабарлама');
    expect(Object.keys(ru).sort()).toEqual(['body', 'tag', 'title', 'url']); // no text, no file names
  });
});
