/**
 * Alertes de prix relatives au PRU (P29, décision n° 36) : seuil affiché = seuil du moteur,
 * déclenchement au franchissement (ici provoqué par un prix manuel, chemin utilisateur réel),
 * centre d'alertes, et simulateur de rachat dont le nouveau PRU est recalculé par le moteur —
 * jamais de chiffre en dur. Les feuilles fermées restent dans le DOM : tout sélecteur de
 * formulaire est ancré sur `dialog[open]`.
 */
import { expect, test } from '@playwright/test';
import { alertThresholdEur, type AlertRule } from '../../src/lib/domain/alerts';
import { COINHOUSE_FEES } from '../../src/lib/domain/fees';
import { D, toDecimalString } from '../../src/lib/domain/money';
import { simulateBuy } from '../../src/lib/domain/simulate';
import { fmtPrice } from '../../src/lib/format/fr';
import { openDemo } from './helpers/demo';
import { fixtureReport, normalize, position } from './helpers/expected';
import { STUB_PRICES_EUR, stubNetwork } from './helpers/network';

test.beforeEach(async ({ context }) => {
  await stubNetwork(context);
});

/** Règle « sous le PRU de 10 % » telle que l'écran la construit (pour recalculer le seuil). */
function belowRule(asset: string): AlertRule {
  return {
    id: 'e2e',
    asset,
    direction: 'below',
    threshold: { kind: 'pru-pct', percent: '10' },
    repeat: 'recurring',
    enabled: true,
    note: '',
    createdAt: '',
  };
}

test('création : l’aperçu et la liste affichent le seuil calculé par le moteur', async ({
  page,
}) => {
  const { report } = fixtureReport();
  const btc = position(report, 'btc');
  const threshold = alertThresholdEur(belowRule('btc'), {
    pruEur: toDecimalString(btc.pru!),
    qty: toDecimalString(btc.qty),
  });
  const thresholdText = normalize(fmtPrice(threshold));

  await openDemo(page);
  await page.goto('#/invest/alerts');
  await page.getByRole('button', { name: 'Créer une alerte' }).click();
  const sheet = page.locator('dialog[open]');
  await sheet.getByLabel('Actif').selectOption('btc');
  await sheet.getByRole('radio', { name: 'Repli sous le PRU' }).check();
  await sheet.getByLabel('Écart sous le PRU (%)').fill('10');

  await expect(sheet.locator('.preview')).toContainText(`Seuil actuel : ${thresholdText}`);
  // Dans la fixture, BTC est déjà sous PRU − 10 % (prix stub 60 000 €) : l'aperçu doit le dire,
  // et la règle doit naître sans déclenchement, en attente d'un re-franchissement.
  await expect(sheet.getByText(/Condition déjà remplie/)).toBeVisible();

  await sheet.getByRole('button', { name: 'Créer l’alerte' }).click();
  await expect(page.getByText(/^Alerte créée/)).toBeVisible();
  const rule = page.locator('li.rule').filter({ hasText: 'BTC' });
  await expect(rule.getByText('Sous le PRU de 10 %')).toBeVisible();
  await expect(rule).toContainText(`Seuil : ${thresholdText}`);
  await expect(rule.getByText('s’armera au re-franchissement')).toBeVisible();
});

test('franchissement par prix manuel : notification in-app, centre d’alertes, simulation du rachat', async ({
  page,
}) => {
  const { report } = fixtureReport();
  const btc = position(report, 'btc');
  const spot = STUB_PRICES_EUR['bitcoin']!;
  const thresholdEur = String(Math.round(spot * 0.9)); // 54 000 € : sous le prix stub → armée.
  const manualPrice = String(Math.round(spot * 0.85)); // 51 000 € : franchit le seuil.

  await openDemo(page);
  await page.goto('#/invest/alerts');
  await page.getByRole('button', { name: 'Créer une alerte' }).click();
  const sheet = page.locator('dialog[open]');
  await sheet.getByLabel('Actif').selectOption('btc');
  await sheet.getByRole('radio', { name: 'Prix exact' }).check();
  await sheet.getByLabel('Prix en euros').fill(thresholdEur);
  await sheet.getByLabel('Se déclenche quand le prix').selectOption('below');
  await sheet.getByRole('button', { name: 'Créer l’alerte' }).click();
  await expect(page.locator('li.rule').getByText('armée', { exact: true })).toBeVisible();

  // Chemin utilisateur réel : un prix manuel sur la fiche BTC fait franchir le seuil.
  await page.goto('#/invest/asset/btc');
  await page.getByRole('button', { name: 'saisir un prix' }).click();
  await page.locator('dialog[open]').getByLabel('Prix en euros').fill(manualPrice);
  await page.locator('dialog[open]').getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByText(/^Alerte BTC :/)).toBeVisible();

  // Vue d'ensemble : le déclenchement non lu est annoncé.
  await page.goto('#/');
  await expect(page.getByRole('heading', { name: 'Alertes de prix' })).toBeVisible();
  await page.getByRole('link', { name: 'Ouvrir le centre d’alertes' }).click();

  // Centre d'alertes : événement listé avec le prix de déclenchement, règle « déclenchée ».
  const fired = page.locator('section.fired');
  await expect(fired.getByText(normalize(fmtPrice(manualPrice))).first()).toBeVisible();
  await expect(page.locator('li.rule').getByText(/déclenchée/)).toBeVisible();

  // Simulation du rachat au prix d'alerte : nouveau PRU = moteur (frais Coinhouse par défaut).
  await fired.getByRole('button', { name: 'Simuler un rachat à ce prix' }).click();
  const spend = '1000';
  await page
    .locator('dialog[open]')
    .getByLabel('Montant à investir (euros, tout compris)')
    .fill(spend);
  const expected = simulateBuy(
    { qty: btc.qty, costBasis: btc.costBasis },
    D(spend),
    D(manualPrice),
    COINHOUSE_FEES['buy-sepa'],
  );
  const result = page.locator('dialog[open] .result');
  await expect(result.getByText(normalize(fmtPrice(expected!.pruAfter)))).toBeVisible();

  // Marqué lu à la visite : la carte disparaît de la Vue d'ensemble.
  await page.keyboard.press('Escape');
  await page.goto('#/');
  await expect(page.getByRole('heading', { name: 'Alertes de prix' })).toHaveCount(0);
});

test('sans données : la page explique et renvoie vers l’import', async ({ page }) => {
  await page.goto('#/invest/alerts');
  await expect(
    page.getByRole('heading', { name: 'Alertes de prix relatives au PRU' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Importer un export' })).toBeVisible();
});
