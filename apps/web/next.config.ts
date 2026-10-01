import path from 'node:path';
import type { NextConfig } from 'next';

const apiUrl = process.env.API_URL ?? 'http://localhost:4000';

const config: NextConfig = {
  output: 'standalone',
  // pnpm keeps dependencies in the repository root's node_modules/.pnpm; trace from there so
  // the standalone bundle is self-contained (result: .next/standalone/apps/web/server.js).
  outputFileTracingRoot: path.resolve(process.cwd(), '../..'),
  // The browser talks to the API through the same origin, so the refresh cookie
  // (SameSite=Strict, path /api/auth) works without CORS.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }];
  },
};

export default config;
