import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/public',
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4182',
    launchOptions: { executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] },
  },
  webServer: [{
    command: 'npm run preview -- --host 127.0.0.1 --port 4182 --strictPort',
    url: 'http://127.0.0.1:4182',
    reuseExistingServer: false,
  }, {
    command: 'npm run dev -- --host 127.0.0.1 --port 4183 --strictPort',
    url: 'http://127.0.0.1:4183',
    reuseExistingServer: false,
  }],
  projects: [
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1280, height: 900 } } },
    { name: 'mobile-touch', use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 } },
  ],
});
