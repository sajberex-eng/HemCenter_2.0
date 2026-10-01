import { describe, expect, it } from 'vitest';
import { detectDateOrder, parseWhatsApp } from '../src/import/whatsapp-parser';
import { zonedToUtc } from '../src/import/time';

const ANDROID_RU = `22.03.2024, 14:35 - Сообщения и звонки защищены сквозным шифрованием. Никто, кроме участников чата, не может прочитать или прослушать их.
22.03.2024, 14:35 - Иван Петров создал(а) группу «Бухгалтерия»
22.03.2024, 14:36 - Иван Петров: Добрый день, коллеги!
Прошу проверить реестр до конца дня.
Спасибо.
22.03.2024, 14:40 - Айгерим Н.: Хорошо, сделаю
23.03.2024, 09:05 - Айгерим Н.: <Медиа скрыто>
23.03.2024, 09:06 - Иван Петров: IMG-20240323-WA0001.jpg (файл добавлен)
Вот скан договора
23.03.2024, 18:00 - Иван Петров: Ссылка: https://example.kz/doc?a=1: смотрите`;

const IOS_RU = `[22.03.24, 14:35:12] Иван Петров: ‎Сообщения и звонки защищены сквозным шифрованием.
[22.03.24, 14:36:01] Иван Петров: Добрый день
[22.03.24, 14:37:44] Айгерим Н.: ‎<прикреплено: 00000012-PHOTO-2024-03-22-14-37-44.jpg>
[23.03.24, 09:00:00] Айгерим Н.: ‎<прикреплено: 00000013-DOCUMENT-2024-03-23.pdf>
Подпишите, пожалуйста`;

const ENGLISH_12H = `3/22/24, 2:35 PM - John Smith: Hello
3/22/24, 11:05 AM - Mary: Morning
3/23/24, 12:00 AM - John Smith: midnight
3/23/24, 12:30 PM - John Smith: noon`;

describe('Android (Russian locale)', () => {
  const r = parseWhatsApp(ANDROID_RU);

  it('reads authors, dates and multi-line texts', () => {
    expect(r.order).toBe('DMY');
    const talk = r.messages.filter((m) => m.author !== null);
    expect(talk).toHaveLength(5);
    expect(talk[0]).toMatchObject({ author: 'Иван Петров', local: { y: 2024, mo: 3, d: 22, h: 14, mi: 36, s: 0 } });
    expect(talk[0].text).toBe('Добрый день, коллеги!\nПрошу проверить реестр до конца дня.\nСпасибо.');
    expect(talk[1]).toMatchObject({ author: 'Айгерим Н.', text: 'Хорошо, сделаю' });
  });

  it('recognises system notices (no author) separately from talk', () => {
    const system = r.messages.filter((m) => m.author === null);
    expect(system).toHaveLength(2);
    expect(system[0].text).toContain('сквозным шифрованием');
  });

  it('knows about omitted media and attached files', () => {
    const omitted = r.messages.find((m) => m.omittedMedia)!;
    expect(omitted).toMatchObject({ author: 'Айгерим Н.', text: '', file: null });
    const withFile = r.messages.find((m) => m.file)!;
    expect(withFile).toMatchObject({ author: 'Иван Петров', file: 'IMG-20240323-WA0001.jpg', text: 'Вот скан договора' });
  });

  it('only the first ": " separates the author, so colons in the text survive', () => {
    expect(r.messages.at(-1)).toMatchObject({ author: 'Иван Петров', text: 'Ссылка: https://example.kz/doc?a=1: смотрите' });
  });
});

describe('iOS (Russian locale, two-digit year, bracketed)', () => {
  const r = parseWhatsApp(IOS_RU);
  it('reads seconds, years and attachments', () => {
    expect(r.order).toBe('DMY');
    expect(r.messages[1]).toMatchObject({ author: 'Иван Петров', text: 'Добрый день', local: { y: 2024, mo: 3, d: 22, h: 14, mi: 36, s: 1 } });
    expect(r.messages[2]).toMatchObject({ author: 'Айгерим Н.', file: '00000012-PHOTO-2024-03-22-14-37-44.jpg', text: '' });
    expect(r.messages[3]).toMatchObject({ file: '00000013-DOCUMENT-2024-03-23.pdf', text: 'Подпишите, пожалуйста' });
  });
});

