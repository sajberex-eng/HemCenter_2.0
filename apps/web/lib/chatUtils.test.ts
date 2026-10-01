import { describe, expect, it } from 'vitest';
import type { ChatDto } from '@hemcenter/shared';
import { chatTitle, colorFor, completeMention, dayKey, highlight, initials, mentionQueryAt, snippet, tokenize } from './chatUtils';

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

describe('mention typing', () => {
  it('finds the query after an @ at the start or after whitespace', () => {
    expect(mentionQueryAt('@')).toBe('');
    expect(mentionQueryAt('Привет @Бо')).toBe('Бо');
    expect(mentionQueryAt('Привет, @')).toBe('');
  });

  it('keeps suggesting while a full name with spaces is typed', () => {
    expect(mentionQueryAt('Коллеги, @Борис Те')).toBe('Борис Те');
  });

  it('ignores @ inside words such as e-mail addresses, and stops at a newline or a second @', () => {
    expect(mentionQueryAt('пишите на ivan@mail.kz')).toBeNull();
    expect(mentionQueryAt('@Анна\nдальше')).toBeNull();
    expect(mentionQueryAt('@Анна и @Бо')).toBe('Бо');
    expect(mentionQueryAt('обычный текст')).toBeNull();
  });

  it('does not search for absurdly long queries', () => {
    expect(mentionQueryAt('@' + 'x'.repeat(41))).toBeNull();
  });

  it('replaces the unfinished mention with the full name', () => {
    expect(completeMention('Коллеги, @Бор', 'Борис Тестов')).toBe('Коллеги, @Борис Тестов ');
    expect(completeMention('@', 'Анна Петрова')).toBe('@Анна Петрова ');
  });
});

describe('highlight', () => {
  const marks = (t: string, q: string) => highlight(t, q).map((m) => `${m.hit ? '[' : ''}${m.text}${m.hit ? ']' : ''}`).join('');

  it('marks every occurrence regardless of case', () => {
    expect(marks('Приказ и приказы', 'приказ')).toBe('[Приказ] и [приказ]ы');
    expect(marks('Қазақстан', 'ҚАЗАҚ')).toBe('[Қазақ]стан');
  });

  it('treats the search text literally, not as a pattern', () => {
    expect(marks('цена 1.5 (скидка)', '(скидка)')).toBe('цена 1.5 [(скидка)]');
    expect(marks('a.b axb', 'a.b')).toBe('[a.b] axb');
    expect(marks('100% и 1000', '100%')).toBe('[100%] и 1000');
    expect(marks('[x] y', '[x]')).toBe('[[x]] y');
  });

  it('returns the text untouched when there is nothing to mark', () => {
    expect(highlight('текст', '')).toEqual([{ text: 'текст', hit: false }]);
    expect(highlight('текст', 'нет')).toEqual([{ text: 'текст', hit: false }]);
    expect(highlight('', 'нет')).toEqual([{ text: '', hit: false }]);
  });
});

describe('snippet', () => {
  it('shortens a long message around the first hit', () => {
    const long = 'а'.repeat(200) + ' ПРИКАЗ ' + 'б'.repeat(200);
    const s = snippet(long, 'приказ');
    expect(s.startsWith('…')).toBe(true);
    expect(s.endsWith('…')).toBe(true);
    expect(s.toLowerCase()).toContain('приказ');
    expect(s.length).toBeLessThan(120);
  });

  it('keeps short messages whole', () => {
    expect(snippet('короткий текст', 'текст')).toBe('короткий текст');
  });
});
