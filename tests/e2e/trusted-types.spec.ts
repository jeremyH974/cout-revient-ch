/**
 * La seule vérification qui **exerce la contrainte réelle** de Trusted Types.
 *
 * Tout le reste est de l'analyse statique : `csp-build.spec.ts` lit la politique écrite dans
 * `dist/index.html` et croise les noms de politiques du bundle, mais aucun des deux ne prouve que
 * l'application _fonctionne_ sous la directive. Or c'est là qu'est le risque : avec
 * `require-trusted-types-for 'script'`, un puits d'injection non couvert par une politique déclarée
 * ne dégrade pas, il **lève une `TypeError`**. Un `innerHTML` oublié quelque part, et l'écran reste
 * blanc.
 *
 * Ce test navigue donc pour de vrai, sous la CSP réellement livrée (la suite de bout en bout sert
 * `dist/`), en écoutant deux choses : les violations de politique de sécurité que le navigateur
 * signale, et les erreurs de page. Il exige **zéro** des deux.
 *
 * En développement, aucune CSP n'est posée — c'est délibéré (Vite a besoin du websocket HMR). Cette
 * suite est par conséquent le seul endroit du projet où la directive est vraiment éprouvée.
 */
import { expect, test, type Page } from '@playwright/test';
import { openDemo } from './helpers/demo';
import { stubNetwork } from './helpers/network';

// La configuration bloque les service workers par défaut ; ce fichier en a besoin, comme
// `pwa.spec.ts`, et c'est aussi la condition la plus proche de la production.
test.use({ serviceWorkers: 'allow' });

test.beforeEach(async ({ context }) => {
  await stubNetwork(context);
});

/** Branche les deux mouchards **avant** toute navigation, et rend le tableau qu'ils remplissent. */
function watchViolations(page: Page): string[] {
  const seen: string[] = [];
  page.on('pageerror', (error) => seen.push(`erreur de page : ${error.message}`));
  // `securitypolicyviolation` porte la directive fautive et le puits touché : c'est ce qui
  // distingue un blocage Trusted Types d'un blocage `connect-src`.
  page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      (window as unknown as { __cspViolations?: string[] }).__cspViolations ??= [];
      (window as unknown as { __cspViolations: string[] }).__cspViolations.push(
        `${event.violatedDirective} → ${event.blockedURI || event.sample || '(sans détail)'}`,
      );
    });
  });
  return seen;
}

async function violationsOf(page: Page): Promise<string[]> {
  return page.evaluate(
    () => (window as unknown as { __cspViolations?: string[] }).__cspViolations ?? [],
  );
}

test('les écrans principaux se rendent sans une seule violation de politique', async ({ page }) => {
  const errors = watchViolations(page);

  await openDemo(page);

  // Chaque route rend un arbre différent, donc un jeu de gabarits différent : c'est la couverture
  // des gabarits qui compte ici, pas celle des fonctionnalités.
  for (const route of ['#/', '#/invest', '#/invest/report', '#/accounts', '#/market', '#/more']) {
    await page.goto(route);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  }

  // Une fiche actif : le gabarit le plus riche de l'application (graphique, lots, alertes).
  await page.goto('#/invest');
  await page
    .getByRole('list', { name: 'Positions' })
    .getByRole('listitem')
    .first()
    .getByRole('link')
    .first()
    .click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  expect(await violationsOf(page), 'violations de la CSP pendant la navigation').toEqual([]);
  expect(errors, 'erreurs de page pendant la navigation').toEqual([]);
});

/**
 * Le test qui manquait, et qui a coûté une panne.
 *
 * `navigator.serviceWorker.register()` est un puits `TrustedScriptURL` : sous la directive, lui
 * passer une chaîne est refusé. Et comme `registerSW` de `vite-plugin-pwa` **attrape** l'erreur pour
 * la donner à `onRegisterError`, rien ne remonte : la page se rend normalement, aucune exception,
 * aucune violation observable par un écouteur de `pageerror` — mais l'application n'a plus de
 * service worker, donc plus de hors-ligne, plus d'installation, plus de mise à jour.
 *
 * D'où la forme de ce test : il n'observe pas l'absence d'erreur, il **exige un résultat positif**.
 * C'est la seule façon d'attraper une panne que le code avale.
 */
test('le service worker s’enregistre malgré la directive', async ({ page }) => {
  await page.goto('#/welcome');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  // `navigator.serviceWorker.ready` se résout à l'enregistrement actif — le même point d'attente
  // que `pwa.spec.ts`, plutôt qu'un sondage sur `getRegistrations()`.
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  expect(scope, 'aucun service worker actif : la politique d’URL est-elle installée ?').toContain(
    '/cout-revient-ch/',
  );
});

test('la politique refuse une URL de service worker qui n’est pas la nôtre', async ({ page }) => {
  await page.goto('#/welcome');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  // L'épinglage est la raison d'être de la politique : sans lui, elle ne ferait que débloquer.
  // Le refus est **synchrone** — la politique lève avant que `register` ne rende sa promesse —
  // d'où le `try` autour de l'appel plutôt qu'un simple `.catch()`.
  const refus = await page.evaluate(async () => {
    try {
      await navigator.serviceWorker.register('/cout-revient-ch/manifest.webmanifest');
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  });
  expect(refus, 'une URL étrangère a été acceptée').toContain('refusé');
});

/**
 * jsPDF est le seul tiers du bundle à contenir encore des affectations `innerHTML`. Elles vivent sur
 * les chemins `doc.html()` et SVG, gardés par `canvg`, `html2canvas` et `dompurify` — que
 * `vite.config.ts` remplace par des stubs `undefined`, ce qui les rend inatteignables. « Réputé
 * inatteignable » n'est pas « prouvé inatteignable » : on génère donc un vrai PDF sous la directive.
 */
test('la génération du PDF ne touche aucun puits interdit', async ({ page }) => {
  const errors = watchViolations(page);

  await openDemo(page);
  await page.goto('#/invest/report');

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Télécharger le PDF' }).click();
  expect((await download).suggestedFilename()).toMatch(/\.pdf$/);

  expect(await violationsOf(page), 'violations de la CSP pendant la génération du PDF').toEqual([]);
  expect(errors, 'erreurs de page pendant la génération du PDF').toEqual([]);
});
