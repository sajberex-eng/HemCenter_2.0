import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { ZipFile } from 'yazl';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_ZIP_LIMITS, SafeZip } from '../src/import/zip-reader';

let dir: string;
beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hc-zip-'));
});
afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function makeZip(name: string, files: Record<string, Buffer>, compress = true): Promise<string> {
  return new Promise((resolve, reject) => {
    const z = new ZipFile();
    for (const [n, b] of Object.entries(files)) z.addBuffer(b, n, { compress });
    z.end();
    const out = path.join(dir, name);
    const chunks: Buffer[] = [];
    z.outputStream.on('data', (c: Buffer) => chunks.push(c));
    z.outputStream.on('error', reject);
    z.outputStream.on('end', () => fs.writeFile(out, Buffer.concat(chunks)).then(() => resolve(out)));
  });
}

describe('SafeZip', () => {
  it('lists entries by base name, skipping folders and macOS metadata, and reads their content', async () => {
    const file = await makeZip('a.zip', { 'Чат WhatsApp с Тест.txt': Buffer.from('привет'), 'media/IMG-1.jpg': Buffer.from('JPEG'), '__MACOSX/._x': Buffer.from('junk') });
    const zip = await SafeZip.open(file);
    expect(zip.entries.map((e) => e.base).sort()).toEqual(['IMG-1.jpg', 'Чат WhatsApp с Тест.txt']);
    const img = zip.entries.find((e) => e.base === 'IMG-1.jpg')!;
    expect((await zip.read(img, 1000))!.toString()).toBe('JPEG');
    expect((await zip.read(zip.entries.find((e) => e.base.endsWith('.txt'))!, 1000))!.toString()).toBe('привет');
    zip.close();
  });

  it('returns null instead of reading an entry above the limit', async () => {
    const file = await makeZip('big.zip', { 'big.dat': Buffer.alloc(5000, 1) });
    const zip = await SafeZip.open(file);
    expect(await zip.read(zip.entries[0], 1000)).toBeNull();
    zip.close();
  });

  it('flags a decompression bomb without expanding it', async () => {
    // 80 MB of zeros compresses to about 80 KB: ratio ~1000
    const file = await makeZip('bomb.zip', { 'bomb.dat': Buffer.alloc(80 * 1024 * 1024) });
    const zip = await SafeZip.open(file);
    expect(zip.isSuspicious(zip.entries[0])).toBe(true);
    const normal = await makeZip('ok.zip', { 'photo.jpg': Buffer.from(Array.from({ length: 2 * 1024 * 1024 }, (_, i) => (i * 7919) % 251)) });
    const zip2 = await SafeZip.open(normal);
    expect(zip2.isSuspicious(zip2.entries[0])).toBe(false);
    zip.close();
    zip2.close();
  });

  it('refuses archives with too many files or too much total content', async () => {
    const many = await makeZip('many.zip', Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`f${i}.txt`, Buffer.from('x')])));
    await expect(SafeZip.open(many, { ...DEFAULT_ZIP_LIMITS, maxEntries: 10 })).rejects.toMatchObject({ message: 'IMPORT_ARCHIVE_TOO_MANY_FILES' });
    const large = await makeZip('large.zip', { 'a.dat': Buffer.alloc(3000), 'b.dat': Buffer.alloc(3000) });
    await expect(SafeZip.open(large, { ...DEFAULT_ZIP_LIMITS, maxTotalBytes: 5000 })).rejects.toMatchObject({ message: 'IMPORT_ARCHIVE_TOO_LARGE' });
  });

  it('rejects files that are not archives, truncated or empty', async () => {
    const notZip = path.join(dir, 'x.zip');
    await fs.writeFile(notZip, 'this is not a zip file at all');
    await expect(SafeZip.open(notZip)).rejects.toMatchObject({ message: 'IMPORT_BAD_ARCHIVE' });
    const good = await makeZip('t.zip', { 'a.txt': Buffer.from('hello world hello world') });
    const bytes = await fs.readFile(good);
    const cut = path.join(dir, 'cut.zip');
    await fs.writeFile(cut, bytes.subarray(0, bytes.length - 10));
    await expect(SafeZip.open(cut)).rejects.toMatchObject({ message: 'IMPORT_BAD_ARCHIVE' });
    const empty = path.join(dir, 'empty.zip');
    await fs.writeFile(empty, '');
    await expect(SafeZip.open(empty)).rejects.toMatchObject({ message: 'IMPORT_BAD_ARCHIVE' });
    await expect(SafeZip.open(path.join(dir, 'missing.zip'))).rejects.toMatchObject({ message: 'IMPORT_BAD_ARCHIVE' });
  });
});
