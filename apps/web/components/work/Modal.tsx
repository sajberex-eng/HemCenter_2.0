'use client';

import type { ReactNode } from 'react';
import { useI18n } from '@/lib/i18n';

/** A sheet over the page: closes on the backdrop and on ×. */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/30 sm:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()} className="safe-bottom max-h-[90dvh] w-full max-w-md space-y-3 overflow-y-auto rounded-t-2xl bg-white p-4 shadow-xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button type="button" aria-label={t('chats.close')} onClick={onClose} className="min-h-11 min-w-11 rounded text-2xl text-slate-500 hover:bg-slate-100">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
