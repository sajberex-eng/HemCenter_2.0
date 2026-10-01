import { describe, expect, it } from 'vitest';
import type { ChatDto } from '@hemcenter/shared';
import { chatTitle, colorFor, dayKey, initials, tokenize } from './chatUtils';

const kinds = (body: string, names: string[] = []) => tokenize(body, names).map((p) => `${p.kind}:${p.text}`);

describe('tokenize', () => {
  it('keeps plain text as one piece', () => {
    expect(kinds('Добрый день, коллеги')).toEqual(['text:Добрый день, коллеги']);
    expect(tokenize('', [])).toEqual([]);
  });

  it('turns http and https addresses into links and leaves sentence punctuation outside', () => {
    expect(kinds('см. https://example.kz/doc?id=1, спасибо')).toEqual(['text:см. ', 'link:https://example.kz/doc?id=1', 'text:, спасибо']);
    expect(kinds('(http://a.kz/x).')).toEqual(['text:(', 'link:http://a.kz/x', 'text:).']);
  });

  it('never makes a link out of javascript:, data: or other schemes', () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'ftp://host/file', 'vbscript:x', 'JaVaScRiPt:alert(1)']) {
      expect(tokenize(bad, []).every((p) => p.kind !== 'link')).toBe(true);
    }
  });

  it('does not touch markup: it stays text for React to escape', () => {
    const pieces = tokenize('<img src=x onerror=alert(1)> <b>hi</b>', []);
    expect(pieces).toEqual([{ kind: 'text', text: '<img src=x onerror=alert(1)> <b>hi</b>' }]);
  });

  it('highlights mentions of known names, longest name first', () => {
    expect(kinds('@Анна Петрова, посмотрите', ['Анна', 'Анна Петрова'])).toEqual(['mention:@Анна Петрова', 'text:, посмотрите']);
    expect(kinds('привет @Борис', ['Борис'])).toEqual(['text:привет ', 'mention:@Борис']);
  });

  it('does not treat regular-expression characters in names as syntax', () => {
    expect(kinds('@A.B (test) ok', ['A.B (test)'])).toEqual(['mention:@A.B (test)', 'text: ok']);
    expect(kinds('@AxB', ['A.B'])).toEqual(['text:@AxB']); // "." must not match any character
  });

  it('ignores a mention-looking text inside a link', () => {
    expect(kinds('https://x.kz/@Борис', ['Борис'])).toEqual(['link:https://x.kz/@Борис']);
  });
});

describe('helpers', () => {
  it('builds initials', () => {
    expect(initials('Анна Петрова')).toBe('АП');
    expect(initials('  Борис  ')).toBe('Б');
    expect(initials('')).toBe('?');
  });

  it('gives each person a stable colour', () => {
    expect(colorFor('user-1')).toBe(colorFor('user-1'));
    expect(colorFor('user-1')).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('names a direct chat after the other person and a group after its title', () => {
    const names: Record<string, string> = { me: 'Я', bo: 'Борис' };
    const direct = { type: 'DIRECT', title: null, members: [{ userId: 'me' }, { userId: 'bo' }] } as ChatDto;
    const group = { type: 'GROUP', title: 'Бухгалтерия', members: [] } as unknown as ChatDto;
    expect(chatTitle(direct, 'me', (id) => names[id])).toBe('Борис');
    expect(chatTitle(group, 'me', (id) => names[id])).toBe('Бухгалтерия');
  });

  it('groups messages by local calendar day', () => {
    expect(dayKey('2026-03-05T10:00:00')).toBe(dayKey('2026-03-05T23:59:00'));
    expect(dayKey('2026-03-05T10:00:00')).not.toBe(dayKey('2026-03-06T00:01:00'));
  });
});
