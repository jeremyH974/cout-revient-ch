import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import {
  computeTradingAccount,
  type TradingAccountReport,
} from '../../src/lib/domain/trading/compute';
import { curveWindow } from '../../src/lib/domain/trading/curve';
import { fmtMoney, roundsToZero } from '../../src/lib/format/fr';
import type { HlPortfolio } from '../../src/lib/import/hyperliquid/api-types';
import { fixtureClient, type HlFixture } from '../../src/lib/import/hyperliquid/fixture-client';
import { normalizeHlAccount } from '../../src/lib/import/hyperliquid/normalize';
import { syncAccount } from '../../src/lib/import/hyperliquid/sync';
import { openDemo } from './helpers/demo';
import { normalize } from './helpers/expected';
import { stubNetwork } from './helpers/network';

/** Taux EUR→USD du stub réseau (network.ts) : les montants USDC de l'écran sont divisés par lui. */
const EUR_USD = '1.1';

test.beforeEach(async ({ context }) => {
  await stubNetwork(context);
});

/** Rapport attendu, calculé par le moteur lui-même depuis la fixture (jamais de chiffres en dur). */
async function expectedReport(): Promise<{
  fixture: HlFixture;
  report: TradingAccountReport;
  portfolio: HlPortfolio;
}> {
  const fixture = JSON.parse(
    readFileSync('tests/fixtures/hyperliquid/demo.json', 'utf8'),
  ) as HlFixture;
  const sync = await syncAccount(fixtureClient(fixture), null, fixture.address, {
    now: () => 1_755_900_000_000,
  });
  expect(sync.error).toBeNull();
  const normalized = normalizeHlAccount(sync.data, {
    accountId: `hl:${fixture.address}`,
    spotPairs: sync.spotPairs,
    spotAsInvestment: false,
    eurUsdRate: () => EUR_USD,
  });
  return {
    fixture,
    report: computeTradingAccount(normalized.trading),
    portfolio: sync.data.portfolio ?? {},
  };
}

/** « 1 234,56 € » → 1234.56, en tolérant les espaces insécables et le signe moins typographique. */
const toNumber = (raw: string): number =>
  Number(
    raw
      .replace(/[\u202f\u00a0\s]/g, '')
      .replace('−', '-')
      .replace(',', '.')
      .replace(/[€$]/g, ''),
  );

async function expectDashboard(page: Page, report: TradingAccountReport): Promise<void> {
  await expect(page.getByRole('heading', { level: 1, name: 'Trading' })).toBeVisible();
  /*
   * Valeur du compte = équité perps + avoirs spot (décision n° 100). Les jetons spot sont cotés
   * par l'application, jamais par le moteur : on ne peut donc pas l'attendre depuis un
   * `computeTradingAccount` sans prix. On vérifie l'ADDITION telle qu'elle s'affiche — l'équité
   * perps venant du moteur, chaque avoir spot venant de l'écran. Un périmètre qui se remettrait à
   * ignorer le spot casserait cette égalité immédiatement.
   */
  const perps = Number(report.snapshot?.accountValue ?? '0') / Number(EUR_USD);
  const avoirs = await page
    .getByRole('list', { name: 'Avoirs spot' })
    .locator('.side')
    .allInnerTexts();
  // Un avoir sans cotation s'affiche « — » : le moteur l'écarte aussi (`spotUnpriced`), et les
  // deux côtés de l'égalité restent alignés.
  const attendu =
    perps +
    avoirs
      .filter((t) => /\d/.test(t))
      .map(toNumber)
      .reduce((a, b) => a + b, 0);
  const affiche = toNumber(await page.locator('section.summary .trio .big').nth(1).innerText());
  expect(Math.abs(affiche - attendu)).toBeLessThanOrEqual(0.02);
  // Positions ouvertes de l'instantané, avec leur latent.
  const positions = page.getByRole('list', { name: 'Positions ouvertes' });
  for (const p of report.snapshot?.positions ?? []) {
    await expect(positions).toContainText(p.symbol);
  }
  // Avoirs spot présents.
  for (const h of report.snapshot?.spot ?? []) {
    await expect(page.getByRole('list', { name: 'Avoirs spot' })).toContainText(
      h.asset.toUpperCase(),
    );
  }
  // Réconciliation : soit elle se ferme, soit elle nomme la plus-value spot qu'elle ne calcule pas.
  await expect(
    page.getByText(
      /valeur du compte = apports \+ réalisé − frais \+ funding \+ latent|contient la plus-value réalisée/,
    ),
  ).toBeVisible();
  // La courbe d'évolution (portfolio) est rendue : un SVG avec la légende Équité.
  await expect(page.locator('.evolution svg').first()).toBeVisible();
}

