import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: 'http://127.0.0.1:4317',
    viewport: { width: 1512, height: 982 },
    launchOptions: existsSync(chrome) ? { executablePath: chrome } : {},
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:4317',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
    env: { QUESTION_LAB_DATA_DIR: '.local/e2e' },
  },
});
