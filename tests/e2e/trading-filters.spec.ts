/**
 * P121 (filtres + synthèse) et P122 (annoter, tags) : l'écran comparé au moteur, jamais à des
 * chiffres codés en dur (`tests/e2e/helpers/expected.ts`). Les valeurs de journal (setup, tags)
 * que ces specs vérifient sont celles QU'ELLES SAISISSENT elles-mêmes via l'interface — les
 * reprendre dans le calcul attendu n'est donc pas un chiffre en dur, juste la même saisie relue.
 */
import { expect, test, type Page } from '@playwright/test';
import type { Big } from '../../src/lib/domain/money';
import { D } from '../../src/lib/domain/money';
import {
  applyFilter,
  EMPTY_FILTER,
  summarizeFiltered,
  type FilterContext,
} from '../../src/lib/domain/trading/filter';
import type { JournalEntry, JournaledTrip } from '../../src/lib/domain/trading/journal';
import { fmtMoney, fmtPct, fmtRatio } from '../../src/lib/format/fr';
import { openDemo } from './helpers/demo';
import {
  expectedTrips,
  expectedTripsWithJournal,
  HL_EUR_USD as EUR_USD,
  normalize,
} from './helpers/expected';
import { stubNetwork } from './helpers/network';

test.beforeEach(async ({ context }) => {
  await stubNetwork(context);
});

/** Même conversion que `app.quoteToDisplay` (décision n° 156 et suivantes) : USD ÷ taux stubé. */
const toDisplay = (t: JournaledTrip, value: Big): Big | null =>
  t.trip.quote === 'EUR' ? value : value.div(D(EUR_USD));

const ctx: FilterContext = { accountLabel: (id) => id };

/** `DayWindow` de la période « Tout » : `from: null` ne filtre rien (`tripsClosedIn`). */
const ALL_WINDOW = { from: null, to: '2099-12-31' };

async function selectAllPeriod(page: Page): Promise<void> {
  await page.getByRole('radio', { name: 'Tout', exact: true }).click();
}