test('démo : le tableau de bord Trading recoupe le moteur (équité, positions, réconciliation)', async ({
  page,
}) => {
  const { report, portfolio } = await expectedReport();
  await openDemo(page);
  await page.goto('#/trading');
  await expectDashboard(page, report);

  // Gain ou perte de la fenêtre de la courbe (décision n° 162), recoupé avec la série de la
  // plateforme : 30 jours par défaut, puis tout l'historique.
  const evolution = page.locator('section.evolution');
  const eur = (value: import('big.js').Big) => normalize(fmtMoney(value.div(EUR_USD), 'EUR'));
  for (const [id, label, words] of [
    ['month', '1M', 'Sur 30 jours'],
    ['allTime', 'Tout', "Depuis l'ouverture du compte"],
  ] as const) {
    await evolution
      .getByRole('group', { name: 'Période de la courbe' })
      .getByRole('button', { name: label, exact: true })
      .click();
    const series = portfolio[id]!;
    const result = curveWindow(series.accountValueHistory, series.pnlHistory)!;
    const pnl = result.pnl.div(EUR_USD);
    await expect(evolution.locator('.period-result')).toHaveText(
      roundsToZero(pnl)
        ? `${words} : résultat nul`
        : `${words} : ${pnl.lt('0') ? 'perte de' : 'gain de'} ${normalize(fmtMoney(pnl, 'EUR', { sign: true }))}`,
    );
    await expect(evolution.locator('.period-detail')).toContainText(
      `Équité de ${eur(result.startValue)} à ${eur(result.endValue)}`,
    );
    // Les mouvements de la fenêtre sont nommés à part : la démo dépose à mi-parcours sur 30 jours.
    await expect(evolution.locator('.period-detail')).toContainText(
      roundsToZero(result.flows.div(EUR_USD))
        ? 'sans dépôt ni retrait'
        : `dont ${normalize(fmtMoney(result.flows.div(EUR_USD), 'EUR', { sign: true }))} de dépôts, retraits et transferts`,
    );
  }
  // Onglet Fills : les exécutions vivent là, 50 par 50.
  await page.getByLabel('Espace Trading').getByRole('link', { name: 'Fills' }).click();
  await expect(page).toHaveURL(/#\/trading\/fills$/);
  const fillCount = report.executions.length;
  await expect(page.getByText(`${fillCount} fills (spot et perps)`)).toBeVisible();
  const rows = page.getByRole('list', { name: 'Fills' }).getByRole('listitem');
  expect(await rows.count()).toBe(Math.min(50, fillCount));
  await page.goto('#/trading');
  // Le P&L net « Tout » = réalisé − frais perps + funding du moteur (carte Résultat).
  // Le sélecteur du bloc « Résultat » est désormais le composant partagé (décision n° 156) : un
  // `radiogroup` de `radio`, et non plus un `group` de `button`. Le sélecteur de la courbe, lui,
  // garde ses fenêtres de plateforme sous le libellé « Période de la courbe ».
  await page
    .getByRole('radiogroup', { name: 'Période', exact: true })
    .getByRole('radio', { name: 'Tout' })
    .click();
  const net = report.totals.realized.minus(report.totals.perpFees).plus(report.totals.funding);
  await expect(page.locator('.stat-grid .main dd')).toHaveText(
    normalize(fmtMoney(net.div(EUR_USD), 'EUR', { sign: true })),
  );
});

test('ajouter une adresse : synchronisation réelle (stub), persistance après rechargement', async ({
  page,
}) => {
  const { fixture, report } = await expectedReport();
  await page.goto('#/accounts');
  await page.getByLabel('Adresse publique').fill(fixture.address);
  await page.getByLabel('Nom (facultatif)').fill('Mon compte HL');
  await page.getByRole('button', { name: 'Ajouter et synchroniser' }).click();
  await expect(page).toHaveURL(/#\/trading$/);
  await expectDashboard(page, report);
  // Persistance (IndexedDB + miroir) : la valeur du compte revient sans nouvelle synchronisation.
  await page.reload();
  await expectDashboard(page, report);
  await expect(page.getByText(/Synchronisé :/)).toBeVisible();
});

test('quitter la démo retire le compte Hyperliquid fictif', async ({ page }) => {
  await openDemo(page);
  await page.goto('#/trading');
  await expect(page.getByRole('heading', { level: 1, name: 'Trading' })).toBeVisible();
  await page.getByRole('button', { name: 'Quitter la démo' }).click();
  await expect(page).toHaveURL(/#\/welcome$/);
  await page.goto('#/trading');
  await expect(page.getByRole('heading', { name: 'Vos trades, bientôt ici' })).toBeVisible();
});

/**
 * Statistiques (décision n° 95) : le sélecteur de période gouverne tout l'écran SAUF le calendrier,
 * qui garde sa navigation et ses trois mailles. Le test ne fixe aucune date — la fixture de démo
 * vieillit — mais l'emboîtement des fenêtres, lui, ne peut pas mentir : une semaine ⊆ un mois ⊆
 * trois mois ⊆ tout. Un filtre qui ne filtrerait rien (ou qui écraserait l'écran) le romprait.
 */
test('démo : la période restreint les statistiques, le calendrier garde sa maille', async ({
  page,
}) => {
  await openDemo(page);
  await page.goto('#/trading/stats');
  const periods = page.getByRole('radiogroup', { name: 'Période' });
  const grains = page.getByRole('radiogroup', { name: 'Maille du calendrier' });
  await expect(periods).toBeVisible();

  /** Trades clos annoncés par le titre ; 0 quand la carte cède la place au message de période vide. */
  const closedOn = async (label: string): Promise<number> => {
    await periods.getByRole('radio', { name: label, exact: true }).click();
    // Le calendrier est là quelle que soit la fenêtre : il ne suit pas le filtre.
    await expect(grains).toBeVisible();
    await expect(page.getByText(/Le calendrier ne suit pas le filtre de période/)).toHaveCount(
      label === 'Tout' ? 0 : 1,
    );
    const heading = page.getByRole('heading', { level: 2, name: /Vue d'ensemble/ });
    if ((await heading.count()) === 0) {
      await expect(page.getByText(/^Aucun trade clos sur /)).toBeVisible();
      return 0;
    }
    const text = await heading.innerText();
    // Le titre dit sur quoi il porte : la période, sauf « Tout » qui est le défaut.
    expect(text).toMatch(label === 'Tout' ? /\d+ trades? clos\)/ : /\d+ trades? clos sur /);
    return Number(/\((\d+) trade/.exec(text)![1]);
  };

  const week = await closedOn('1S');
  const month = await closedOn('1M');
  const quarter = await closedOn('3M');
  const all = await closedOn('Tout');
  expect(week).toBeLessThanOrEqual(month);
  expect(month).toBeLessThanOrEqual(quarter);
  expect(quarter).toBeLessThanOrEqual(all);
  expect(all).toBeGreaterThan(0);
  // Et le filtre mord vraiment : la fixture couvre une vingtaine de jours, donc au moins un trade
  // tombe hors de la dernière semaine. Un filtre inerte rendrait ces deux nombres égaux.
  expect(week).toBeLessThan(all);

  // Maille semaine (décision n° 165) : les semaines ISO de l'année — 53 en 2026 —, et le clic liste
  // les trades de la semaine plutôt que de descendre dans un mois qui ne la contiendrait pas entière.
  await grains.getByRole('radio', { name: 'Semaine', exact: true }).click();
  const weekList = page.getByRole('list', { name: /^Semaines de \d{4}$/ });
  await expect(weekList.getByRole('listitem')).toHaveCount(53);
  const firstWeek = weekList.getByRole('button').first();
  await expect(firstWeek).toHaveAccessibleName(/^Semaine \d+, du .+ — voir les trades$/);
  await firstWeek.click();
  await expect(firstWeek).toHaveAttribute('aria-pressed', 'true');
  const weekTrades = page.getByRole('heading', {
    level: 3,
    name: /^Réalisé en semaine \d+, du .+, par trade$/,
  });
  await expect(weekTrades).toBeVisible();
  await expect(page.locator('.day-list').getByRole('link').first()).toBeVisible();
  // Un second clic referme la liste ; changer de maille aussi.
  await firstWeek.click();
  await expect(weekTrades).toHaveCount(0);

  // Maille année : une case par année, et le clic redescend sur les mois de l'année choisie.
  await grains.getByRole('radio', { name: 'Année', exact: true }).click();
  const yearList = page.getByRole('list', { name: 'Années' });
  await expect(yearList).toBeVisible();
  await yearList.getByRole('button').first().click();
  await expect(page.getByRole('list', { name: /^Mois de \d{4}$/ })).toBeVisible();
  // Puis d'un cran encore : le mois choisi ouvre sa grille de jours.
  await page
    .getByRole('list', { name: /^Mois de \d{4}$/ })
    .getByRole('button')
    .first()
    .click();
  await expect(page.getByRole('region', { name: /tableau défilant/ }).first()).toBeVisible();
  await expect(grains.getByRole('radio', { name: 'Jour', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
});
