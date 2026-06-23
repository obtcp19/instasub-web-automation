const { defineConfig, devices } = require('@playwright/test');
require('dotenv/config'); // load PW_USERNAME / PW_PASSWORD / BASE_URL from .env if present

/**
 * BASE_URL defaults to InstaSub staging. Override per environment, e.g.:
 *   BASE_URL=https://instasub-staging.tcpsoftware.com npx playwright test
 *
 * Authentication: the `setup` project logs in FRESH each run using
 * PW_USERNAME / PW_PASSWORD from the environment, then saves the session to
 * playwright/.auth/user.json. The browser projects reuse that state. This
 * avoids stale-session failures from a manually captured storageState.
 *
 *   export PW_USERNAME="you@example.com"
 *   export PW_PASSWORD="********"   # set in your shell, never in code
 *   npx playwright test ISE-1551 --project=chromium
 */
const BASE_URL = process.env.BASE_URL || 'https://instasub-staging.tcpsoftware.com';
const AUTH_FILE = process.env.STORAGE_STATE || 'playwright/.auth/user.json';
const isRemote = /^https?:\/\//.test(BASE_URL) && !BASE_URL.includes('localhost');

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['html'],
    ['json', { outputFile: 'test-results/results.json' }],
    ['junit', { outputFile: 'test-results/junit.xml' }],
  ],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    // Logs in fresh and writes AUTH_FILE. Runs before the browser projects.
    { name: 'setup', testMatch: /auth\.setup\.ts/ },

    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: AUTH_FILE, args: ['--start-maximized'], viewport: { width: 1920, height: 1080 } },
      dependencies: ['setup'],
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'], storageState: AUTH_FILE, args: ['--start-maximized'], viewport: { width: 1920, height: 1080 } },
      dependencies: ['setup'],
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'], storageState: AUTH_FILE, args: ['--start-maximized'], viewport: { width: 1920, height: 1080 } },
      dependencies: ['setup'],
    },
  ],

  // Only spin up a local dev server when targeting localhost.
  ...(isRemote
    ? {}
    : {
        webServer: {
          command: 'npm run dev',
          url: 'http://localhost:3000',
          reuseExistingServer: !process.env.CI,
          timeout: 120 * 1000,
        },
      }),
});
