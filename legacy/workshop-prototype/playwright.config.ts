import { defineConfig, devices } from '@playwright/test';

// Set CHROME_PATH to use an installed Chrome instead of Playwright's bundled Chromium.
const executablePath = process.env.CHROME_PATH || undefined;

export default defineConfig({
  testDir: 'tests',
  timeout: 45_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 900 },
    launchOptions: executablePath ? { executablePath } : {},
    trace: 'retain-on-failure',
  },
});
