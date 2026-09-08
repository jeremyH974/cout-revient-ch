/**
 * Courbe de patrimoine : ce qui n'est pas coté se **hachure**, et se nomme.
 *
 * Avant la décision n° 114, un seul actif sans historique suffisait à faire passer la journée
 * entière pour une estimation : la courbe perdait sa couleur gain/perte sur toute la période où cet
 * actif était détenu — les deux tiers d'un historique réel — et rien, sur cet écran, ne disait quel
 * actif en était la cause. Cette spec tient les deux bouts : la couleur SURVIT, et le coupable est
 * nommé.
 *
 * Le montage prive `pepe` de tout historique quotidien (CoinGecko et Coinbase ; Kraken ne connaît que
 * BTC/ETH/SOL, DefiLlama est inerte en E2E) sans toucher à sa cotation du jour — `openDemo` attend
 * justement que plus aucun prix ne manque. PEPE est une position de l'espace Investissement, donc un
 * producteur de CETTE courbe, et sa part y pèse : le stub d'historique rend le même cours synthétique
 * pour tous les actifs (`stubPrice`), si bien qu'un jeton à très grosse quantité domine le total.
 * Viser un actif marginal ne prouverait rien — sa part retomberait sous le seuil d'affichage.
 */
import { expect, test, type Page } from '@playwright/test';
import { openDemo } from './helpers/demo';
import { stubNetwork } from './helpers/network';

const CARD = 'section[aria-labelledby="net-worth-title"]';

test.beforeEach(async ({ context }) => {
  await stubNetwork(context);
});

/** Coupe l'historique quotidien de PEPE chez les deux fournisseurs qui le servent. */
async function withoutPepeHistory(page: Page): Promise<void> {
  const empty = (body: unknown) => ({
    status: 200,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(body),
  });
  await page.route(/\/coins\/pepe\/market_chart/i, (route) => route.fulfill(empty({ prices: [] })));
  await page.route(/\/products\/PEPE-EUR\/candles/i, (route) => route.fulfill(empty([])));
}

/**
 * Attend la fin du chargement de l'historique QUOTIDIEN, qui suit celui des cotations du jour de
 * plusieurs secondes. Sans cette attente, les 31 premiers points sont encore portés au coût (seul
 * le point du jour a un prix) et la spec mesurerait un écran en cours de remplissage — mesuré :
 * 76,7 % de la valeur « au coût » à ce moment-là. Le pied de la carte d'évolution ne nomme ses
 * sources qu'une fois `loadDailyHistory` terminé : c'est le signal, et il est déterministe.
 */
async function waitForDailyHistory(page: Page): Promise<void> {
  await page.goto('#/invest');
  await expect(page.locator('section.evolution footer')).toContainText('Sources :', {
    timeout: 30_000,
  });
}

/** Nombre de zones hachurées et de tronçons colorés de la courbe de patrimoine. */
async function chartShape(page: Page): Promise<{ hatched: number; colored: number }> {
  const svg = page.locator(`${CARD} svg`).first();
  await expect(svg).toBeVisible();
  return {
    hatched: await svg.locator('rect[fill^="url(#"]').count(),
    colored: await svg.locator('path.line.gain, path.line.loss').count(),
  };
}

test('un actif sans historique : la zone est hachurée, la couleur reste, et l’actif est nommé', async ({
  page,
}) => {
  await withoutPepeHistory(page);
  await openDemo(page);
  await waitForDailyHistory(page);
  await page.goto('#/');
  await expect(page.getByRole('heading', { level: 1, name: "Vue d'ensemble" })).toBeVisible();
  await expect(page.getByTestId('net-worth-latest')).toBeVisible();

  // 1. Le coupable est nommé, et l'écran dit quoi en faire.
  const quotes = page.getByTestId('net-worth-quotes');
  await expect(quotes).toContainText('Sans cotation :');
  await expect(quotes).toContainText('PEPE');

  // 2. La trame situe l'incertitude…
  const shape = await chartShape(page);
  expect(shape.hatched).toBeGreaterThan(0);
  // 3. …et la couleur, elle, n'a pas disparu. C'est TOUTE la régression que cette spec surveille :
  // la version précédente rendait `ref()` nul sur ces points, donc zéro tronçon coloré.
  expect(shape.colored).toBeGreaterThan(0);

  // 4. La légende du graphique annonce l'ampleur, pas seulement le fait.
  const legend = page.locator(CARD).getByRole('list', { name: 'Légende' });
  await expect(legend).toContainText(/porté au coût, faute de cotation/);
  // « 0,0 % » à côté d'une zone hachurée ferait mentir l'un des deux : sous la résolution
  // d'affichage, la légende dit « moins de 0,1 % ».
  await expect(legend).toContainText(/(jusqu'à \d+[,.]\d+|moins de 0,1) % de la valeur/);
  await expect(legend).not.toContainText(/0,0 % de la valeur/);
});

test('rien de significatif au coût : aucune trame, aucun actif nommé', async ({ page }) => {
  await openDemo(page);
  await waitForDailyHistory(page);
  await page.goto('#/');
  await expect(page.getByTestId('net-worth-latest')).toBeVisible();

  /*
   * Contrôle négatif. La démo contient bien un actif à l'historique incomplet (HYPE), mais sa part
   * du patrimoine est imperceptible : elle ne déplace pas la courbe. Ni trame, ni accusation —
   * sinon l'écran inquiéterait sans rien apprendre, et le texte contredirait le dessin.
   */
  await expect(page.getByTestId('net-worth-quotes')).toHaveCount(0);
  const shape = await chartShape(page);
  expect(shape.hatched).toBe(0);
  expect(shape.colored).toBeGreaterThan(0);
});
