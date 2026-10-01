'use client';

import { useEffect, useState } from 'react';
import { apiBlob } from './api';

// Object URLs are cached per file for the lifetime of the page, so scrolling does not refetch images.
const cache = new Map<string, Promise<string>>();

export function blobUrl(attachmentId: string): Promise<string> {
  let p = cache.get(attachmentId);
  if (!p) {
    p = apiBlob(`/attachments/${attachmentId}`).then((b) => URL.createObjectURL(b));
    // a failed fetch must not be cached forever
    p.catch(() => cache.delete(attachmentId));
    cache.set(attachmentId, p);
  }
  return p;
}

export function useBlobUrl(attachmentId: string, enabled = true): { url: string | null; failed: boolean } {
  const [state, setState] = useState<{ url: string | null; failed: boolean }>({ url: null, failed: false });
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    blobUrl(attachmentId).then(
      (url) => alive && setState({ url, failed: false }),
      () => alive && setState({ url: null, failed: true }),
    );
    return () => {
      alive = false;
    };
  }, [attachmentId, enabled]);
  return state;
}

/** Saves a protected file under its real name. */
export async function downloadAttachment(id: string, name: string) {
  const url = await blobUrl(id);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
