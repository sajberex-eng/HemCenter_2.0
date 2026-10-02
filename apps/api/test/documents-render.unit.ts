import PizZip from 'pizzip';
import { describe, expect, it } from 'vitest';
import { buildDocx } from '../src/documents/docx-builder';
import { DEFAULT_KINDS, buildDefaultTemplate } from '../src/documents/default-templates';
import { buildContext, formatDocDate, NO_NUMBER, renderDocx, TemplateError, validateTemplate } from '../src/documents/render';

/** The visible text of a .docx, paragraphs separated by newlines. */
export function docxText(buf: Buffer): string {
  const xml = new PizZip(buf).file('word/document.xml')!.asText();
  return xml
    .split('</w:p>')
    .map((p) => p.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'))
    .join('\n');
}

const base = { org: 'Центр', title: 'О тестах', number: null, date: '2026-10-02', author: 'Анна', data: {} };

describe('context', () => {
  it('numbers lists, drops blanks and switches sections on only when they have content', () => {
    const c = buildContext({ ...base, data: { agenda: ['  один  ', '', 'два'], items: [{ text: 'сделать', responsible: 'Борис', due: '2026-10-09' }, { text: '   ' }] } });
    expect(c.agenda).toEqual([{ n: 1, text: 'один' }, { n: 2, text: 'два' }]);
    expect(c.items).toEqual([{ n: 1, text: 'сделать', responsible: 'Борис', due: '09.10.2026' }]);
    expect(c.hasAgenda && c.hasItems).toBe(true);
    expect(c.hasDecisions || c.hasParticipants || c.hasBody || c.hasPreamble).toBe(false);
  });
  it('leaves a blank for the number until the document is registered', () => {
    expect(buildContext(base).number).toBe(NO_NUMBER);
    expect(buildContext({ ...base, number: '12-ПР/2026' }).number).toBe('12-ПР/2026');
    expect(formatDocDate('2026-01-05')).toBe('05.01.2026');
  });
});

describe('built-in templates', () => {
  for (const k of DEFAULT_KINDS) {
    for (const lang of ['ru', 'kk'] as const) {
      it(`${k.code}/${lang} is a valid template and fills in`, () => {
        const tpl = buildDefaultTemplate(k.code, lang);
        expect(() => validateTemplate(tpl, lang)).not.toThrow();
        const out = docxText(
          renderDocx(tpl, buildContext({ ...base, number: '7-X/2026', data: { preamble: 'Преамбула', body: 'Текст', recipient: 'Директору', signer: 'Директор', chair: 'Председатель П', secretary: 'Секретарь С', participants: ['Участник У'], agenda: ['Вопрос В'], decisions: ['Решение Р'], items: [{ text: 'Поручение', responsible: 'Борис', due: '2026-11-01' }] } })),
        );
        for (const must of ['Центр', 'О тестах', '7-X/2026', '02.10.2026', 'Поручение', 'Борис', '01.11.2026']) expect(out).toContain(must);
        expect(out).not.toMatch(/[{}]/); // no field was left unfilled
      });
    }
  }
  it('speaks the document language', () => {
    const ctx = buildContext({ ...base, data: {} });
    expect(docxText(renderDocx(buildDefaultTemplate('ORDER', 'ru'), ctx))).toContain('ПРИКАЗЫВАЮ');
    expect(docxText(renderDocx(buildDefaultTemplate('ORDER', 'kk'), ctx))).toContain('БҰЙЫРАМЫН');
    expect(docxText(renderDocx(buildDefaultTemplate('PROTOCOL', 'kk'), ctx))).toContain('ХАТТАМА');
  });
  it('empty sections disappear instead of leaving headings', () => {
    const out = docxText(renderDocx(buildDefaultTemplate('PROTOCOL', 'ru'), buildContext(base)));
    expect(out).not.toContain('Присутствовали');
    expect(out).not.toContain('РЕШИЛИ');
    expect(out).not.toContain('Лист согласования');
  });
});

describe('safety', () => {
  it('values are text, never markup or template code', () => {
    const evil = '<w:p><w:r>HACK</w:r></w:p> & {#items}{/items} {x}';
    const out = renderDocx(buildDefaultTemplate('MEMO', 'ru'), buildContext({ ...base, title: evil }));
    const xml = new PizZip(out).file('word/document.xml')!.asText();
    expect(xml).not.toContain('<w:r>HACK');
    expect(docxText(out)).toContain(evil); // shown literally
  });
  it('refuses files that are not a usable template', () => {
    expect(() => validateTemplate(Buffer.from('not a zip'), 'ru')).toThrow(TemplateError);
    const noDoc = new PizZip();
    noDoc.file('hello.txt', 'x');
    expect(() => validateTemplate(noDoc.generate({ type: 'nodebuffer' }), 'ru')).toThrow(TemplateError);
    expect(() => validateTemplate(buildDocx([{ text: '{#items}never closed' }]), 'ru')).toThrow(TemplateError);
    expect(() => validateTemplate(buildDocx([{ text: 'closing without opening {/items}' }]), 'ru')).toThrow(TemplateError);
  });
  it('accepts a secretary template that uses only some fields', () => {
    expect(() => validateTemplate(buildDocx([{ text: 'Приказ {number} от {date}: {title}' }]), 'ru')).not.toThrow();
  });
});
