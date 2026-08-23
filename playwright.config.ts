/**
 * Tests de bout en bout (Playwright) sur le build de production servi par `vite preview`.
 * `npm run e2e` construit puis lance ; en CI le build précède et `reuseExistingServer` est faux.
 * Les specs vivent dans `tests/e2e/*.spec.ts` (Vitest ne ramasse que `*.test.ts`).
 */
import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
export const BASE_URL = `http://127.0.0.1:${PORT}/cout-revient-ch/`;
const CI = process.env['CI'] === 'true';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  ...(CI ? { workers: 2 } : {}),
  reporter: CI
    ? [['list'], ['html', { open: 'never' }], ['github']]
    : [['list'], ['html', { open: 'never' }]],
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    // Le service worker est testé à part (pwa.spec.ts) ; ailleurs il fausserait les stubs réseau.
    serviceWorkers: 'block',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      // Téléchargements et presse-papiers ne sont pas fiables sous WebKit : parcours visuels seulement.
      testMatch: /(demo|theme|a11y|pwa)\.spec\.ts$/,
    },
  ],
  webServer: {
    // `--host 127.0.0.1` : sans lui, `vite preview` n'écoute que sur ::1 sur certaines machines.
    command: `npm run preview -- --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !CI,
    timeout: 60_000,
  },
});
