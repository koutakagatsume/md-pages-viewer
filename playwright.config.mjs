import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'test/e2e',
  timeout: 20_000,
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    // Uses the Edge installed on this machine; no browser download needed.
    channel: 'msedge',
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    command: 'node scripts/serve.mjs',
    url: 'http://localhost:4173/demo/',
    reuseExistingServer: true,
  },
});
