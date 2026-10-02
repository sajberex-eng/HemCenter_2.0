import PizZip from 'pizzip';

export interface Para {
  text: string;
  bold?: boolean;
  /** Alignment; "both" is justified. */
  align?: 'left' | 'center' | 'right' | 'both';
  /** Font size in points (default 14). */
  size?: number;
  /** Space after the paragraph, in points. */
  after?: number;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const paragraph = (p: Para) => {
  const props = `<w:pPr><w:spacing w:after="${Math.round((p.after ?? 6) * 20)}"/><w:jc w:val="${p.align ?? 'left'}"/></w:pPr>`;
  const run = p.text
    ? `<w:r><w:rPr>${p.bold ? '<w:b/>' : ''}<w:sz w:val="${Math.round((p.size ?? 14) * 2)}"/></w:rPr><w:t xml:space="preserve">${esc(p.text)}</w:t></w:r>`
    : '';
  return `<w:p>${props}${run}</w:p>`;
};

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

/**
 * A minimal, valid .docx made of plain paragraphs. Each {field} sits inside a single run, so docxtemplater always
 * finds it whole. Used for the built-in templates; the secretary replaces them with their own Word files.
 */
export function buildDocx(paragraphs: Para[]): Buffer {
  const zip = new PizZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    'word/_rels/document.xml.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
  );
  zip.file(
    'word/styles.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${NS}><w:docDefaults><w:rPrDefault><w:rPr>` +
      '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman" w:eastAsia="Times New Roman"/><w:sz w:val="28"/><w:lang w:val="ru-RU" w:bidi="ar-SA"/>' +
      '</w:rPr></w:rPrDefault></w:docDefaults></w:styles>',
  );
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${paragraphs.map(paragraph).join('')}` +
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="850" w:bottom="1134" w:left="1701" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr></w:body></w:document>',
  );
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}
