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
import { EUR_USD_RATE, STUB_PRICES_EUR, stubNetwork } from './helpers/network';

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

test('affichage en dollars : alerte ancrée en $, aperçu bi-devise, simulateur converti au taux BCE', async ({
  page,
}) => {
  const { report } = fixtureReport();
  const btc = position(report, 'btc');
  const rate = EUR_USD_RATE; // 1,1 sur toute la plage (stub Frankfurter)

  await openDemo(page);
  await page.goto('#/settings');
  // Rôle explicite : l'app-bar porte aussi un BOUTON « Devise d'affichage » (bascule rapide).
  await page.getByRole('combobox', { name: /Devise d'affichage/ }).selectOption('USD');
  // Les taux BCE stub sont chargés par ce geste : attendre qu'un montant s'affiche en dollars.
  await page.goto('#/');
  await expect(page.locator('main')).toContainText('$');

  // Alerte « Prix exact » saisie en dollars : ANCRÉE en dollars, évaluée en euros via le taux.
  await page.goto('#/invest/alerts');
  await page.getByRole('button', { name: 'Créer une alerte' }).click();
  const sheet = page.locator('dialog[open]');
  await sheet.getByLabel('Actif').selectOption('btc');
  await sheet.getByRole('radio', { name: 'Prix exact' }).check();
  const priceUsd = '59400'; // ÷ 1,1 = 54 000 € : sous le prix stub (60 000 €) → l'alerte naît armée.
  await sheet.getByLabel(/Prix en dollars/).fill(priceUsd);
  await sheet.getByLabel('Se déclenche quand le prix').selectOption('below');

  const thresholdEur = alertThresholdEur(
    { ...belowRule('btc'), threshold: { kind: 'price-usd', priceUsd } },
    null,
    rate,
  )!;
  const usdText = normalize(fmtPrice(thresholdEur.times(rate), 'USD'));
  const eurText = normalize(fmtPrice(thresholdEur));
  await expect(sheet.locator('.preview')).toContainText(`Seuil actuel : ${usdText}`);
  await expect(sheet.locator('.preview')).toContainText(`(${eurText})`);

  await sheet.getByRole('button', { name: 'Créer l’alerte' }).click();
  await expect(page.getByText(/^Alerte créée/)).toBeVisible();
  const rule = page.locator('li.rule').filter({ hasText: 'BTC' });
  await expect(rule).toContainText(`Prix ≤ ${usdText}`); // libellé ancré en dollars
  await expect(rule).toContainText(`Seuil : ${usdText}`);
  await expect(rule.getByText('armée', { exact: true })).toBeVisible();

  // Simulateur : saisie en dollars convertie pour le moteur (euros), résultats réaffichés en $.
  await page.goto('#/invest/asset/btc');
  await page.getByRole('button', { name: 'Simuler' }).click();
  const sim = page.locator('dialog[open]');
  await expect(sim.getByText(/taux BCE du jour/)).toBeVisible();
  await sim.getByLabel('Montant à investir (dollars, tout compris)').fill('1100'); // ÷ 1,1 = 1 000 €
  await sim.getByLabel('Prix d’exécution (dollars)').fill('56100'); // ÷ 1,1 = 51 000 €
  const expected = simulateBuy(
    { qty: btc.qty, costBasis: btc.costBasis },
    D('1000'),
    D('51000'),
    COINHOUSE_FEES['buy-sepa'],
  )!;
  const pruAfterUsd = normalize(
    fmtPrice(D(toDecimalString(expected.pruAfter!)).times(rate), 'USD'),
  );
  await expect(sim.locator('.result').getByText(pruAfterUsd)).toBeVisible();
});

test('veille + notifications : l’instantané du service worker reflète les seuils du moteur', async ({
  context,
  page,
}) => {
  await context.grantPermissions(['notifications']);
  const spot = STUB_PRICES_EUR['bitcoin']!;
  const thresholdEur = String(Math.round(spot * 0.9)); // 54 000 € : sous le prix stub → armée.

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

  await page.getByRole('checkbox', { name: 'Veille automatique des prix (app ouverte)' }).check();
  await page.getByRole('button', { name: 'Activer les notifications système' }).click();
  await expect(page.getByText('Notifications système :')).toBeVisible();

  // L'instantané écrit pour le service worker doit porter EXACTEMENT le seuil du moteur.
  const readSnapshot = (): Promise<unknown> =>
    page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const open = indexedDB.open('crch-state', 1);
          open.onsuccess = () => {
            const db = open.result;
            const tx = db.transaction('meta', 'readonly');
            const request = tx.objectStore('meta').get('alerts.watch-snapshot');
            request.onsuccess = () => resolve(request.result ?? null);
            tx.onerror = () => reject(tx.error);
          };
          open.onerror = () => reject(open.error);
        }),
    );
  interface SwRule {
    asset: string;
    coingeckoId: string;
    direction: string;
    thresholdEur: string;
    armed: boolean;
  }
  await expect
    .poll(async () => {
      const snapshot = (await readSnapshot()) as { rules?: SwRule[] } | null;
      return snapshot?.rules?.length ?? 0;
    })
    .toBeGreaterThan(0);
  const snapshot = (await readSnapshot()) as { v: number; minGapMs: number; rules: SwRule[] };
  expect(snapshot.v).toBe(1);
  const swRule = snapshot.rules.find((r) => r.asset === 'btc')!;
  expect(swRule.coingeckoId).toBe('bitcoin');
  expect(swRule.direction).toBe('below');
  expect(swRule.armed).toBe(true);
  expect(D(swRule.thresholdEur).eq(D(thresholdEur))).toBe(true);
});

