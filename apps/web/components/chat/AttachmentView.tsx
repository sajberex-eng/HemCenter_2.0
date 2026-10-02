'use client';

import type { AttachmentDto } from '@hemcenter/shared';
import { useI18n } from '@/lib/i18n';
import { useAttachmentBase } from '@/lib/attachmentBase';
import { downloadAttachment, formatSize, useBlobUrl } from '@/lib/useBlobUrl';

function ImageAttachment({ a }: { a: AttachmentDto }) {
  const base = useAttachmentBase();
  const { url, failed } = useBlobUrl(a.id, true, base);
  if (failed) return <FileCard a={a} />;
  if (!url) return <div role="img" aria-label={a.name} className="h-32 w-48 animate-pulse rounded-lg bg-slate-200" />;
  return (
    <button type="button" onClick={() => window.open(url, '_blank', 'noopener')} className="block overflow-hidden rounded-lg" aria-label={a.name}>
      {/* a blob: URL created in this tab; next/image cannot optimise it */}
      <img src={url} alt={a.name} className="max-h-60 max-w-full object-contain" data-testid="attachment-image" />
    </button>
  );
}

function FileCard({ a }: { a: AttachmentDto }) {
  const { t } = useI18n();
  const base = useAttachmentBase();
  return (
    <button
      type="button"
      onClick={() => void downloadAttachment(a.id, a.name, base)}
      aria-label={`${t('chats.download')}: ${a.name}`}
      className="flex w-full max-w-xs items-center gap-3 rounded-lg border border-black/10 bg-black/5 px-3 py-2 text-left hover:bg-black/10"
      data-testid="attachment-file"
    >
      <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.6" className="shrink-0 text-teal-700" aria-hidden="true">
        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
        <path d="M14 3v5h5" />
      </svg>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{a.name}</span>
        <span className="block text-xs text-slate-500">{formatSize(a.size)}</span>
      </span>
    </button>
  );
}

export function AttachmentView({ a }: { a: AttachmentDto }) {
  return a.isImage ? <ImageAttachment a={a} /> : <FileCard a={a} />;
}
