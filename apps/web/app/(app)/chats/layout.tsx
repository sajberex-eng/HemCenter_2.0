'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { ChatList } from '@/components/chat/ChatList';

/** Desktop: list and conversation side by side. Phone: one at a time. */
export default function ChatsLayout({ children }: { children: ReactNode }) {
  const inConversation = usePathname() !== '/chats';
  return (
    <div className="md:grid md:h-[calc(100dvh-4rem)] md:grid-cols-[22rem_minmax(0,1fr)] md:gap-4">
      <div className={`${inConversation ? 'hidden md:block' : ''} md:min-h-0`}>
        <ChatList />
      </div>
      <div className={`${inConversation ? '' : 'hidden md:flex'} md:min-h-0 md:items-center md:justify-center`}>{children}</div>
    </div>
  );
}
