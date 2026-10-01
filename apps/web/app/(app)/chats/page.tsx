'use client';

import { useI18n } from '@/lib/i18n';

// The list itself lives in the layout; this is what the right-hand pane shows on desktop.
export default function ChatsIndex() {
  const { t } = useI18n();
  return <p className="text-slate-500">{t('chats.pickChat')}</p>;
}
