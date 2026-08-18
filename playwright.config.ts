import { defineConfig, devices } from '@playwright/test';

/** Browser E2E against the real Worker runtime (vite dev = workerd) with the
 *  dev-only VOX fixture server replaying genuine captured pages. */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 45_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    // Allow overriding the Chromium binary in sandboxes with a preinstalled
    // browser (PW_CHROMIUM_PATH); CI uses `npx playwright install chromium`.
    launchOptions: process.env.PW_CHROMIUM_PATH
      ? { executablePath: process.env.PW_CHROMIUM_PATH }
      : {},
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'tablet', use: { ...devices['Desktop Chrome'], viewport: { width: 834, height: 1112 }, hasTouch: true } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      command: 'node scripts/vox-fixture-server.mjs 8899',
      url: 'http://127.0.0.1:8899/cinemas',
      reuseExistingServer: true,
      timeout: 15_000,
    },
    {
      command: 'npx vite dev --port 5173 --strictPort',
      url: 'http://localhost:5173/api/health',
      reuseExistingServer: true,
      timeout: 60_000,
      env: { VOX_BASE_URL: 'http://127.0.0.1:8899' },
    },
  ],
});
