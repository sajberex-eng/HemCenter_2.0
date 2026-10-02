'use client';

import { useCallback, useEffect, useState } from 'react';
import type { NotificationDto } from '@hemcenter/shared';
import { api } from './api';
import { useChats } from './chats';

/** The person's notification list with its unread counter; refreshes when a new line arrives. */
export function useNotifications() {
  const { subscribe } = useChats();
  const [state, setState] = useState<{ items: NotificationDto[]; unread: number }>({ items: [], unread: 0 });
  const load = useCallback(() => api<{ items: NotificationDto[]; unread: number }>('/notifications').then(setState, () => undefined), []);
  useEffect(() => {
    void load();
    return subscribe((e) => {
      if (e.type === 'notification:new' || e.type === 'resync') void load();
    });
  }, [load, subscribe]);
  const markRead = useCallback(async (ids?: string[]) => setState(await api('/notifications/read', { method: 'POST', body: ids ? { ids } : {} })), []);
  return { ...state, reload: load, markRead };
}
