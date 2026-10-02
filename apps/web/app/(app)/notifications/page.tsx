'use client';

import Link from 'next/link';
import type { NotificationDto } from '@hemcenter/shared';
import { useI18n } from '@/lib/i18n';
import { useNotifications } from '@/lib/notifications';
import type { Key } from '@/lib/dictionaries';
import { Button, Card, PageTitle } from '@/components/ui';

const stamp = (iso: string, locale: string) => new Intl.DateTimeFormat(locale === 'kk' ? 'kk-KZ' : 'ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));

export default function NotificationsPage() {
  const { t, locale } = useI18n();
  const { items, unread, markRead } = useNotifications();
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PageTitle>{t('notif.title')}</PageTitle>
        {unread > 0 && <Button variant="secondary" onClick={() => void markRead()}>{t('notif.markAll')}</Button>}
      </div>
      {items.length === 0 && <p className="text-slate-500">{t('notif.empty')}</p>}
      <Card className="p-0">
        <ul className="divide-y divide-slate-100">
          {items.map((n: NotificationDto) => (
            <li key={n.id} data-testid="notification" data-read={n.read}>
              <Link href={n.assignmentId ? `/assignments/${n.assignmentId}` : '/assignments'} onClick={() => !n.read && void markRead([n.id])} className={`flex min-h-14 items-center justify-between gap-3 px-4 py-2 hover:bg-slate-50 ${n.read ? 'text-slate-600' : 'font-medium'}`}>
                <span>{!n.read && <span aria-hidden="true" className="mr-2 inline-block h-2 w-2 rounded-full bg-teal-600" />}{t(`notif.${n.type}` as Key)}</span>
                <span className="shrink-0 text-xs font-normal text-slate-500">{stamp(n.createdAt, locale)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
