import type { ReactNode } from 'react';
import { ChatsProvider } from '@/lib/chats';
import { Shell } from '@/components/Shell';

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <ChatsProvider>
      <Shell>{children}</Shell>
    </ChatsProvider>
  );
}
