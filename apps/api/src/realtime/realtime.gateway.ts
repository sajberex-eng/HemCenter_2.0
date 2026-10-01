import { Logger, OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma.service';
import { RealtimeService } from './realtime.service';

interface AccessToken {
  sub: string;
  tv?: number;
  purpose?: string;
  exp?: number;
}

const room = (userId: string) => `user:${userId}`;

/**
 * Live connection per signed-in device. Every user has a private room; the services emit to rooms and
 * never talk to sockets directly (see RealtimeService).
 */
@WebSocketGateway({ path: '/api/socket.io', cors: process.env.WEB_ORIGIN ? { origin: process.env.WEB_ORIGIN.split(','), credentials: true } : false })
export class RealtimeGateway implements OnGatewayConnection, OnModuleInit {
  private readonly log = new Logger(RealtimeGateway.name);
  @WebSocketServer() private server: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  onModuleInit() {
    this.realtime.attach(
      (userIds, event, payload) => {
        if (userIds.length) this.server.to([...new Set(userIds)].map(room)).emit(event, payload);
      },
      (userId) => this.server.in(room(userId)).disconnectSockets(true),
    );
  }

  /** Same rules as the REST guard: a valid access token of an active user whose permissions were not revoked. */
  async handleConnection(socket: Socket) {
    try {
      const token = socket.handshake.auth?.token;
      if (typeof token !== 'string') throw new Error('no token');
      const payload = await this.jwt.verifyAsync<AccessToken>(token);
      if (payload.purpose || payload.tv === undefined) throw new Error('not an access token');
      const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
      if (!user || !user.isActive || user.tokenVersion !== payload.tv) throw new Error('revoked');
      await socket.join(room(user.id));
      socket.data.userId = user.id;

      // A connection outlives its token otherwise. Cut it when the token expires: the client reconnects
      // with a freshly refreshed token, so revocations take effect within one token lifetime at the latest.
      if (payload.exp) {
        const timer = setTimeout(() => socket.disconnect(true), Math.max(payload.exp * 1000 - Date.now(), 0));
        socket.once('disconnect', () => clearTimeout(timer));
      }
    } catch (e) {
      this.log.debug(`socket rejected: ${(e as Error).message}`);
      socket.emit('auth:error', { code: 'UNAUTHORIZED' });
      socket.disconnect(true);
    }
  }
}