test('filtre par setup puis par tag : la synthèse recoupe le moteur, l’état vide nomme les filtres, « Effacer » les retire', async ({
  page,
}) => {
  const baseline = await expectedTrips();
  const target = baseline.find((t) => t.trip.status === 'closed');
  expect(target, 'la démo doit porter au moins un trade clos').toBeTruthy();
  const targetIndex = baseline.findIndex((t) => t.trip.id === target!.trip.id);

  await openDemo(page);
  await page.goto('#/trading/trades');
  await selectAllPeriod(page);

  const rows = page.getByRole('list', { name: 'Trades' }).getByRole('listitem');
  const row = rows.nth(targetIndex);
  await expect(row.getByText('à annoter')).toBeVisible();

  // Annoter en TROIS gestes : ouvrir, choisir un setup, enregistrer.
  await row.getByRole('button', { name: 'Annoter' }).click(); // 1
  const sheet = page.getByRole('dialog', { name: /Annoter/ });
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: 'Cassure' }).click(); // 2
  await sheet.getByRole('button', { name: 'Enregistrer', exact: true }).click(); // 3
  await expect(page.getByText('Journal enregistré.')).toBeVisible();
  await expect(sheet).toBeHidden();
  // La pastille « à annoter » disparaît : c'est un fait (needsAnnotation), pas une série.
  await expect(row.getByText('à annoter')).toHaveCount(0);
  await expect(row.getByText('Cassure')).toBeVisible();

  const journal: Record<string, JournalEntry> = {
    [target!.trip.id]: {
      tradeId: target!.trip.id,
      thesis: '',
      review: '',
      setup: 'Cassure',
      tags: [],
      mistakes: [],
      rating: null,
      plan: null,
    },
  };
  const withSetup = await expectedTripsWithJournal(journal);
  const expectedFilteredBySetup = applyFilter(
    withSetup,
    { ...EMPTY_FILTER, setups: ['Cassure'] },
    ctx,
  );
  expect(expectedFilteredBySetup.map((t) => t.trip.id)).toEqual([target!.trip.id]);

  // Facette Setup, rangée rapide.
  await page.getByRole('button', { name: /^Cassure \(\d+\)$/ }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(target!.trip.symbol);

  // Bandeau de synthèse = summarizeFiltered, calculé ici sur les mêmes données.
  const summary = summarizeFiltered(expectedFilteredBySetup, ALL_WINDOW, toDisplay);
  const banner = page.locator('section.summary');
  await expect(banner).toBeVisible();
  const kpi = (label: string) =>
    banner
      .locator('.stat-grid > div')
      .filter({ has: page.locator('dt', { hasText: label }) })
      .locator('dd');
  await expect(kpi('Trades clos')).toHaveText(String(summary.stats.closed));
  await expect(kpi('Résultat net')).toHaveText(
    normalize(fmtMoney(summary.stats.netTotal, 'EUR', { sign: true })),
  );
  if (summary.stats.winRate !== null) {
    await expect(kpi('Taux de réussite')).toHaveText(
      normalize(fmtPct(summary.stats.winRate, { sign: false })),
    );
  }
  await expect(kpi('Profit factor')).toHaveText(normalize(fmtRatio(summary.stats.profitFactor, 2)));
  await expect(kpi('Espérance (R)')).toHaveText(
    summary.stats.expectancyR === null
      ? '—'
      : normalize(`${fmtRatio(summary.stats.expectancyR, 2)} R`),
  );
  await expect(banner).toContainText(
    `${summary.open} ouvert${summary.open > 1 ? 's' : ''} · ${summary.needsAnnotation} à annoter`,
  );

  // Retire « Cassure », prend le tag « btc » à la place : même trade, même chemin de calcul.
  await page.getByRole('button', { name: /^Cassure \(\d+\)$/ }).click();
  await row.getByRole('button', { name: 'Annoter' }).click();
  const sheet2 = page.getByRole('dialog', { name: /Annoter/ });
  await sheet2.getByRole('combobox', { name: 'Tags' }).fill('btc');
  await sheet2.getByRole('combobox', { name: 'Tags' }).press('Enter');
  await sheet2.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(sheet2).toBeHidden();

  await page.getByRole('button', { name: /^btc \(\d+\)$/i }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(target!.trip.symbol);

  // État vide, distinct de « aucun trade » : une recherche qui ne peut rien trouver. Les filtres
  // actifs y sont nommés une seconde fois (`.active-list`) — scopé, car la rangée de puces
  // supprimables du haut d'écran, elle, reste affichée : `getByText` seul verrait les deux.
  await page.getByPlaceholder('Rechercher (symbole, compte, journal)…').fill('zzz-introuvable-zzz');
  await expect(page.getByText('Aucun trade ne correspond à ces filtres.')).toBeVisible();
  const activeList = page.locator('.active-list');
  await expect(activeList.getByText(/Recherche : «/)).toBeVisible();
  await expect(activeList.getByText(/Tag : btc/)).toBeVisible();

  // Remise à zéro : tous les trades reviennent.
  await page.getByRole('button', { name: 'Effacer les filtres' }).first().click();
  await expect(rows).toHaveCount(baseline.length);
});

