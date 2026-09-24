import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/browser',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  workers: 1,
  reporter: 'list',
  outputDir: '.tmp-browser-results',
  use: {
    baseURL: 'http://127.0.0.1:8444',
    timezoneId: 'America/Sao_Paulo',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {},
  },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js --config tests/browser/vite.config.ts',
    url: 'http://127.0.0.1:8444/tests/browser/fixture.html',
    reuseExistingServer: false,
  },
})
