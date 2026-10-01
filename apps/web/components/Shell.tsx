'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useAuth } from '@/lib/auth';
import { useChats } from '@/lib/chats';
import { useI18n } from '@/lib/i18n';
import type { Key } from '@/lib/dictionaries';
import { LocaleSwitcher } from './ui';

interface NavItem {
  href: string;
  label: Key;
  admin?: boolean;
  badge?: boolean;
}

const NAV: NavItem[] = [
  { href: '/', label: 'nav.home' },
  { href: '/chats', label: 'nav.chats', badge: true },
  { href: '/staff', label: 'nav.staff' },
  { href: '/admin/users', label: 'nav.users', admin: true },
  { href: '/admin/org', label: 'nav.org', admin: true },
  { href: '/admin/audit', label: 'nav.audit', admin: true },
  { href: '/profile', label: 'nav.profile' },
];

export function Shell({ children }: { children: ReactNode }) {
  const { user, ready, isAdmin, logout } = useAuth();
  const { t } = useI18n();
  const { totalUnread } = useChats();
  const router = useRouter();
  const pathname = usePathname();

  const adminOnly = pathname.startsWith('/admin');
  // an open conversation takes the whole phone screen (own header, no bottom bar), like a messenger
  const immersive = /^\/chats\/[^/]+/.test(pathname) && !pathname.startsWith('/chats/new');
  const inChats = pathname.startsWith('/chats');

  useEffect(() => {
    if (ready && !user) router.replace('/login');
    // The API enforces roles; this just keeps non-admins out of empty admin screens.
    else if (ready && user && adminOnly && !isAdmin) router.replace('/');
    // A seeded or reset account must pick its own password before anything else.
    else if (ready && (user?.mustChangePassword || user?.mfaSetupRequired) && pathname !== '/profile') router.replace('/profile');
  }, [ready, user, adminOnly, isAdmin, pathname, router]);

  if (!ready || !user || (adminOnly && !isAdmin)) return <p className="p-6 text-slate-500">{t('loading')}</p>;

  const items = NAV.filter((i) => !i.admin || isAdmin);
  const active = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

  return (
    <div className="min-h-dvh md:flex">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200 bg-white p-4 md:flex">
        <div className="mb-6 text-lg font-semibold text-teal-800">{t('appName')}</div>
        <nav className="flex flex-1 flex-col gap-1">
          {items.map((i) => (
            <Link
              key={i.href}
              href={i.href}
              className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${active(i.href) ? 'bg-teal-50 font-medium text-teal-800' : 'text-slate-700 hover:bg-slate-100'}`}
            >
              {t(i.label)}
              {i.badge && totalUnread > 0 && <Badge n={totalUnread} />}
            </Link>
          ))}
        </nav>
        <div className="space-y-3 border-t border-slate-200 pt-3">
          <LocaleSwitcher />
          <button onClick={logout} className="block text-sm text-slate-600 hover:text-slate-900">
            {t('logout')}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className={`safe-top items-center justify-between border-b border-slate-200 bg-white px-4 py-2 md:hidden ${immersive ? 'hidden' : 'flex'}`}>
          <span className="font-semibold text-teal-800">{t('appName')}</span>
          <div className="flex items-center gap-3">
            <LocaleSwitcher />
            <button onClick={logout} className="text-sm text-slate-600">
              {t('logout')}
            </button>
          </div>
        </header>
        <main className={`mx-auto w-full flex-1 ${inChats ? 'max-w-7xl' : 'max-w-5xl'} ${immersive ? 'p-0 md:p-8' : 'p-4 pb-24 md:p-8 md:pb-8'}`}>{children}</main>
        <nav className={`safe-bottom fixed inset-x-0 bottom-0 overflow-x-auto border-t border-slate-200 bg-white md:hidden ${immersive ? 'hidden' : 'flex'}`}>
          {items.map((i) => (
            <Link
              key={i.href}
              href={i.href}
              className={`min-h-14 flex-1 whitespace-nowrap px-3 py-4 text-center text-xs ${active(i.href) ? 'font-semibold text-teal-800' : 'text-slate-600'}`}
            >
              {t(i.label)}
              {i.badge && totalUnread > 0 && <Badge n={totalUnread} />}
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}

function Badge({ n }: { n: number }) {
  return (
    <span aria-label={`${n}`} className="ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-teal-700 px-1.5 text-[11px] font-semibold leading-5 text-white">
      {n > 99 ? '99+' : n}
    </span>
  );
}
