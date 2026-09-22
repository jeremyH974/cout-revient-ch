import { expect, test } from '@playwright/test';
import { BASE_URL } from '../../playwright.config';
import { openDemo } from './helpers/demo';
import { stubNetwork } from './helpers/network';

test.use({ serviceWorkers: 'allow' });

test('manifeste, service worker, CSP, et aucune erreur console sur le parcours', async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    // `interactive-widget` (P124) est une clé Chrome : WebKit la journalise en erreur en la
    // signalant ignorée, comme la spec le prescrit pour une clé de viewport inconnue — un
    // avertissement bénin et attendu sur ce moteur, pas une régression de ce parcours.
    if (message.type() === 'error' && !message.text().includes('interactive-widget')) {
      errors.push(message.text());
    }
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await stubNetwork(context);
  // Compteur installé dans chaque document (WebKit recharge le document sur certains `goto`).
  await context.addInitScript(() => {
    const w = window as Window & { __cspViolations?: number };
    w.__cspViolations = 0;
    document.addEventListener('securitypolicyviolation', () => {
      w.__cspViolations = (w.__cspViolations ?? 0) + 1;
    });
  });

  await page.goto('');

  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(manifestHref).toBeTruthy();
  const manifest = await page.request.get(new URL(manifestHref!, BASE_URL).toString());
  expect(manifest.ok()).toBe(true);
  const json = (await manifest.json()) as {
    id?: string;
    start_url?: string;
    scope?: string;
    name?: string;
    description?: string;
    screenshots?: { src: string; sizes: string; form_factor?: string }[];
    shortcuts?: { name: string; url: string }[];
    launch_handler?: { client_mode: string | string[] };
  };
  expect(json.start_url ?? '').toContain('/cout-revient-ch/');
  expect(json.name).toBeTruthy();

  // P124 : boîte d'installation enrichie et installation Android.
  expect(json.id).toBe('/cout-revient-ch/');
  expect(json.scope ?? '').toContain('/cout-revient-ch/');
  expect(json.description, 'description requise pour la boîte enrichie').toBeTruthy();

  expect(json.screenshots?.length).toBe(2);
  for (const shot of json.screenshots ?? []) {
    expect(shot.form_factor, `${shot.src} doit être form_factor: "narrow"`).toBe('narrow');
    // Pixels physiques du fichier (390×844 à DPR 2), pas le viewport logique.
    expect(shot.sizes).toBe('780x1688');
    const image = await page.request.get(new URL(shot.src, BASE_URL).toString());
    expect(image.ok(), `${shot.src} doit être servi`).toBe(true);
  }

  const shortcutNames = (json.shortcuts ?? []).map((s) => s.name);
  expect(shortcutNames).toEqual(['Trading', 'Trades', "Vue d'ensemble", 'Importer']);
  for (const shortcut of json.shortcuts ?? []) {
    expect(shortcut.url.startsWith('/cout-revient-ch/#')).toBe(true);
  }

  expect(json.launch_handler?.client_mode).toEqual(['navigate-existing', 'auto']);

  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', /^#/);
  await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveCount(1);

  const swState = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    const worker = registration.active;
    if (!worker) return null;
    if (worker.state !== 'activated') {
      await new Promise<void>((resolve) => {
        worker.addEventListener('statechange', () => {
          if (worker.state === 'activated') resolve();
        });
        setTimeout(resolve, 5000);
      });
    }
    return worker.state;
  });
  expect(swState).toBe('activated');

  await openDemo(page);
  await page.goto('#/asset/btc');
  await expect(page.getByRole('main')).toBeVisible();
  await page.goto('#/settings');
  await expect(page.getByRole('heading', { name: 'Aide et retours' })).toBeVisible();

  const violations = await page.evaluate(
    () => (window as Window & { __cspViolations?: number }).__cspViolations ?? -1,
  );
  expect(violations).toBe(0);
  expect(errors).toEqual([]);
});

/**
 * Le bouton d'installation (P124) : `beforeinstallprompt` n'est déclenché ni par Playwright ni par
 * un Chromium de test — il faut le simuler. `addInitScript` s'exécute avant tout script de la
 * page, donc avant `installPromptCapture()` (posé en tête de `main.ts`) ; l'événement, lui, part
 * au `load`, une fois cette capture certainement posée.
 */
test('bouton d’installation : apparaît sur un beforeinstallprompt simulé et appelle prompt()', async ({
  page,
  context,
}) => {
  await stubNetwork(context);
  await context.addInitScript(() => {
    (window as unknown as { __promptCalls: number }).__promptCalls = 0;
    window.addEventListener('load', () => {
      const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
        prompt: () => Promise<void>;
        userChoice: Promise<{ outcome: string; platform: string }>;
      };
      event.prompt = () => {
        (window as unknown as { __promptCalls: number }).__promptCalls += 1;
        return Promise.resolve();
      };
      event.userChoice = Promise.resolve({ outcome: 'accepted', platform: 'web' });
      window.dispatchEvent(event);
    });
  });

  await page.goto('#/settings');
  const install = page.getByRole('button', { name: "Installer l'application" });
  await expect(install).toBeVisible();

  await install.click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __promptCalls: number }).__promptCalls))
    .toBe(1);
  // L'invite ne se rejoue pas : le bouton disparaît une fois consommée.
  await expect(install).toBeHidden();
});

test('bouton d’installation : absent sans beforeinstallprompt, et en display-mode standalone', async ({
  page,
  context,
}) => {
  await stubNetwork(context);
  await page.goto('#/settings');
  await expect(page.getByRole('button', { name: "Installer l'application" })).toBeHidden();

  // Contre-épreuve du masquage en standalone : même invite simulée, mais `display-mode:
  // standalone` doit garder le bouton caché.
  await context.addInitScript(() => {
    window.matchMedia = ((query: string) => ({
      matches: query.includes('standalone'),
      media: query,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent: () => true,
      onchange: null,
    })) as unknown as typeof window.matchMedia;
    window.addEventListener('load', () => {
      const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
        prompt: () => Promise<void>;
        userChoice: Promise<{ outcome: string; platform: string }>;
      };
      event.prompt = () => Promise.resolve();
      event.userChoice = Promise.resolve({ outcome: 'accepted', platform: 'web' });
      window.dispatchEvent(event);
    });
  });
  await page.goto('#/settings');
  await expect(page.getByRole('button', { name: "Installer l'application" })).toBeHidden();
});
