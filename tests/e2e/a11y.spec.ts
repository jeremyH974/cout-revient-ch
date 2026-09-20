import { expect, test } from '@playwright/test';
import { expectNoViolations } from './helpers/axe';
import { openDemo } from './helpers/demo';
import { ETORO_FIXTURE } from './helpers/expected';
import { stubNetwork } from './helpers/network';

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
    '#/trading/seuil',
    '#/more',
    '#/market',
    '#/watch',
    '#/declaration',
    '#/impots',
    '#/news',
    '#/invest/alerts',
    '#/wealth/loans',
    '#/invest/titles',
    '#/wealth',
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
    '#/trading/seuil',
    '#/trading/fills',
    '#/more',
    '#/accounts',
    '#/reconciliation',
    '#/invest/second-opinion',
    '#/invest/asset/btc',
    '#/invest/alerts',
    '#/declaration',
    '#/impots',
    '#/wealth',
  ]) {
    test(`avec la démo : ${route}`, async ({ page }) => {
      await openDemo(page);
      await page.goto(route);
      await expect(page.getByRole('main')).toBeVisible();
      await expectNoViolations(page, route);
    });
  }

  /**
   * Le prévisionnel de l'écran Impôts ne s'affiche que sur l'année en cours ET une fois
   * l'historique des cours chargé : il ne peut donc pas figurer dans la liste ci-dessus, et il
   * porte pourtant un tableau, trois champs de saisie et une région `role="status"`.
   */
  test('avec la démo : #/impots, prévisionnel rempli', async ({ page }) => {
    await openDemo(page);
    await page.goto('#/invest/report');
    await expect(page.getByText('Fiscalité française (estimation)')).toBeVisible({
      timeout: 30_000,
    });
    await page.goto('#/impots');
    await page.getByLabel('Année').selectOption(String(new Date().getFullYear()));
    const block = page.locator('.forecast');
    await expect(block).toBeVisible();
    await block.getByLabel('Montant de la vente, net de frais').fill('1000');
    await expect(block.locator('table')).toBeVisible();
    await expectNoViolations(page, '#/impots (prévisionnel)');
  });

  /**
   * L'addition, elle, demande **une hypothèse de foyer et une année imposable** : elle ne peut
   * pas davantage figurer dans la liste ci-dessus, et elle porte un tableau avec un `<tfoot>`,
   * deux listes déroulantes et une région `role="status"`.
   *
   * **Le relevé de titres, et non la démo crypto** : hors ligne, l'historique des cours ne se
   * charge pas et l'article 150 VH bis reste sans assiette — la carte ne s'afficherait pas, et
   * axe passerait au vert sur une page qui ne la porte pas.
   */
  test('avec le relevé de titres : #/impots, addition remplie', async ({ page }) => {
    await page.goto('#/import');
    await page.setInputFiles('input[type="file"]', ETORO_FIXTURE);
    await expect(page.getByRole('heading', { name: 'Import réussi' })).toBeVisible();
    await page.goto('#/impots');
    await page.getByRole('radio', { name: '30 %' }).check();
    // Le millésime imposable de la démo bouge avec la date du jour : le figer ferait passer ce
    // test au vert sur une page sans carte.
    const select = page.getByLabel('Année');
    const years = await select.locator('option').allTextContents();
    for (const year of years) {
      await select.selectOption(year);
      if ((await page.locator('.bill table').count()) > 0) {
        await expectNoViolations(page, '#/impots (addition)');
        return;
      }
    }
    throw new Error(`aucune année n’a d’addition (essayées : ${years.join(', ')})`);
  });

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
   * Les mailles semaine, mois et année du calendrier de P&L (décisions n° 95 et 165) ne sont pas le
   * tableau de la maille jour mais une grille de tuiles cliquables, et elles n'apparaissent qu'après
   * un clic — donc jamais dans la liste de routes ci-dessus.
   */
  test('avec la démo : le calendrier de P&L aux mailles semaine, mois et année', async ({
    page,
  }) => {
    await openDemo(page);
    await page.goto('#/trading/stats');
    const grains = page.getByRole('radiogroup', { name: 'Maille du calendrier' });
    await grains.getByRole('radio', { name: 'Mois', exact: true }).click();
    await expect(page.getByRole('list', { name: /^Mois de \d{4}$/ })).toBeVisible();
    await expectNoViolations(page, 'calendrier de P&L — maille mois');
    await grains.getByRole('radio', { name: 'Année', exact: true }).click();
    await expect(page.getByRole('list', { name: 'Années' })).toBeVisible();
    await expectNoViolations(page, 'calendrier de P&L — maille année');
    await grains.getByRole('radio', { name: 'Semaine', exact: true }).click();
    const weeks = page.getByRole('list', { name: /^Semaines de \d{4}$/ });
    await expect(weeks).toBeVisible();
    // Une semaine sélectionnée : sa liste de trades et l'état pressé de la case sont vérifiés aussi.
    await weeks.getByRole('button').first().click();
    await expect(
      page.getByRole('heading', { level: 3, name: /^Réalisé en semaine/ }),
    ).toBeVisible();
    // Le clic a fait défiler la page, et la barre du haut, fixe, recouvre alors les onglets : axe y
    // verrait une cible masquée qui n'a rien à voir avec la grille. On revient en haut, comme les
    // autres vérifications de ce fichier.
    await page.evaluate(() => window.scrollTo(0, 0));
    await expectNoViolations(page, 'calendrier de P&L — maille semaine');
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
