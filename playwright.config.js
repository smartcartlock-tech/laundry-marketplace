// Playwright e2e — מריץ את האפליקציה המלאה מול Postgres בדיקות בסכימה מבודדת (e2e).
// מקומי: משתמש ב-Chrome המותקן (channel chrome). ב-CI: chromium של Playwright.
const { defineConfig, devices } = require('@playwright/test');

const PORT = 4700;
const BASE = `http://127.0.0.1:${PORT}`;
const TEST_DB = process.env.TEST_DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5433/laundry_test';

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 45000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  workers: 1, // מסד נתונים משותף לכל הבדיקות — ריצה סדרתית
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    baseURL: BASE,
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, ...(process.env.CI ? {} : { channel: 'chrome' }) } },
    { name: 'mobile', use: { ...devices['Pixel 7'], ...(process.env.CI ? {} : { channel: 'chrome' }) } },
  ],
  webServer: {
    command: 'node src/server.js',
    url: BASE + '/health',
    timeout: 60000,
    reuseExistingServer: !process.env.CI,
    env: {
      PORT: String(PORT),
      DATABASE_URL: TEST_DB,
      PGSCHEMA: 'e2e',
      SEED_DEMO: 'true',
      DEMO_OTP: 'true',
      OTP_SCREEN_CODE: 'true',
      JWT_SECRET: 'e2e-secret',
      TWILIO_ACCOUNT_SID: '', TWILIO_AUTH_TOKEN: '', TWILIO_WHATSAPP_FROM: '',
      GOOGLE_CLIENT_ID: '', GEMINI_API_KEY: '',
    },
  },
});
