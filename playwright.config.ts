import { defineConfig, devices } from '@playwright/test';

// Serves build/ (run "npm run build" first) and runs the end-to-end tests against it.
// Set CHROME_PATH to use an installed Chrome instead of Playwright's bundled Chromium.
const executablePath = process.env.CHROME_PATH || undefined;

export default defineConfig({
  testDir: 'tests',
  timeout: 60_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  webServer: { command: 'npx --yes serve@14 build -l 4174', port: 4174, reuseExistingServer: !process.env.CI },
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://localhost:4174/',
    viewport: { width: 1440, height: 900 },
    launchOptions: executablePath ? { executablePath } : {},
    trace: 'retain-on-failure',
  },
});
