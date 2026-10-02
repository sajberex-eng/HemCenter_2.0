import PizZip from 'pizzip';

/** The visible text of a .docx, paragraphs separated by newlines. */
export function docxText(buf: Buffer): string {
  const xml = new PizZip(buf).file('word/document.xml')!.asText();
  return xml
    .split('</w:p>')
    .map((p) => p.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'))
    .join('\n');
}

