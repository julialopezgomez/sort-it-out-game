import { defineConfig, devices } from '@playwright/test';

/**
 * Two kinds of end-to-end tests live in `e2e/`:
 *
 *  - `e2e/build/**`      — no Supabase needed. Verifies the production bundle,
 *                          the GitHub Pages base path and hash-route refreshes.
 *  - `e2e/multiplayer/**` — real multi-browser-context multiplayer. These require a
 *                          reachable Supabase project with the migrations applied and
 *                          E2E_SUPABASE_URL / E2E_SUPABASE_ANON_KEY set. They are
 *                          skipped (not silently passed) when credentials are absent.
 *
 * See docs/TESTING.md.
 */
const PORT = Number(process.env.E2E_PORT ?? 4173);
const BASE_PATH = process.env.VITE_BASE_PATH ?? '/sort-it-out-game/';
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: `http://localhost:${PORT}${BASE_PATH}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: executablePath ? { executablePath } : undefined,
      },
    },
  ],
  webServer: {
    command: `pnpm vite preview --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      VITE_BASE_PATH: BASE_PATH,
    },
  },
});
