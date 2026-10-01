'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { UserDto } from '@hemcenter/shared';
import { api, authRequest, refreshSession, setAccessToken } from './api';
import { useI18n } from './i18n';

interface AuthState {
  user: UserDto | null;
  ready: boolean;
  login: (login: string, password: string) => Promise<void>;
  acceptInvite: (token: string, password: string, consent: boolean) => Promise<void>;
  logout: () => Promise<void>;
  isAdmin: boolean;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserDto | null>(null);
  const [ready, setReady] = useState(false);
  const { setLocale } = useI18n();
  const router = useRouter();

  const adopt = useCallback(
    (u: UserDto | null) => {
      setUser(u);
      if (u) setLocale(u.locale);
    },
    [setLocale],
  );

  useEffect(() => {
    refreshSession().then((u) => {
      adopt(u);
      setReady(true);
    });
  }, [adopt]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      ready,
      isAdmin: !!user?.roles.includes('ADMIN'),
      login: async (login, password) => adopt(await authRequest('/auth/login', { login, password })),
      acceptInvite: async (token, password, consent) => adopt(await authRequest('/auth/accept-invite', { token, password, consent })),
      logout: async () => {
        try {
          await api('/auth/logout', { method: 'POST' });
        } finally {
          setAccessToken(null);
          setUser(null);
          router.replace('/login');
        }
      },
    }),
    [user, ready, adopt, router],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside AuthProvider');
  return v;
}
