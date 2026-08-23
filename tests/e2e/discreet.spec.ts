import { expect, test, type Locator } from '@playwright/test';
import { fmtQty } from '../../src/lib/format/fr';
import { openDemo } from './helpers/demo';
import { fixtureReport, moneyText, normalize, position, pruText } from './helpers/expected';
import { stubNetwork } from './helpers/network';

const DISCREET_BUTTON = 'Mode discret (masquer les montants)';
const MASK = '••••';
/**
 * Tout ce que rendent `Money` et `Qty` est masqué (« •••• € », « •••• BTC ») ; `Pct` (pourcentage)
 * et « — » restent lisibles. Les prix et PRU ne passent pas par ces composants : vérifiés à part.
 */
const MASKED_OR_NEUTRAL = /^(•••• [€$]|••••( [A-Z0-9]+)?|—|[+−]?\d[\d ]*,\d %)$/;

test.beforeEach(async ({ context, browserName }) => {
  test.skip(browserName !== 'chromium', 'mode discret : Chromium seulement');
  await stubNetwork(context);
});

async function expectMaskedNumbers(scope: Locator): Promise<void> {
  const nums = scope.locator('.num');
  const count = await nums.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    expect(normalize(await nums.nth(i).innerText())).toMatch(MASKED_OR_NEUTRAL);
  }
}

test('mode discret : montants et quantités masqués partout, PRU, prix et % conservés', async ({
  page,
}) => {
  const { report } = fixtureReport();
  const btc = position(report, 'btc');
  await openDemo(page);
  const toggle = page.getByRole('button', { name: DISCREET_BUTTON });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');

  // En-tête du portefeuille : tout est masqué, le ROI (pourcentage) reste lisible.
  const summary = page.locator('section.summary');
  await expect(summary).toContainText(MASK);
  await expect(summary).not.toContainText(moneyText(report.totals.realized));
  await expectMaskedNumbers(summary);

  // Lignes : quantité masquée, PRU (un prix) visible.
  const rows = page.getByRole('list', { name: 'Positions' });
  const btcRow = rows.getByRole('listitem').filter({ has: page.getByText('BTC', { exact: true }) });
  await expect(btcRow).toContainText(`PRU ${pruText(btc)}`);
  await expect(btcRow).not.toContainText(normalize(fmtQty(btc.qty, { abbreviate: true })));
  await expectMaskedNumbers(rows);

  // Abonnements : le libellé suit le réglage « déduire du P&L ».
  expect(report.totals.subscriptionsEur.gt('0')).toBe(true);
  await expect(summary).toContainText('hors P&L');
  await page.goto('#/settings');
  await page.getByRole('checkbox', { name: /Déduire les abonnements/ }).check();
  await page.goto('#/');
  await expect(summary).toContainText('déduits du P&L');
  await expect(summary).not.toContainText('hors P&L');

  // Fiche actif : en-tête, historique, positions (lots), calcul.
  await page.goto('#/asset/btc');
  const hero = page.locator('header.hero');
  await expect(hero).toContainText(`PRU ${pruText(btc)}`);
  await expect(hero).not.toContainText(moneyText(btc.costBasis));
  await expectMaskedNumbers(hero);
  await expectMaskedNumbers(page.locator('article.op').first());
  const tabs = page.getByRole('navigation', { name: 'Sections' });
  await tabs.getByRole('button', { name: /^Positions/ }).click();
  await expectMaskedNumbers(page.locator('article.lot').first());
  await tabs.getByRole('button', { name: 'Calcul' }).click();
  const calc = page.locator('div.calc');
  await expect(calc).toContainText(pruText(btc));
  await expect(calc).toContainText(MASK);
  await expect(calc).not.toContainText(moneyText(btc.costBasis));
  await expect(calc).not.toContainText(normalize(fmtQty(btc.qty)));

  // Saisie manuelle : quantité et montant masqués (saisir quitte la démo, c'est attendu).
  await page.goto('#/add');
  // `fill` refuse les secondes sur un datetime-local (step=1) : on passe par le DOM + event input.
  await page.locator('input[type="datetime-local"]').evaluate((el, value) => {
    const input = el as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, '2026-01-01T10:00:00');
  await page.getByLabel('Actif').fill('btc');
  await page.getByLabel('Quantité').fill('0,05');
  await page.getByLabel(/Total payé en €/).fill('1500');
  await page.getByRole('button', { name: 'Ajouter' }).click();
  const saved = page.locator('section.list p.line');
  await expect(saved).toHaveCount(1);
  await expect(saved).toContainText(`${MASK} BTC`);
  await expect(saved).toContainText(`${MASK} €`);
  await expect(saved).not.toContainText('1 500,00 €');
  await expect(saved).not.toContainText('0,05');
});
