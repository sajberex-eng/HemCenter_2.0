import swc from 'unplugin-swc';
import os from 'node:os';
import path from 'node:path';
import { defineConfig } from 'vitest/config';
import { generateVAPIDKeys } from 'web-push';

// throwaway keys, regenerated for every test run
const vapid = generateVAPIDKeys();

export default defineConfig({
  test: {
    include: ['test/**/*.e2e.ts', 'test/**/*.unit.ts'],
    globals: true,
    fileParallelism: false,
    testTimeout: 30000,
    env: {
      DATABASE_URL: 'postgresql://hemcenter:hemcenter@localhost:5432/hemcenter_test',
      JWT_SECRET: 'test-secret-test-secret-test-secret-123',
      VAPID_PUBLIC_KEY: vapid.publicKey,
      VAPID_PRIVATE_KEY: vapid.privateKey,
      DISABLE_THROTTLE: 'true',
      FILES_DIR: path.join(os.tmpdir(), 'hemcenter-test-files'),
      // existing admin tests run without 2FA; test/totp.e2e.ts turns the requirement on explicitly
      REQUIRE_ADMIN_TOTP: 'false',
    },
    globalSetup: ['test/global-setup.ts'],
  },
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
