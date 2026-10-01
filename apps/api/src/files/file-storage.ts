import { Injectable, OnModuleInit } from '@nestjs/common';
import { createReadStream, promises as fs } from 'fs';
import type { Readable } from 'stream';
import * as path from 'path';
import { randomUUID } from 'crypto';

/** Where file bytes live. Everything else talks to this interface, so moving to S3 later changes one class. */
export abstract class FileStorage {
  /** Stores the bytes and returns the key under which they can be read back. */
  abstract save(data: Buffer): Promise<string>;
  abstract exists(key: string): Promise<boolean>;
  abstract open(key: string): Readable;
  abstract remove(key: string): Promise<void>;
}

@Injectable()
export class LocalDiskStorage extends FileStorage implements OnModuleInit {
  private readonly root = path.resolve(process.env.FILES_DIR ?? './data/files');

  async onModuleInit() {
    await fs.mkdir(this.root, { recursive: true });
  }

  /** Keys are "yyyy/mm/<uuid>": generated here, never derived from anything a user sent. */
  async save(data: Buffer): Promise<string> {
    const now = new Date();
    const key = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}`;
    const target = this.resolve(key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, data, { flag: 'wx', mode: 0o640 });
    return key;
  }

  async exists(key: string): Promise<boolean> {
    return fs.stat(this.resolve(key)).then((st) => st.isFile(), () => false);
  }

  open(key: string): Readable {
    return createReadStream(this.resolve(key));
  }

  async remove(key: string): Promise<void> {
    await fs.rm(this.resolve(key), { force: true });
  }

  /** Defence in depth: whatever the key is, the result must stay inside the storage root. */
  private resolve(key: string): string {
    const full = path.resolve(this.root, key);
    if (full !== this.root && !full.startsWith(this.root + path.sep)) throw new Error('storage key escapes the root');
    return full;
  }
}
