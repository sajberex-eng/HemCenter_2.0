import { describe, expect, it } from 'vitest';
import { contentDisposition, hasBlockedExtension, repairFileNameEncoding, sanitizeFileName, sniffImage } from '../src/files/file-rules';

describe('blocked extensions', () => {
  it('blocks programs, scripts and anything a browser would execute', () => {
    for (const n of ['setup.exe', 'run.BAT', 'a.ps1', 'x.sh', 'page.html', 'logo.svg', 'tool.jar', 'x.apk', 'w.vbs', 'a.js', 'k.msi']) expect(hasBlockedExtension(n), n).toBe(true);
  });

  it('catches disguised names: any extension in the chain counts', () => {
    expect(hasBlockedExtension('report.pdf.exe')).toBe(true);
    expect(hasBlockedExtension('archive.exe.txt')).toBe(true);
    expect(hasBlockedExtension('.hidden.bat')).toBe(true);
  });

  it('allows ordinary office documents, images and archives', () => {
    for (const n of ['Приказ №15.docx', 'Реестр.xlsx', 'scan.pdf', 'photo.jpg', 'a.png', 'data.csv', 'notes.txt', 'pack.zip', 'без_расширения', 'протокол.pdf']) expect(hasBlockedExtension(n), n).toBe(false);
  });
});

describe('sanitizeFileName', () => {
  it('drops directory parts so a name can never point elsewhere', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('C:\\Users\\a\\secret.docx')).toBe('secret.docx');
    expect(sanitizeFileName('/abs/path/file.pdf')).toBe('file.pdf');
  });

  it('removes control characters and the bidi overrides used to fake extensions', () => {
    expect(sanitizeFileName('doc\u0000.pdf')).toBe('doc.pdf');
    expect(sanitizeFileName('invoice\u202egpj.exe')).toBe('invoicegpj.exe'); // the override is gone: it cannot disguise the extension
    expect(sanitizeFileName('a\nb.txt')).toBe('ab.txt');
  });

  it('never returns an empty or hidden-dot name and caps the length', () => {
    expect(sanitizeFileName('')).toBe('file');
    expect(sanitizeFileName('...')).toBe('file');
    expect(sanitizeFileName('.bashrc')).toBe('bashrc');
    expect(sanitizeFileName('x'.repeat(500) + '.pdf').length).toBeLessThanOrEqual(200);
    expect(sanitizeFileName('x'.repeat(500) + '.pdf').endsWith('.pdf')).toBe(true);
  });
});

describe('repairFileNameEncoding', () => {
  it('repairs UTF-8 names that were read as Latin-1', () => {
    const garbled = Buffer.from('Приказ №15.docx', 'utf8').toString('latin1');
    expect(repairFileNameEncoding(garbled)).toBe('Приказ №15.docx');
    expect(repairFileNameEncoding(Buffer.from('Құжат.pdf', 'utf8').toString('latin1'))).toBe('Құжат.pdf');
  });

  it('leaves plain ASCII and already-correct text alone', () => {
    expect(repairFileNameEncoding('report.pdf')).toBe('report.pdf');
    expect(repairFileNameEncoding('Приказ.docx')).toBe('Приказ.docx');
  });
});

describe('sniffImage', () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20)]);
  it('recognises raster formats by content', () => {
    expect(sniffImage(png)).toBe('image/png');
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe('image/jpeg');
    expect(sniffImage(Buffer.from('GIF89a......'))).toBe('image/gif');
    expect(sniffImage(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]))).toBe('image/webp');
  });

  it('refuses everything else, however the file is named', () => {
    expect(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'))).toBeNull();
    expect(sniffImage(Buffer.from('<html><script>alert(1)</script></html>'))).toBeNull();
    expect(sniffImage(Buffer.from('%PDF-1.7'))).toBeNull();
    expect(sniffImage(Buffer.alloc(0))).toBeNull();
  });
});

describe('contentDisposition', () => {
  it('carries a safe ASCII fallback and the real UTF-8 name', () => {
    const h = contentDisposition('attachment', 'Приказ №15.docx');
    expect(h).toMatch(/^attachment; filename="[\x20-\x7e]*"; filename\*=UTF-8''/);
    expect(decodeURIComponent(h.split("UTF-8''")[1])).toBe('Приказ №15.docx');
  });

  it('cannot be broken out of with quotes or newlines', () => {
    const h = contentDisposition('attachment', 'a".pdf"; x=1\r\nSet-Cookie: z');
    expect(h).not.toMatch(/[\r\n]/);
    expect(h.split(';')[1]).toBe(' filename="a_.pdf_');
  });
});
