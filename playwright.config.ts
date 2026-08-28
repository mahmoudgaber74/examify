import { defineConfig, devices } from '@playwright/test';
import { execFileSync } from 'node:child_process';

const port = Number(process.env.E2E_PORT ?? 4173);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;

function localSupabaseBrowserEnv() {
  const raw = execFileSync('cmd.exe', ['/c', '.\\node_modules\\.bin\\supabase.cmd', 'status', '-o', 'json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const status = JSON.parse(raw) as { API_URL?: string; ANON_KEY?: string };
  if (!status.API_URL || !status.ANON_KEY) {
    throw new Error('Supabase local status did not return API_URL and ANON_KEY for Playwright.');
  }
  return {
    VITE_SUPABASE_URL: status.API_URL,
    VITE_SUPABASE_ANON_KEY: status.ANON_KEY,
  };
}

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    locale: 'ar-EG',
  },
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${port}`,
    url: baseURL,
    env: {
      ...process.env,
      ...localSupabaseBrowserEnv(),
    },
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium-desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 900 } },
    },
    {
      name: 'chromium-mobile',
      testMatch: /responsive\.spec\.ts/,
      use: { ...devices['Pixel 5'] },
    },
  ],
});
