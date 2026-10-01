import { defineConfig } from '@playwright/test';

// Chromium is preinstalled in the dev container; elsewhere run `npx playwright install chromium`.
const executablePath = process.env.CHROMIUM_PATH ?? (process.env.PLAYWRIGHT_BROWSERS_PATH ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined);

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  workers: 1,
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
    launchOptions: { executablePath, args: ['--no-sandbox', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run'] },
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'phone', use: { viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true } },
  ],
});
