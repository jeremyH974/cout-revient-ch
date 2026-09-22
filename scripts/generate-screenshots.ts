/**
 * Génère les deux captures `form_factor: "narrow"` du manifeste PWA (P124) :
 *
 *   npm run screenshots
 *
 * **Uniquement sur les données d'exemple synthétiques** (`stubNetwork` + `openDemo`, comme les
 * specs E2E) : jamais un export réel, même de passage (décision n° 17). Rejouable — construit le
 * build PUBLIC (`npx vite build`), le sert par `vite preview` sur un port DÉDIÉ
 * (`SCREENSHOTS_PORT`, 4198 par défaut, jamais celui de `npm run e2e` qu'un autre worktree peut
 * tenir), puis capture à 390×844 (`iPhone 12/13/14`-like, le gabarit narrow le plus courant côté
 * Android aussi) avec DPR 2 — l'écran que Chrome montre dans la boîte d'installation enrichie.
 *
 * Écrit dans `public/screenshots/`, exclu du précache du service worker (`globIgnores` de
 * `vite.config.ts`) : ce sont des images d'installation, jamais affichées dans l'app elle-même.
 */
import { type ChildProcess, execSync, spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, expect } from '@playwright/test';
import { openDemo } from '../tests/e2e/helpers/demo';
import { stubNetwork } from '../tests/e2e/helpers/network';

const PORT = Number(process.env['SCREENSHOTS_PORT'] ?? 4198);
const BASE_URL = `http://127.0.0.1:${PORT}/cout-revient-ch/`;
const OUT_DIR = 'public/screenshots';

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      /* pas encore prêt */
    }
    if (Date.now() > deadline) {
      throw new Error(`Serveur de prévisualisation indisponible après ${timeoutMs} ms : ${url}`);
    }
    await delay(300);
  }
}

async function capture(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      baseURL: BASE_URL,
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      locale: 'fr-FR',
      timezoneId: 'Europe/Paris',
    });
    await stubNetwork(context);
    const page = await context.newPage();
    await openDemo(page);

    await page.goto('#/');
    await expect(page.getByRole('heading', { level: 1, name: "Vue d'ensemble" })).toBeVisible();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT_DIR}/overview-narrow.png` });
    console.log(`Écrit : ${OUT_DIR}/overview-narrow.png`);

    // La démo charge aussi un compte Hyperliquid fictif (`loadDemoTrading`) : le tableau de bord
    // Trading n'est donc pas un état vide.
    await page.goto('#/trading');
    await expect(page.getByRole('heading', { level: 1, name: 'Trading' })).toBeVisible();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT_DIR}/trading-narrow.png` });
    console.log(`Écrit : ${OUT_DIR}/trading-narrow.png`);
  } finally {
    await browser.close();
  }
}

async function main(): Promise<void> {
  console.log('Construction du build public (npx vite build)…');
  execSync('npx vite build', { stdio: 'inherit' });

  console.log(`Démarrage de « vite preview » sur le port ${PORT}…`);
  const server: ChildProcess = spawn(
    'npx',
    ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
    { stdio: 'inherit', shell: process.platform === 'win32' },
  );
  try {
    await waitForServer(BASE_URL, 30_000);
    await capture();
  } finally {
    server.kill();
  }
}

await main();
