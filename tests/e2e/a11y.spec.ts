import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { openDemo } from './helpers/demo';
import { stubNetwork } from './helpers/network';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function expectNoViolations(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const summary = results.violations.map(
    (v) =>
      `${v.id} (${v.impact ?? '?'}) : ${v.help} — ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
  );
  expect(summary, `violations axe sur ${label}`).toEqual([]);
}

test.beforeEach(async ({ context }) => {
  await stubNetwork(context);
});

test.describe('accessibilité (axe, WCAG 2.2 AA)', () => {
  for (const route of [
    '#/welcome',
    '#/import',
    '#/add',
    '#/accounts',
    '#/reconciliation',
    '#/invest/second-opinion',
    '#/help',
    '#/privacy',
    '#/settings',
    '#/trading',
    '#/trading/add',
    '#/more',
    '#/market',
    '#/watch',
    '#/news',
    '#/invest/alerts',
  ]) {
    test(`sans données : ${route}`, async ({ page }) => {
      await page.goto(route);
      await expect(page.getByRole('main')).toBeVisible();
      await expectNoViolations(page, route);
    });
  }

  for (const route of [
    '#/',
    '#/asset/btc',
    '#/settings',
    '#/report',
    '#/invest',
    '#/trading',
    '#/trading/trades',
    '#/trading/stats',
    '#/trading/fills',
    '#/more',
    '#/accounts',
    '#/reconciliation',
    '#/invest/second-opinion',
    '#/invest/asset/btc',
    '#/invest/alerts',
  ]) {
    test(`avec la démo : ${route}`, async ({ page }) => {
      await openDemo(page);
      await page.goto(route);
      await expect(page.getByRole('main')).toBeVisible();
      await expectNoViolations(page, route);
    });
  }

  /**
   * Le détail d'un trade est l'écran le plus interactif de l'app (formulaire de journal, plan,
   * étiquettes, graphique) — donc celui où une violation est la plus probable. Son hash porte un
   * identifiant : il ne peut pas figurer dans la liste ci-dessus, et il était le seul écran à
   * n'être jamais passé sous axe.
   */
  /**
   * La feuille « Pourquoi ce chiffre ? » (P61) est un arbre dépliable ouvert dans un `<dialog>` :
   * la structure la plus riche de l'application en attributs implicites (disclosure, `<dl>`,
   * piège de focus). Elle ne peut pas figurer dans la liste ci-dessus — il faut la déplier.
   */
  test('avec la démo : la feuille « Pourquoi ce chiffre ? », entièrement dépliée', async ({
    page,
  }) => {
    await openDemo(page);
    await page.goto('#/invest/asset/btc');
    await page.locator('header.hero').locator('button.why').first().click();
    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();
    await sheet.getByRole('button', { name: 'Tout déplier' }).click();
    await expectNoViolations(page, 'feuille « Pourquoi ce chiffre ? »');
  });

  /**
   * Les mailles mois et année du calendrier de P&L (décision n° 95) ne sont pas le tableau de la
   * maille jour mais une grille de tuiles cliquables, et elles n'apparaissent qu'après un clic —
   * donc jamais dans la liste de routes ci-dessus.
   */
  test('avec la démo : le calendrier de P&L aux mailles mois et année', async ({ page }) => {
    await openDemo(page);
    await page.goto('#/trading/stats');
    const grains = page.getByRole('radiogroup', { name: 'Maille du calendrier' });
    await grains.getByRole('radio', { name: 'Mois', exact: true }).click();
    await expect(page.getByRole('list', { name: /^Mois de \d{4}$/ })).toBeVisible();
    await expectNoViolations(page, 'calendrier de P&L — maille mois');
    await grains.getByRole('radio', { name: 'Année', exact: true }).click();
    await expect(page.getByRole('list', { name: 'Années' })).toBeVisible();
    await expectNoViolations(page, 'calendrier de P&L — maille année');
  });

  test('avec la démo : #/trading/trade/<id> (détail et journal)', async ({ page }) => {
    await openDemo(page);
    await page.goto('#/trading/trades');
    await page
      .getByRole('link', { name: /Long|Short/ })
      .first()
      .click();
    await expect(page).toHaveURL(/#\/trading\/trade\//);
    await expect(page.getByRole('main')).toBeVisible();
    await expectNoViolations(page, '#/trading/trade/<id>');
  });
});
