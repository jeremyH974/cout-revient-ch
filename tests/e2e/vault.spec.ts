import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { openDemo } from './helpers/demo';
import { stubNetwork } from './helpers/network';

/**
 * Le coffre, de bout en bout, sur le build réel.
 *
 * Les tests unitaires prouvent la cryptographie et le câblage de la persistance. Ce qu'ils ne
 * peuvent pas prouver, c'est ce que voit quelqu'un qui rouvre l'application le lendemain : une
 * porte, et rien d'autre. C'est aussi le seul endroit où l'écran de verrouillage passe sous axe —
 * aucune route ne le rend, puisqu'il remplace justement le routeur.
 */

const MOT_DE_PASSE = 'phrase de test du coffre';

/**
 * Les confirmations passent par des toasts, qui s'effacent seuls au bout de 4,5 s. Sous charge —
 * la suite tourne en parallèle — l'assertion arrivait après leur disparition, et le test échouait
 * en accusant le coffre. On lit donc l'état DURABLE de l'écran : quand un coffre est installé, la
 * section n'offre plus « Installer », elle offre « Verrouiller maintenant ».
 */
const COFFRE_POSE = 'Verrouiller maintenant';
const COFFRE_ABSENT = 'Installer le coffre';
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

test.beforeEach(async ({ context, browserName }) => {
  test.skip(browserName !== 'chromium', 'Argon2id coûte quelques secondes par dérivation');
  await stubNetwork(context);
});

/**
 * Attend que la persistance débouncée ait écrit.
 *
 * `openDemo` rend la main dès que les prix sont affichés — mais chaque cotation appliquée est une
 * mutation d'état, et l'enregistrement part 300 ms après la dernière. Lire le stockage juste après
 * revient à le lire avant qu'il n'existe : le test échouait en accusant le coffre d'un retard qui
 * n'est pas le sien.
 */
async function waitForPersisted(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => (localStorage.getItem('crch:v1:state') ?? '').length), {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);
}

/** Ce que contient réellement le stockage du navigateur, vu depuis la page. */
async function readStorage(page: Page): Promise<{ miroir: string; idb: string }> {
  return page.evaluate(async () => {
    const miroir = localStorage.getItem('crch:v1:state') ?? '';
    const idb = await new Promise<string>((resolve) => {
      const request = indexedDB.open('crch-state', 1);
      request.onsuccess = () => {
        const get = request.result.transaction('state', 'readonly').objectStore('state').get('v1');
        get.onsuccess = () => resolve(JSON.stringify(get.result ?? null));
        get.onerror = () => resolve('');
      };
      request.onerror = () => resolve('');
    });
    return { miroir, idb };
  });
}

