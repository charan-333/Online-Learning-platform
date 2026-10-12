import fs from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 4100);
// Use a preinstalled Chromium when one is provided (CI images, sandboxes); otherwise Playwright's own.
const executablePath = process.env.CHROMIUM_PATH ?? (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /responsive\.spec\.ts/ },
  ],
  webServer: {
    command: 'bash e2e/server.sh',
    url: `http://localhost:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
  },
});