describe('English, 12-hour clock, month first', () => {
  const r = parseWhatsApp(ENGLISH_12H);
  it('detects month-first order from an impossible month and converts AM/PM', () => {
    expect(r.order).toBe('MDY');
    expect(r.messages.map((m) => `${m.local.mo}-${m.local.d} ${m.local.h}:${String(m.local.mi).padStart(2, '0')}`)).toEqual(['3-22 14:35', '3-22 11:05', '3-23 0:00', '3-23 12:30']);
  });
});

describe('date order detection', () => {
  it('uses a day above 12 to decide, and the hint or day-first when every date is ambiguous', () => {
    expect(detectDateOrder([{ a: 22, b: 3 }])).toBe('DMY');
    expect(detectDateOrder([{ a: 3, b: 22 }])).toBe('MDY');
    expect(detectDateOrder([{ a: 3, b: 4 }])).toBe('DMY');
    expect(detectDateOrder([{ a: 3, b: 4 }], 'MDY')).toBe('MDY');
    const ambiguous = parseWhatsApp('03.04.2024, 10:00 - A: x');
    expect(ambiguous.messages[0].local).toMatchObject({ mo: 4, d: 3 }); // 3 April
    expect(parseWhatsApp('03/04/2024, 10:00 - A: x', 'MDY').messages[0].local).toMatchObject({ mo: 3, d: 4 });
  });
});

describe('robustness', () => {
  it('survives garbage, empty input, odd line breaks and invisible marks', () => {
    expect(parseWhatsApp('')).toMatchObject({ messages: [], skippedLines: 0 });
    expect(parseWhatsApp('просто текст\nбез дат').messages).toEqual([]);
    expect(parseWhatsApp('просто текст\nбез дат').skippedLines).toBe(2);
    const crlf = parseWhatsApp('22.03.2024, 14:35 - A: one\r\nскобка\r\n22.03.2024, 14:36 - A: two');
    expect(crlf.messages.map((m) => m.text)).toEqual(['one\nскобка', 'two']);
    const marks = parseWhatsApp('﻿[22.03.2024, 14:35:00] ‎A: hi‏');
    expect(marks.messages[0]).toMatchObject({ author: 'A', text: 'hi' });
  });

  it('skips impossible dates and times instead of failing', () => {
    expect(parseWhatsApp('31.02.2024, 25:61 - A: x').messages).toEqual([]);
    expect(parseWhatsApp('32.13.2024, 10:00 - A: x').skippedLines).toBeGreaterThan(0);
  });

  it('copes with a very large export quickly', () => {
    const big = Array.from({ length: 50_000 }, (_, i) => `22.03.2024, 14:${String(i % 60).padStart(2, '0')} - Иван: сообщение ${i}`).join('\n');
    const t = Date.now();
    expect(parseWhatsApp(big).messages).toHaveLength(50_000);
    expect(Date.now() - t).toBeLessThan(3000);
  });

  it('does not take a long system notice with a colon for a person', () => {
    const r = parseWhatsApp('22.03.2024, 14:35 - ' + 'Администратор изменил(а) тему группы на «Планёрка по закупкам и бюджету на следующий квартал: итоги» ' + '(…)');
    expect(r.messages[0].author).toBeNull();
  });
});

describe('time zones', () => {
  it('uses the offset that was valid on that date (Almaty moved from UTC+6 to UTC+5 in 2024)', () => {
    const at = (y: number, mo: number, d: number, h: number) => zonedToUtc({ y, mo, d, h, mi: 0, s: 0 }, 'Asia/Almaty').toISOString();
    expect(at(2023, 6, 15, 12)).toBe('2023-06-15T06:00:00.000Z'); // UTC+6
    expect(at(2024, 6, 15, 12)).toBe('2024-06-15T07:00:00.000Z'); // UTC+5
    expect(at(2026, 1, 1, 0)).toBe('2025-12-31T19:00:00.000Z');
  });

  it('is the identity for UTC and handles other zones', () => {
    expect(zonedToUtc({ y: 2024, mo: 3, d: 22, h: 14, mi: 35, s: 12 }, 'UTC').toISOString()).toBe('2024-03-22T14:35:12.000Z');
    expect(zonedToUtc({ y: 2024, mo: 3, d: 22, h: 14, mi: 35, s: 0 }, 'Europe/Moscow').toISOString()).toBe('2024-03-22T11:35:00.000Z');
  });
});