test('installer, verrouiller, rouvrir, retirer', async ({ page }) => {
  // Quatre dérivations Argon2id aux paramètres OWASP : plusieurs secondes chacune, par conception.
  test.slow();
  await openDemo(page);
  await waitForPersisted(page);

  const avant = await readStorage(page);
  expect(avant.miroir, 'sans coffre, tout est en clair — c’est le point de départ').toContain(
    'rawRows',
  );

  // — Installation —
  await page.goto('#/settings');
  await page.getByRole('button', { name: 'Installer le coffre' }).click();
  await page.getByLabel('Nouveau mot de passe', { exact: true }).fill(MOT_DE_PASSE);
  await page.getByLabel('Répéter le nouveau mot de passe').fill(MOT_DE_PASSE);
  await page.getByRole('button', { name: 'Installer et chiffrer' }).click();
  await expect(page.getByRole('button', { name: COFFRE_POSE })).toBeVisible();

  const apres = await readStorage(page);
  expect(apres.miroir).toMatch(/^crch-sealed\.1\./);
  /*
   * On cherche des jetons LONGS (`rawRows`, `importId`), jamais un ticker de trois lettres : du
   * base64 aléatoire contient tôt ou tard n'importe quel motif court, et un tel test échouerait
   * au hasard sans rien dire de vrai.
   */
  for (const jeton of ['rawRows', 'importId', 'schemaVersion']) {
    expect(apres.miroir, `« ${jeton} » ne doit pas rester en clair`).not.toContain(jeton);
    expect(apres.idb, `« ${jeton} » ne doit pas rester en clair`).not.toContain(jeton);
  }
  expect(apres.idb).toContain('sealed');

  // — Rechargement : la porte, et rien d'autre —
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Vos données sont chiffrées' })).toBeVisible();
  await expect(
    page.getByRole('navigation'),
    "aucune navigation n'est montée : l'application n'a rien chargé",
  ).toHaveCount(0);

  // — L'écran de verrouillage sous axe —
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(
    results.violations.map((v) => `${v.id} : ${v.help}`),
    'violations axe sur l’écran de verrouillage',
  ).toEqual([]);

  // — Mauvais mot de passe —
  const champ = page.getByLabel('Mot de passe', { exact: true });
  await champ.fill('ce n’est pas le bon');
  await page.getByRole('button', { name: 'Ouvrir' }).click();
  await expect(page.getByRole('alert')).toHaveText('Mot de passe incorrect, ou données altérées.');
  await expect(champ, 'le champ est vidé : on repart d’une page blanche').toHaveValue('');
  await expect(page.getByRole('heading', { name: 'Vos données sont chiffrées' })).toBeVisible();

  // — Le bon —
  await champ.fill(MOT_DE_PASSE);
  await page.getByRole('button', { name: 'Ouvrir' }).click();
  await expect(page.getByRole('heading', { name: 'Vos données sont chiffrées' })).toHaveCount(0);

  await page.goto('#/invest');
  await expect(page.getByRole('list', { name: 'Positions' })).toBeVisible();
  expect((await readStorage(page)).miroir, 'lire ne réécrit rien en clair').toMatch(
    /^crch-sealed\.1\./,
  );

  // — Retrait : les données redeviennent lisibles, et seulement sur mot de passe —
  await page.goto('#/settings');
  await page.getByRole('button', { name: 'Retirer le coffre' }).click();
  await page.getByLabel('Mot de passe actuel').fill(MOT_DE_PASSE);
  await page.getByRole('button', { name: 'Retirer le coffre' }).click();
  await expect(page.getByRole('button', { name: COFFRE_ABSENT })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('crch:v1:state') ?? ''))
    .toContain('rawRows');
});

test('changer de mot de passe ne rend pas les données illisibles', async ({ page }) => {
  test.slow();
  await openDemo(page);
  await waitForPersisted(page);

  await page.goto('#/settings');
  await page.getByRole('button', { name: 'Installer le coffre' }).click();
  await page.getByLabel('Nouveau mot de passe', { exact: true }).fill(MOT_DE_PASSE);
  await page.getByLabel('Répéter le nouveau mot de passe').fill(MOT_DE_PASSE);
  await page.getByRole('button', { name: 'Installer et chiffrer' }).click();
  await expect(page.getByRole('button', { name: COFFRE_POSE })).toBeVisible();

  await page.getByRole('button', { name: 'Changer le mot de passe' }).click();
  await page.getByLabel('Mot de passe actuel').fill(MOT_DE_PASSE);
  await page.getByLabel('Nouveau mot de passe', { exact: true }).fill('un tout autre secret');
  await page.getByLabel('Répéter le nouveau mot de passe').fill('un tout autre secret');
  await page.getByRole('button', { name: 'Changer', exact: true }).click();
  // Retour à l'état de repos : le formulaire se referme, la section réoffre ses trois actions.
  await expect(page.getByRole('button', { name: COFFRE_POSE })).toBeVisible();

  /*
   * Le vrai risque du changement de mot de passe n'est pas qu'il échoue : c'est qu'il réussisse en
   * laissant des données que plus rien ne peut ouvrir. On recharge donc pour de bon, et on exige
   * que les positions reviennent — l'ancien mot de passe, lui, ne doit plus rien ouvrir.
   */
  await page.reload();
  const champ = page.getByLabel('Mot de passe', { exact: true });
  await champ.fill(MOT_DE_PASSE);
  await page.getByRole('button', { name: 'Ouvrir' }).click();
  await expect(page.getByRole('alert')).toHaveText('Mot de passe incorrect, ou données altérées.');

  await champ.fill('un tout autre secret');
  await page.getByRole('button', { name: 'Ouvrir' }).click();
  // La porte doit être partie AVANT de naviguer : `#/invest` renvoie à l'accueil tant que
  // l'application n'a pas de données, et on testerait alors la redirection au lieu du coffre.
  await expect(page.getByRole('heading', { name: 'Vos données sont chiffrées' })).toHaveCount(0);
  await page.goto('#/invest');
  await expect(page.getByRole('list', { name: 'Positions' })).toBeVisible();
});
