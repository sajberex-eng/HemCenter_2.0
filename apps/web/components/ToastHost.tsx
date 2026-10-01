'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useChats, type Toast } from '@/lib/chats';

const LIFETIME_MS = 6000;

function ToastItem({ toast, onOpen, onClose }: { toast: Toast; onOpen: () => void; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, LIFETIME_MS);
    return () => clearTimeout(t);
  }, [onClose]);
  return (
    <li>
      <button type="button" onClick={onOpen} data-testid="toast" className="block w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-left shadow-lg hover:bg-slate-50">
        <span className="block truncate text-sm font-semibold text-teal-800">{toast.title}</span>
        <span className="block truncate text-sm text-slate-700">{toast.body}</span>
      </button>
    </li>
  );
}

/** Pop-ups for messages that arrive in a chat you are not looking at. */
export function ToastHost() {
  const { toasts, dismissToast } = useChats();
  const router = useRouter();
  return (
    <ul role="status" aria-live="polite" className="safe-top pointer-events-none fixed inset-x-3 top-3 z-40 flex flex-col gap-2 md:inset-x-auto md:right-4 md:w-96 [&>li]:pointer-events-auto">
      {toasts.map((t) => (
        <ToastItem
          key={t.id}
          toast={t}
          onClose={() => dismissToast(t.id)}
          onOpen={() => {
            dismissToast(t.id);
            router.push(`/chats/${t.chatId}`);
          }}
        />
      ))}
    </ul>
  );
}
