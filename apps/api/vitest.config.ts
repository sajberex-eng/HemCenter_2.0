import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.e2e.ts'],
    globals: true,
    fileParallelism: false,
    testTimeout: 30000,
    env: {
      DATABASE_URL: 'postgresql://hemcenter:hemcenter@localhost:5432/hemcenter_test',
      JWT_SECRET: 'test-secret-test-secret-test-secret-123',
      DISABLE_THROTTLE: 'true',
      // existing admin tests run without 2FA; test/totp.e2e.ts turns the requirement on explicitly
      REQUIRE_ADMIN_TOTP: 'false',
    },
    globalSetup: ['test/global-setup.ts'],
  },
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