test('sans données : la page explique et renvoie vers l’import', async ({ page }) => {
  await page.goto('#/invest/alerts');
  await expect(
    page.getByRole('heading', { name: 'Alertes de prix relatives au PRU' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Importer un export' })).toBeVisible();
});

/**
 * P92 : le taux fiscal affiché porte sa source (décision n° 80).
 *
 * L'estimation fiscale du simulateur exige l'historique de prix — d'où le passage par le Rapport,
 * qui le charge. Sans réseau stubé, ce parcours n'est pas déterministe : c'est précisément pourquoi
 * il vit ici plutôt que dans une vérification à la main.
 */
test('le simulateur de vente cite le texte de loi derrière le taux', async ({ page }) => {
  await openDemo(page);

  // Le Rapport déclenche le chargement de l'historique quotidien, dont dépend l'estimation.
  await page.goto('#/invest/report');
  await expect(page.getByText('Fiscalité française (estimation)')).toBeVisible({ timeout: 30_000 });
  // La même citation doit d'abord apparaître dans le rapport : c'est le document transmis.
  await expect(page.getByText(/LOI n° 2025-1403 du 30\/12\/2025/)).toBeVisible();

  await page.goto('#/invest/asset/btc');
  await page.getByRole('button', { name: 'Simuler' }).click();
  const sim = page.locator('dialog[open]');
  await sim.getByRole('button', { name: 'Vendre', exact: true }).click();
  await sim.getByLabel(/Quantité à vendre/).fill('0.05');
  // L'estimation fiscale ne concerne que les sorties vers l'euro : un échange crypto-crypto
  // bénéficie du sursis (art. 150 VH bis) et n'affiche donc rien.
  await sim.getByRole('combobox').last().selectOption('sell-eur');

  const estimation = sim.locator('details', { hasText: 'Estimation fiscale française' });
  await estimation.getByText('Estimation fiscale française (avant de vendre)').click();
  await expect(estimation.getByText(/Taux fixé par/)).toBeVisible();
  await expect(estimation.getByRole('link', { name: /LOI n° 2025-1403/ })).toHaveAttribute(
    'href',
    /legifrance\.gouv\.fr/,
  );
});
