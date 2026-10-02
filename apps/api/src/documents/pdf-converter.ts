import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';

/** Turns a .docx into a PDF. Gotenberg in production, a local LibreOffice where there is none (development, tests). */
export abstract class PdfConverter {
  abstract toPdf(docx: Buffer): Promise<Buffer>;
}

const TIMEOUT_MS = 90_000;

@Injectable()
export class LibreOfficeConverter extends PdfConverter {
  private readonly log = new Logger('PdfConverter');
  // one conversion at a time: LibreOffice cannot share a profile between parallel runs
  private queue: Promise<unknown> = Promise.resolve();

  toPdf(docx: Buffer): Promise<Buffer> {
    const run = this.queue.then(() => this.convert(docx));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async convert(docx: Buffer): Promise<Buffer> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hc-pdf-'));
    const input = path.join(dir, 'document.docx');
    try {
      await fs.writeFile(input, docx);
      await new Promise<void>((resolve, reject) => {
        execFile(
          process.env.SOFFICE_BIN || 'soffice',
          ['--headless', '--norestore', `-env:UserInstallation=file://${path.join(dir, 'profile')}`, '--convert-to', 'pdf', '--outdir', dir, input],
          { timeout: TIMEOUT_MS, env: { ...process.env, HOME: dir } },
          (err) => (err ? reject(err) : resolve()),
        );
      });
      return await fs.readFile(path.join(dir, 'document.pdf'));
    } catch (e) {
      this.log.error(`conversion failed: ${(e as Error).message}`);
      throw new ServiceUnavailableException('PDF_UNAVAILABLE');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
}

@Injectable()
export class GotenbergConverter extends PdfConverter {
  private readonly log = new Logger('PdfConverter');

  async toPdf(docx: Buffer): Promise<Buffer> {
    try {
      const form = new FormData();
      form.append('files', new Blob([new Uint8Array(docx)]), 'document.docx');
      const res = await fetch(`${process.env.GOTENBERG_URL!.replace(/\/$/, '')}/forms/libreoffice/convert`, { method: 'POST', body: form, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(`Gotenberg answered ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      this.log.error(`conversion failed: ${(e as Error).message}`);
      throw new ServiceUnavailableException('PDF_UNAVAILABLE');
    }
  }
}

export const pdfConverterFactory = {
  provide: PdfConverter,
  useFactory: (): PdfConverter => (process.env.GOTENBERG_URL ? new GotenbergConverter() : new LibreOfficeConverter()),
};
