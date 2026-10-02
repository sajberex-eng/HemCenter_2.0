'use client';

import { useEffect, useState } from 'react';
import { api } from './api';
import { useChats } from './chats';

/** How many documents wait for this person's decision; refreshed whenever a document changes. */
export function useAwaitingDocs(): number {
  const { subscribe } = useChats();
  const [count, setCount] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () => api<{ count: number }>('/documents/awaiting-count').then((r) => alive && setCount(r.count), () => undefined);
    void load();
    const off = subscribe((e) => {
      if (e.type === 'document:updated' || e.type === 'resync') void load();
    });
    return () => {
      alive = false;
      off();
    };
  }, [subscribe]);
  return count;
}
