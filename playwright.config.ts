import { defineConfig } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:3100',
    viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:3100',
    reuseExistingServer: false,
    env: {
      PORT: '3100',
      MAEK_DATA_DIR: mkdtempSync(path.join(tmpdir(), 'maek-browser-test-'))
    }
  }
})
