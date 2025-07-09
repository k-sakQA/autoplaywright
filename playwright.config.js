// playwright.config.js
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests',
  timeout: 30_000,
  retries: 1,
  use: {
    headless: false, // セッション維持機能のため常にブラウザを表示
    viewport: { width: 1280, height: 720 },
    actionTimeout: 10_000,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
});
