import { io, type Socket } from 'socket.io-client';
import { getAccessToken, refreshSession } from './api';

/**
 * Same-origin connection to /api/socket.io. Caddy (production) and Next's rewrite proxy (observed with
 * `next start`) both pass the WebSocket upgrade; if an environment only passes plain HTTP, Socket.IO
 * falls back to long-polling by itself. The access token lives 15 minutes and the server drops the
 * connection when it expires, so every connect and reconnect starts by refreshing the session.
 */
export function createSocket(): Socket {
  return io({
    path: '/api/socket.io',
    addTrailingSlash: false,
    autoConnect: false,
    reconnectionDelayMax: 10_000,
    auth: (cb) => {
      refreshSession().then(() => cb({ token: getAccessToken() }));
    },
  });
}