test('le filtre survit à l’aller-retour vers une fiche', async ({ page }) => {
  await openDemo(page);
  await page.goto('#/trading/trades');

  const rows = page.getByRole('list', { name: 'Trades' }).getByRole('listitem');
  const totalCount = await rows.count();
  // « Ouvert » plutôt que « Long »/« Short » : la démo porte à coup sûr des trades clos ET
  // ouverts (les autres specs de cet espace en dépendent déjà), donc un sous-ensemble strict —
  // un sens donné pourrait, en théorie, être le seul représenté.
  const outcomeChip = page.getByRole('button', { name: /^Ouvert \(\d+\)$/ });
  await expect(outcomeChip).toBeVisible();
  await outcomeChip.click();
  await expect(outcomeChip).toHaveAttribute('aria-pressed', 'true');
  const filteredCount = await rows.count();
  expect(filteredCount).toBeLessThan(totalCount);
  expect(filteredCount).toBeGreaterThan(0);

  await rows.first().getByRole('link').click();
  await expect(page).toHaveURL(/#\/trading\/trade\//);
  await page.getByRole('link', { name: 'Retour' }).click();
  await expect(page).toHaveURL(/#\/trading\/trades$/);

  await expect(page.getByRole('button', { name: /^Ouvert \(\d+\)$/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(rows).toHaveCount(filteredCount);
});

test('feuille d’annotation : retour arrière la ferme sans quitter l’écran, la croix restitue le brouillon', async ({
  page,
}) => {
  await openDemo(page);
  await page.goto('#/trading/trades');
  const rows = page.getByRole('list', { name: 'Trades' }).getByRole('listitem');

  // `page.goBack()` referme la feuille (piège d'historique, P122) sans changer d'écran.
  await rows.first().getByRole('button', { name: 'Annoter' }).click();
  const sheet = page.getByRole('dialog', { name: /Annoter/ });
  await expect(sheet).toBeVisible();
  await page.goBack();
  await expect(sheet).toBeHidden();
  await expect(page).toHaveURL(/#\/trading\/trades$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Trades' })).toBeVisible();

  // Brouillon non enregistré : choisi puis fermé par la croix, il doit être restitué.
  await rows.first().getByRole('button', { name: 'Annoter' }).click();
  const sheet2 = page.getByRole('dialog', { name: /Annoter/ });
  await sheet2.getByRole('button', { name: 'Tendance' }).click();
  await expect(sheet2.getByRole('button', { name: 'Tendance' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await sheet2.getByRole('button', { name: 'Fermer' }).click();
  await expect(sheet2).toBeHidden();

  await rows.first().getByRole('button', { name: 'Annoter' }).click();
  const sheet3 = page.getByRole('dialog', { name: /Annoter/ });
  await expect(sheet3.getByText('Brouillon non enregistré, restitué.')).toBeVisible();
  await expect(sheet3.getByRole('button', { name: 'Tendance' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('les tags : « btc » suggère « BTC » sans le dupliquer, et renommer fusionne', async ({
  page,
}) => {
  await openDemo(page);
  await page.goto('#/trading/trades');
  const rows = page.getByRole('list', { name: 'Trades' }).getByRole('listitem');

  // Premier trade : tag « BTC » (majuscules) enregistré.
  await rows.nth(0).getByRole('button', { name: 'Annoter' }).click();
  const sheetA = page.getByRole('dialog', { name: /Annoter/ });
  const tagFieldA = sheetA.getByRole('combobox', { name: 'Tags' });
  await tagFieldA.fill('BTC');
  await tagFieldA.press('Enter');
  await expect(sheetA.getByRole('button', { name: 'Retirer le tag BTC' })).toBeVisible();
  await sheetA.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(sheetA).toBeHidden();

  // Deuxième trade : taper « btc » (minuscules) doit SUGGÉRER « BTC », pas créer un doublon.
  await rows.nth(1).getByRole('button', { name: 'Annoter' }).click();
  const sheetB = page.getByRole('dialog', { name: /Annoter/ });
  const tagFieldB = sheetB.getByRole('combobox', { name: 'Tags' });
  await tagFieldB.fill('btc');
  const listbox = sheetB.getByRole('listbox');
  await expect(listbox).toBeVisible();
  await expect(listbox.getByRole('option', { name: /^BTC/ })).toBeVisible();
  await listbox.getByRole('option', { name: /^BTC/ }).click();
  const removeBtc = sheetB.getByRole('button', { name: 'Retirer le tag BTC', exact: true });
  await expect(removeBtc).toBeVisible();
  // `exact: true` : `getByRole` est sinon insensible à la casse, ce qui ferait « btc » matcher
  // « BTC » et rendrait cette contre-épreuve aveugle à un vrai doublon de puce.
  await expect(removeBtc).toHaveCount(1);
  await expect(sheetB.getByRole('button', { name: 'Retirer le tag btc', exact: true })).toHaveCount(
    0,
  );
  await sheetB.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(sheetB).toBeHidden();

  // Un troisième trade porte un tag distinct, à fusionner avec « BTC » depuis la gestion des tags.
  await rows.nth(2).getByRole('button', { name: 'Annoter' }).click();
  const sheetC = page.getByRole('dialog', { name: /Annoter/ });
  const tagFieldC = sheetC.getByRole('combobox', { name: 'Tags' });
  await tagFieldC.fill('bitcoin');
  await tagFieldC.press('Enter');
  await sheetC.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(sheetC).toBeHidden();

  await page.getByRole('button', { name: /^Filtres/ }).click();
  const filtersSheet = page.getByRole('dialog', { name: 'Filtres' });
  await expect(filtersSheet).toBeVisible();
  await filtersSheet.getByRole('button', { name: 'Gérer les tags' }).click();
  const manageSheet = page.getByRole('dialog', { name: 'Gérer les tags' });
  await expect(manageSheet).toBeVisible();
  const btcRow = manageSheet.locator('li').filter({ hasText: 'BTC' });
  await expect(btcRow).toContainText('2 trades');

  const bitcoinRow = manageSheet.locator('li').filter({ hasText: 'bitcoin' });
  await bitcoinRow.getByRole('button', { name: 'Renommer' }).click();
  await bitcoinRow.getByRole('textbox').fill('BTC');
  await bitcoinRow.getByRole('button', { name: 'Enregistrer' }).click();

  // Fusionné : « bitcoin » a disparu, « BTC » porte maintenant les trois trades.
  await expect(bitcoinRow).toHaveCount(0);
  await expect(btcRow).toContainText('3 trades');
});
