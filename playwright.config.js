import { defineConfig, devices } from '@playwright/test';

const port = process.env.PORT || 3000;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './e2e',
  webServer: {
    command: 'npm start',
    url: `${baseURL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
  use: { baseURL, headless: true },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
