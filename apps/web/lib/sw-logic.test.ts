import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const sw = createRequire(import.meta.url)('../public/sw-logic.js') as {
  safeUrl: (u: unknown) => string;
  parsePayload: (t: string) => { title: string; body: string; tag: string; url: string };
  shouldShow: (c: { visibilityState: string }[]) => boolean;
  notificationOptions: (p: { body: string; tag: string; url: string }) => { body: string; tag: string; renotify: boolean; data: { url: string } };
  pickClient: <T extends { visibilityState: string }>(c: T[]) => T | null;
};

describe('safeUrl', () => {
  it('keeps paths inside the site', () => {
    expect(sw.safeUrl('/chats/123')).toBe('/chats/123');
    expect(sw.safeUrl('/chats?x=1#y')).toBe('/chats?x=1#y');
  });

  it('never leaves the site: other origins, protocol-relative, scripts and junk fall back', () => {
    for (const bad of ['https://evil.kz/x', '//evil.kz/x', '/\\evil.kz', 'javascript:alert(1)', 'chats/1', '', null, undefined, 42, {}, '/' + 'a'.repeat(400)]) {
      expect(sw.safeUrl(bad), String(bad)).toBe('/chats');
    }
  });
});

describe('parsePayload', () => {
  it('reads a normal payload', () => {
    expect(sw.parsePayload(JSON.stringify({ title: 'HemCenter', body: 'Новое сообщение от Иванов А.', tag: 'chat:1', url: '/chats/1' }))).toEqual({
      title: 'HemCenter',
      body: 'Новое сообщение от Иванов А.',
      tag: 'chat:1',
      url: '/chats/1',
    });
  });

  it('turns empty, invalid or odd payloads into a harmless generic notification', () => {
    for (const bad of ['', 'not json', 'null', '[]', '"text"', '42']) {
      expect(sw.parsePayload(bad), bad).toEqual({ title: 'HemCenter', body: 'Новое сообщение', tag: 'hemcenter', url: '/chats' });
    }
  });

  it('sanitises fields: wrong types, a hostile url, oversized text', () => {
    const p = sw.parsePayload(JSON.stringify({ title: 5, body: 'x'.repeat(1000), tag: null, url: 'https://evil.kz' }));
    expect(p.title).toBe('HemCenter');
    expect(p.body).toHaveLength(200);
    expect(p.tag).toBe('hemcenter');
    expect(p.url).toBe('/chats');
  });
});

describe('shouldShow', () => {
  it('stays silent while a window of the app is on screen', () => {
    expect(sw.shouldShow([{ visibilityState: 'hidden' }, { visibilityState: 'visible' }])).toBe(false);
  });

  it('shows when there is no window or all windows are hidden', () => {
    expect(sw.shouldShow([])).toBe(true);
    expect(sw.shouldShow([{ visibilityState: 'hidden' }])).toBe(true);
  });
});

describe('notificationOptions and pickClient', () => {
  it('replaces the previous notification of the same chat and remembers where to go', () => {
    const o = sw.notificationOptions({ body: 'b', tag: 'chat:7', url: '/chats/7' });
    expect(o).toMatchObject({ body: 'b', tag: 'chat:7', renotify: true, data: { url: '/chats/7' } });
  });

  it('prefers the visible window, else the first, else none', () => {
    const a = { visibilityState: 'hidden', id: 'a' };
    const b = { visibilityState: 'visible', id: 'b' };
    expect(sw.pickClient([a, b])).toBe(b);
    expect(sw.pickClient([a])).toBe(a);
    expect(sw.pickClient([])).toBeNull();
  });
});
