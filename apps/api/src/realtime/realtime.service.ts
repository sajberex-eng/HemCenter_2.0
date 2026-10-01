import { Global, Injectable, Module } from '@nestjs/common';
import type { ServerEvents } from '@hemcenter/shared';

type Emitter = <E extends keyof ServerEvents>(userIds: string[], event: E, payload: ServerEvents[E]) => void;

/**
 * Pushes events to connected clients. The socket gateway registers itself here; until it does
 * (and in tests that do not need sockets) emitting is a no-op, so services never depend on transport details.
 */
@Injectable()
export class RealtimeService {
  private emitter: Emitter | null = null;
  private disconnecter: ((userId: string) => void) | null = null;

  attach(emitter: Emitter, disconnecter: (userId: string) => void) {
    this.emitter = emitter;
    this.disconnecter = disconnecter;
  }

  emit<E extends keyof ServerEvents>(userIds: string[], event: E, payload: ServerEvents[E]) {
    this.emitter?.(userIds, event, payload);
  }

  /** Drops every live connection of a user (blocked, signed out everywhere, role changed). */
  disconnectUser(userId: string) {
    this.disconnecter?.(userId);
  }
}

@Global()
@Module({ providers: [RealtimeService], exports: [RealtimeService] })
export class RealtimeModule {}
