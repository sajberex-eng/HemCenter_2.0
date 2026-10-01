import * as yauzl from 'yauzl';
import { BadRequestException } from '@nestjs/common';

export interface ZipEntryInfo {
  /** Name inside the archive, directories included in the path. */
  path: string;
  /** Last path segment: the only part ever used (names are matched, never written to disk). */
  base: string;
  size: number;
  compressedSize: number;
}

export interface ZipLimits {
  maxEntries: number;
  /** Sum of all uncompressed sizes (a zip bomb is rejected before any entry is read). */
  maxTotalBytes: number;
  /** A single entry compressing better than this is not read (legitimate photos and documents are far below). */
  maxRatio: number;
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = { maxEntries: 20_000, maxTotalBytes: 3 * 1024 ** 3, maxRatio: 250 };

const baseName = (p: string) => p.replace(/\\/g, '/').split('/').pop() ?? p;

export class SafeZip {
  private constructor(
    private readonly zip: yauzl.ZipFile,
    readonly entries: ZipEntryInfo[],
    // yauzl needs its own entry objects to open a read stream; they stay valid while the archive is open
    private readonly raws: Map<string, yauzl.Entry>,
  ) {}

  /** Lists the archive without reading file contents, and refuses archives that look like bombs. */
  static open(path: string, limits: ZipLimits = DEFAULT_ZIP_LIMITS): Promise<SafeZip> {
    return new Promise((resolve, reject) => {
      yauzl.open(path, { lazyEntries: true, autoClose: false, validateEntrySizes: true, decodeStrings: true }, (err, zip) => {
        if (err || !zip) return reject(new BadRequestException('IMPORT_BAD_ARCHIVE'));
        const entries: ZipEntryInfo[] = [];
        const raws = new Map<string, yauzl.Entry>();
        let total = 0;
        const fail = (code: string) => {
          zip.close();
          reject(new BadRequestException(code));
        };
        zip.on('error', () => fail('IMPORT_BAD_ARCHIVE'));
        zip.on('entry', (e: yauzl.Entry) => {
          if (/\/$/.test(e.fileName) || e.fileName.startsWith('__MACOSX/')) return zip.readEntry();
          total += e.uncompressedSize;
          if (entries.length + 1 > limits.maxEntries) return fail('IMPORT_ARCHIVE_TOO_MANY_FILES');
          if (total > limits.maxTotalBytes) return fail('IMPORT_ARCHIVE_TOO_LARGE');
          entries.push({ path: e.fileName, base: baseName(e.fileName), size: e.uncompressedSize, compressedSize: e.compressedSize });
          raws.set(e.fileName, e);
          zip.readEntry();
        });
        zip.on('end', () => resolve(new SafeZip(zip, entries, raws)));
        zip.readEntry();
      });
    });
  }

  /** Whether an entry is plausible to read: not a decompression bomb. */
  isSuspicious(e: ZipEntryInfo, limits: ZipLimits = DEFAULT_ZIP_LIMITS): boolean {
    return e.size > 1024 * 1024 && e.size / Math.max(e.compressedSize, 1) > limits.maxRatio;
  }

  /**
   * Reads one entry fully, but never more than `maxBytes`: the stream is counted and stopped, so a lying header
   * cannot make us allocate more. Returns null when the entry is too large.
   */
  read(entry: ZipEntryInfo, maxBytes: number): Promise<Buffer | null> {
    if (entry.size > maxBytes) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      const raw = this.raws.get(entry.path);
      if (!raw) return reject(new BadRequestException('IMPORT_BAD_ARCHIVE'));
      this.zip.openReadStream(raw, (err, stream) => {
        if (err || !stream) return reject(new BadRequestException('IMPORT_BAD_ARCHIVE'));
        const chunks: Buffer[] = [];
        let n = 0;
        stream.on('data', (c: Buffer) => {
          n += c.length;
          if (n > maxBytes) {
            stream.destroy();
            resolve(null);
            return;
          }
          chunks.push(c);
        });
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.on('error', () => reject(new BadRequestException('IMPORT_BAD_ARCHIVE')));
      });
    });
  }

  close() {
    this.zip.close();
  }
}
