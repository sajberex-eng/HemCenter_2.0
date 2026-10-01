import { describe, expect, it } from 'vitest';
import { confidentChoice, isKnownTimeZone, suggestUsers, titleFromFileName, type Candidate } from '../src/import/import-rules';

const staff: Candidate[] = [
  { id: 'u1', fullName: 'Петров Иван Сергеевич', phone: '+7 701 555 12 34' },
  { id: 'u2', fullName: 'Касымова Айгерим Нурлановна', phone: null },
  { id: 'u3', fullName: 'Омарова Айгерим Бауыржановна', phone: '8 (777) 000-11-22' },
  { id: 'u4', fullName: 'Ёлкин Пётр Андреевич', phone: null },
  { id: 'u5', fullName: 'Smith John', phone: null },
];
const best = (name: string) => suggestUsers(name, staff).map((s) => `${s.userId}:${s.score}`);

describe('suggestUsers', () => {
  it('matches full names in any word order and with extra words in the directory', () => {
    expect(best('Иван Петров')[0]).toBe('u1:1');
    expect(best('Петров Иван')[0]).toBe('u1:1');
    expect(best('john smith')[0]).toBe('u5:1');
  });

  it('treats a one-letter word as an initial', () => {
    expect(best('Айгерим Н.')[0]).toBe('u2:1');
    expect(best('Айгерим О.')[0]).toBe('u3:1');
    expect(best('И. Петров')[0]).toBe('u1:1');
  });

  it('ignores case, punctuation and е/ё', () => {
    expect(best('ПЕТР Елкин')[0]).toBe('u4:1');
    expect(best('иван-петров!!')[0]).toBe('u1:1');
  });

  it('matches phone numbers by their last ten digits, however formatted', () => {
    expect(best('+7 701 555 12 34')).toEqual(['u1:1']);
    expect(best('87015551234')).toEqual(['u1:1']);
    expect(best('+7 (777) 000 11 22')).toEqual(['u3:1']);
    expect(best('+7 700 000 00 00')).toEqual([]);
  });

  it('gives a lone first name only a weak score, and nothing for strangers', () => {
    expect(best('Айгерим').every((x) => Number(x.split(':')[1]) < 0.99)).toBe(true);
    expect(best('Неизвестный Человек')).toEqual([]);
    expect(best('')).toEqual([]);
    expect(best('😀')).toEqual([]);
  });
});

describe('confidentChoice', () => {
  it('preselects only a clear full match', () => {
    expect(confidentChoice(suggestUsers('Иван Петров', staff))?.userId).toBe('u1');
    expect(confidentChoice(suggestUsers('Айгерим Н.', staff))?.userId).toBe('u2');
  });

  it('leaves ambiguous people to a human: two colleagues called Айгерим', () => {
    expect(confidentChoice(suggestUsers('Айгерим', staff))).toBeNull();
    const tie = [{ userId: 'a', fullName: 'A', score: 1 }, { userId: 'b', fullName: 'B', score: 1 }];
    expect(confidentChoice(tie)).toBeNull();
    expect(confidentChoice([])).toBeNull();
  });
});

describe('titleFromFileName', () => {
  it('extracts the group name from the file names WhatsApp produces', () => {
    expect(titleFromFileName('Чат WhatsApp с Бухгалтерия.zip')).toBe('Бухгалтерия');
    expect(titleFromFileName('WhatsApp Chat with Team Alpha.txt')).toBe('Team Alpha');
    expect(titleFromFileName('Чат WhatsApp с Иван Петров (2).zip')).toBe('Иван Петров');
    expect(titleFromFileName('C:\\Users\\a\\Downloads\\Чат WhatsApp с Отдел кадров.zip')).toBe('Отдел кадров');
  });

  it('falls back to something sensible', () => {
    expect(titleFromFileName('_chat.txt')).toBe('_chat');
    expect(titleFromFileName('.zip')).toBe('WhatsApp');
    expect(titleFromFileName('x'.repeat(300) + '.zip').length).toBe(100);
  });
});

describe('isKnownTimeZone', () => {
  it('accepts real zones only', () => {
    expect(isKnownTimeZone('Asia/Almaty')).toBe(true);
    expect(isKnownTimeZone('UTC')).toBe(true);
    expect(isKnownTimeZone('Mars/Olympus')).toBe(false);
    expect(isKnownTimeZone('')).toBe(false);
  });
});
