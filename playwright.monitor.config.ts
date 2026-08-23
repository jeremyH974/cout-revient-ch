/**
 * Surveillance synthétique : mêmes outils que les tests E2E, mais contre le site EN LIGNE
 * (pas de serveur local, pas de stub réseau). Lancée par `.github/workflows/monitor.yml`.
 */
import { defineConfig, devices } from '@playwright/test';

export const MONITOR_BASE_URL =
  process.env['MONITOR_BASE_URL'] ?? 'https://jeremyh974.github.io/cout-revient-ch/';

export default defineConfig({
  testDir: 'tests/monitor',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  retries: 2,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['json', { outputFile: 'monitor-results/playwright.json' }]],
  use: {
    baseURL: MONITOR_BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    serviceWorkers: 'block',
    ...devices['Desktop Chrome'],
  },
});
