/**
 * Cohérence transversale des chiffres AFFICHÉS : les écrans se recoupent entre eux, à l'arrondi
 * près (chaque valeur est arrondie au centime : une somme de k valeurs peut dévier de 0,005 × k).
 * Synthèse ↔ lignes ↔ positions clôturées ↔ fiche actif ↔ onglet Calcul ↔ rapport ↔ export CSV
 * ↔ graphique. Les tests `demo`/`asset` comparent déjà l'écran au moteur ; ici on vérifie que
 * l'outil ne se contredit jamais d'une page à l'autre.
 */
import { existsSync, readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { computePortfolio } from '../../src/lib/domain/engine/aggregate';
import { buildInsights } from '../../src/lib/domain/insights';
import { D } from '../../src/lib/domain/money';
import { analyzeSubscription } from '../../src/lib/domain/subscription';
import { DEFAULT_ENGINE_SETTINGS } from '../../src/lib/domain/types';
import { balanceRecords } from '../../src/lib/import/coinhouse/balances';
import { normalizeCoinhouseRows } from '../../src/lib/import/coinhouse/normalize';
import { importCoinhouseCsv } from '../../src/lib/import/coinhouse/index';
import { fmtMoney } from '../../src/lib/format/fr';
import { renderInsights } from '../../src/lib/format/insights';
import { openDemo, waitForPrices } from './helpers/demo';
import { FIXTURE, normalize } from './helpers/expected';
import { stubNetwork } from './helpers/network';

/**
 * Par défaut : la démo. Localement, `COHERENCE_CSV=<export.csv>` rejoue les mêmes contrôles sur un
 * export réel (jamais en CI, jamais commis) ; aucun montant n'est écrit dans les messages d'erreur.
 */
const REAL_CSV = process.env['COHERENCE_CSV'];

async function openDataset(page: Page): Promise<void> {
  if (!REAL_CSV) return openDemo(page);
  if (!existsSync(REAL_CSV)) throw new Error('COHERENCE_CSV introuvable');
  await page.goto('#/import');
  await page.setInputFiles('input[type="file"]', REAL_CSV);
  await expect(page.getByRole('heading', { name: 'Import réussi' })).toBeVisible();
  await page.getByRole('link', { name: 'Voir mon portefeuille' }).click();
  await expect(page.getByRole('list', { name: 'Positions' })).toBeVisible();
  await waitForPrices(page);
}

test.beforeEach(async ({ context }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'cohérence : Chromium desktop seulement');
  await stubNetwork(context);
});

/** « −1 151,98 € », « +2,8 % », « 12 345,6 » → nombre ; les quantités abrégées (« 12,6 M ») → null. */
function toNumber(raw: string): number {
  const cleaned = raw
    .replace(/[\u202f\u00a0\s]/g, '')
    .replace('−', '-')
    .replace(',', '.')
    .replace(/[€$%+]/g, '');
  const millions = /M$/.test(cleaned);
  const n = Number(millions ? cleaned.slice(0, -1) : cleaned);
  if (!Number.isFinite(n)) throw new Error(`nombre illisible : « ${raw} »`);
  return millions ? n * 1_000_000 : n;
}
const abbreviated = (raw: string): boolean => /\dM$/.test(raw.replace(/\s/g, ''));
/** Espaces fines et insécables d'Intl → espaces simples. */
const plain = (raw: string): string => raw.replace(/\s+/g, ' ').trim();
const sum = (values: number[]): number => values.reduce((a, b) => a + b, 0);
/**
 * Tolérance d'arrondi : 0,005 par valeur affichée au centime ; 0,5 dès que les montants « compacts »
 * (≥ 100 000, arrondis à l'euro dans la synthèse, les lignes et la fiche actif) entrent en jeu.
 */
let unit = 0.005;
const tol = (count: number): number => 0.01 + unit * count;

async function nums(scope: Locator): Promise<number[]> {
  const texts = await scope.locator('.num').allInnerTexts();
  return texts.map(toNumber);
}

interface Row {
  asset: string;
  qty: number | null;
  pru: number;
  price: number | null;
  value: number;
  latent: number;
  latentPct: number;
  realized: number;
  total: number;
}

async function readRows(list: Locator): Promise<Row[]> {
  const rows: Row[] = [];
  const items = list.getByRole('listitem');
  for (let i = 0; i < (await items.count()); i++) {
    const li = items.nth(i);
    const qtyText = await li.locator('.cell.qty .num').innerText();
    const pruText = (await li.locator('.cell.qty .small').innerText()).replace(/^PRU\s*/, '');
    // Le libellé « Prix » (lecteurs d'écran) précède la valeur ; la source et l'âge du prix
    // (« CoinGecko · il y a 2 min ») suivent sur une seconde ligne.
    const priceText = (await li.locator('.cell.price').innerText())
      .replace(/^Prix\s*/, '')
      .split('\n')[0]!
      .trim();
    const [latent, latentPct] = await nums(li.locator('.cell.latent'));
    rows.push({
      asset: await li.locator('.cell.id strong').innerText(),
      qty: abbreviated(qtyText) ? null : toNumber(qtyText),
      pru: toNumber(pruText),
      price: priceText === '—' ? null : toNumber(priceText),
      value: (await nums(li.locator('.cell.value')))[0]!,
      latent: latent!,
      latentPct: latentPct!,
      realized: (await nums(li.locator('.cell.realized')))[0]!,
      total: (await nums(li.locator('.cell.total')))[0]!,
    });
  }
  return rows;
}

interface Summary {
  invested: number;
  value: number;
  total: number;
  roiPct: number;
  roiBase: number;
  realized: number;
  latent: number;
  netCash: number;
  fees: number;
}

async function readSummary(page: Page): Promise<Summary> {
  const summary = page.locator('section.summary');
  const [invested, value, total] = (await summary.locator('.big').allInnerTexts()).map(toNumber);
  const roiNote = await summary.locator('.note', { hasText: 'ROI' }).innerText();
  const roi = /ROI\s+(\S+ %)\s+sur\s+(.+?) engagés/.exec(roiNote.replace(/\s+/g, ' '));
  if (!roi) throw new Error(`note ROI illisible : « ${roiNote} »`);
  unit = Math.max(Math.abs(invested!), Math.abs(value!), Math.abs(total!)) >= 100_000 ? 0.5 : 0.005;
  const lines = summary.locator('.lines p');
  const [realized, latent] = await nums(lines.nth(0));
  const [netCash, fees] = await nums(lines.nth(1));
  return {
    invested: invested!,
    value: value!,
    total: total!,
    roiPct: toNumber(roi[1]!),
    roiBase: toNumber(roi[2]!),
    realized: realized!,
    latent: latent!,
    netCash: netCash!,
    fees: fees!,
  };
}

test('synthèse, lignes et positions clôturées se recoupent', async ({ page }) => {
  await openDataset(page);
  const s = await readSummary(page);
  const open = await readRows(page.getByRole('list', { name: 'Positions' }));
  const stable = await readRows(page.getByRole('list', { name: 'Stablecoins' }));
  const held = [...open, ...stable];
  expect(held.length).toBeGreaterThan(5);

  // Chaque ligne est cohérente avec elle-même.
  for (const r of held) {
    expect(Math.abs(r.total - (r.latent + r.realized)), `${r.asset} total`).toBeLessThanOrEqual(
      tol(2),
    );
    const invested = r.value - r.latent;
    // Le % est calculé sur des valeurs exactes ; ici sur des valeurs arrondies : quand l'investi est
    // petit devant la valeur, l'arrondi pèse d'autant plus (conditionnement), d'où une marge relative.
    const expectedPct = (100 * r.latent) / invested;
    const pctTolerance =
      0.1 + ((100 * 2 * unit) / Math.abs(invested)) * (1 + Math.abs(expectedPct) / 100);
    expect(Math.abs(r.latentPct - expectedPct), `${r.asset} latent %`).toBeLessThanOrEqual(
      pctTolerance,
    );
    if (r.qty !== null && r.price !== null) {
      expect(Math.abs(r.value - r.qty * r.price) / r.value, `${r.asset} valeur`).toBeLessThan(
        0.001,
      );
      expect(Math.abs(invested - r.qty * r.pru) / invested, `${r.asset} investi`).toBeLessThan(
        0.001,
      );
    }
  }

  // Positions clôturées : en-tête = somme des lignes ; résidus éventuels.
  const closed = page.locator('details.list');
  const closedHeader = (await nums(closed.locator('summary')))[0]!;
  // Les lignes d'un <details> replié ne sont pas rendues : on le déplie avant de lire.
  await closed.locator('summary').click();
  const residualMatch = /dont résidus\s+(\S+ €)/.exec(
    (await closed.locator('summary').innerText()).replace(/\s+/g, ' '),
  );
  const residualLatent = residualMatch ? toNumber(residualMatch[1]!) : 0;
  const closedLines = closed.locator('a.line');
  const closedTotals: number[] = [];
  for (let i = 0; i < (await closedLines.count()); i++) {
    const values = await nums(closedLines.nth(i));
    closedTotals.push(values[values.length - 1]!);
  }
  expect(closedTotals.length).toBeGreaterThan(3);
  expect(Math.abs(closedHeader - sum(closedTotals))).toBeLessThanOrEqual(tol(closedTotals.length));

  // Synthèse = sommes des sections.
  const k = held.length;
  expect(Math.abs(s.value - sum(held.map((r) => r.value)))).toBeLessThanOrEqual(tol(k));
  expect(Math.abs(s.invested - sum(held.map((r) => r.value - r.latent)))).toBeLessThanOrEqual(
    tol(2 * k),
  );
  expect(
    Math.abs(s.latent - (sum(held.map((r) => r.latent)) + residualLatent)),
  ).toBeLessThanOrEqual(tol(k + 1));
  expect(Math.abs(s.latent - (s.value - s.invested))).toBeLessThanOrEqual(tol(2));
  expect(Math.abs(s.total - (s.realized + s.latent))).toBeLessThanOrEqual(tol(2));
  expect(Math.abs(s.total - (sum(held.map((r) => r.total)) + closedHeader))).toBeLessThanOrEqual(
    tol(k + closedTotals.length),
  );
  expect(
    Math.abs(s.realized - (sum(held.map((r) => r.realized)) + closedHeader - residualLatent)),
  ).toBeLessThanOrEqual(tol(k + closedTotals.length + 1));
  expect(Math.abs(s.roiPct - (100 * s.total) / s.roiBase)).toBeLessThanOrEqual(0.1);
  expect(s.netCash).toBeGreaterThan(0);
  expect(s.fees).toBeGreaterThan(0);

  // Graphique : « Valeur des avoirs » (dernier point) = valeur de la synthèse.
  const evolution = page.locator('section.evolution');
  const chartValue = toNumber(await evolution.locator('.kpis .big').first().innerText());
  expect(Math.abs(chartValue - s.value)).toBeLessThanOrEqual(tol(k));
  await evolution.getByRole('radio', { name: 'Latent €' }).click();
  const chartLatent = toNumber(await evolution.locator('.kpis .big').first().innerText());
  expect(Math.abs(chartLatent - s.latent)).toBeLessThanOrEqual(tol(k + 1));
});

test('fiche actif et onglet Calcul reprennent exactement la ligne du portefeuille', async ({
  page,
}) => {
  await openDataset(page);
  const s = await readSummary(page);
  const open = await readRows(page.getByRole('list', { name: 'Positions' }));
  for (const row of open.slice(0, 3)) {
    const asset = row.asset;
    await page.goto(`#/asset/${asset.toLowerCase()}`);
    const hero = page.locator('header.hero');
    const [, invested, value] = await nums(hero.locator('.trio .big'));
    const [latent, latentPct] = await nums(hero.locator('.trio .small'));
    const [realized, total, roiPct, roiBase] = await nums(hero.locator('p.line').first());
    expect(Math.abs(invested! - (row.value - row.latent)), `${asset} investi`).toBeLessThanOrEqual(
      tol(2),
    );
    expect(value, `${asset} valeur`).toBe(row.value);
    expect(Math.abs(latent! - row.latent), `${asset} latent`).toBeLessThanOrEqual(tol(1));
    expect(latentPct, `${asset} latent %`).toBe(row.latentPct);
    expect(Math.abs(realized! - row.realized), `${asset} réalisé`).toBeLessThanOrEqual(tol(1));
    expect(Math.abs(total! - row.total), `${asset} total`).toBeLessThanOrEqual(tol(1));
    expect(Math.abs(roiPct! - (100 * total!) / roiBase!), `${asset} ROI`).toBeLessThanOrEqual(0.1);

    // Onglet Calcul : les formules affichées donnent les chiffres de la fiche.
    await page
      .getByRole('navigation', { name: 'Sections' })
      .getByRole('button', { name: 'Calcul' })
      .click();
    const formulas = await page.locator('div.calc .formula').allInnerTexts();
    const pru = /^(.+?) ÷ (.+?) = (.+)$/.exec(formulas[0]!.replace(/\s+/g, ' ').trim());
    expect(pru, `${asset} formule PRU`).not.toBeNull();
    const [, costText, qtyText, pruText] = pru!;
    if (!abbreviated(qtyText!)) {
      const ratio = toNumber(costText!) / toNumber(qtyText!);
      expect(Math.abs(ratio - toNumber(pruText!)) / ratio, `${asset} PRU`).toBeLessThan(0.001);
    }
    expect(Math.abs(toNumber(costText!) - invested!), `${asset} coût`).toBeLessThanOrEqual(tol(1));
    const totalFormula = formulas.find((f) => f.startsWith('Total ='))!;
    const heroTotal = plain(
      await hero.locator('p.line').first().locator('.num').nth(1).innerText(),
    );
    expect(plain(totalFormula)).toContain(`= ${heroTotal}`);
  }
  // Le ROI global et la devise n'ont pas changé en chemin (la synthèse vit dans l'espace Investissement).
  await page.goto('#/invest');
  expect((await readSummary(page)).roiPct).toBe(s.roiPct);
});

test('rapport et export CSV reprennent la synthèse', async ({ page }) => {
  await openDataset(page);
  const s = await readSummary(page);
  const open = await readRows(page.getByRole('list', { name: 'Positions' }));
  const stable = await readRows(page.getByRole('list', { name: 'Stablecoins' }));
  const closedHeader = (await nums(page.locator('details.list summary')))[0]!;

  // Rapport : indicateurs clés et totaux de tableaux.
  await page.goto('#/report');
  const kpis = page.locator('.kpis .kpi');
  await expect(kpis.first()).toBeVisible();
  const kpi: Record<string, number> = {};
  for (let i = 0; i < (await kpis.count()); i++) {
    const label = ((await kpis.nth(i).locator('.label').textContent()) ?? '').trim();
    const value = (await kpis.nth(i).locator('.value').innerText()).trim();
    if (/€/.test(value)) kpi[label] = toNumber(value);
  }
  for (const [label, expected] of [
    ['Investi', s.invested],
    ['Valeur', s.value],
    ['Latent', s.latent],
    ['Réalisé', s.realized],
    ['P&L total', s.total],
  ] as const) {
    expect(kpi[label], label).toBeDefined();
    expect(Math.abs(kpi[label]! - expected), label).toBeLessThanOrEqual(tol(1));
  }

  const totals: Record<string, number[]> = {};
  const sections = page.locator('article section.card', { has: page.locator('tfoot') });
  await expect(sections.first()).toBeVisible();
  for (let i = 0; i < (await sections.count()); i++) {
    const title = ((await sections.nth(i).locator('h2').textContent()) ?? '').trim();
    const cells = await sections.nth(i).locator('tfoot td').allInnerTexts();
    totals[title] = cells.map((c) => (/\d/.test(c) ? toNumber(c) : Number.NaN));
  }
  const titles = Object.keys(totals);
  const openTitle = titles.find((t) => /^Positions(?! clôturées)/.test(t))!;
  const closedTitle = titles.find((t) => /clôturées/.test(t))!;
  const allocationTitle = titles.find((t) => /Répartition/.test(t))!;
  expect(openTitle, titles.join(' | ')).toBeDefined();
  // Colonnes : Actif, Quantité, PRU, Prix, Valeur, Latent, Latent %, Réalisé, Total.
  const openTotal = totals[openTitle]!;
  expect(Math.abs(openTotal[4]! - sum(open.map((r) => r.value)))).toBeLessThanOrEqual(
    tol(open.length),
  );
  expect(Math.abs(openTotal[8]! - sum(open.map((r) => r.total)))).toBeLessThanOrEqual(
    tol(open.length),
  );
  const stableTitle = titles.find((t) => /Stablecoins/.test(t));
  if (stableTitle) {
    expect(
      Math.abs(totals[stableTitle]![8]! - sum(stable.map((r) => r.total))),
    ).toBeLessThanOrEqual(tol(stable.length));
  }
  expect(Math.abs(totals[closedTitle]![3]! - closedHeader)).toBeLessThanOrEqual(tol(1));
  expect(Math.abs(totals[allocationTitle]![1]! - s.value)).toBeLessThanOrEqual(tol(1));

  // Export CSV des positions : mêmes totaux que l'écran.
  await page.goto('#/settings');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Positions (CSV)' }).click();
  const content = readFileSync(await (await download).path(), 'utf8').replace(/^\ufeff/, '');
  const [header, ...lines] = content.trim().split(/\r?\n/);
  const cols = header!.split(';');
  const col = (name: RegExp): number => cols.findIndex((c) => name.test(c));
  const iStatus = col(/^Statut/);
  const iValue = col(/^Valeur/);
  const iTotal = col(/^Total/);
  const iLatent = col(/^Latent \(/);
  expect(
    [iStatus, iValue, iTotal, iLatent].every((i) => i >= 0),
    header,
  ).toBe(true);
  let csvValue = 0;
  let csvTotal = 0;
  let csvLatent = 0;
  for (const line of lines) {
    const cells = line.split(';');
    if (cells[iValue]) csvValue += toNumber(cells[iValue]!);
    if (cells[iTotal]) csvTotal += toNumber(cells[iTotal]!);
    if (cells[iLatent] && cells[iStatus] !== 'clôturée') csvLatent += toNumber(cells[iLatent]!);
  }
  expect(Math.abs(csvValue - s.value)).toBeLessThanOrEqual(tol(lines.length));
  expect(Math.abs(csvTotal - s.total)).toBeLessThanOrEqual(tol(lines.length));
  expect(Math.abs(csvLatent - s.latent)).toBeLessThanOrEqual(tol(lines.length));
});

/**
 * Espace Trading : le calendrier de P&L et le tableau de bord doivent parler du même argent.
 * Cette garde manquait, et c'est précisément ce qui a laissé passer un calendrier qui rattachait
 * tout le résultat d'un aller-retour à son jour de CLÔTURE — les jours de prise de bénéfice
 * partielle affichaient zéro, et le mois ne collait ni au tableau de bord ni à la plateforme.
 */
/**
 * Rapport « Abonnement Coinhouse » (décision n° 39) : l'écran reprend l'analyse du moteur —
 * offre détectée depuis les lignes d'abonnement de l'export, montants de la bonne branche.
 */
test('le rapport « Abonnement Coinhouse » reprend l’analyse du moteur', async ({ page }) => {
  const csv = REAL_CSV ?? FIXTURE;
  const parsed = importCoinhouseCsv(readFileSync(csv, 'utf8'), {}, 'imp:coh');
  if (!parsed.ok) throw new Error(parsed.error);
  const { events } = normalizeCoinhouseRows(Object.values(parsed.rows));
  const analysis = analyzeSubscription(events);
  const TIER_LABELS = {
    classique: 'Classique',
    investisseur: 'Investisseur',
    'gestion-privee': 'Gestion Privée',
  } as const;

  await openDataset(page);
  await page.goto('#/report');
  // Niveau 2 : la méthodologie porte un h3 du même nom.
  await expect(page.getByRole('heading', { level: 2, name: 'Abonnement Coinhouse' })).toBeVisible();
  await expect(page.locator('tr', { hasText: 'Offre détectée' })).toContainText(
    TIER_LABELS[analysis.detectedTier],
  );
  if (analysis.detectedTier === 'classique') {
    await expect(page.locator('tr', { hasText: 'Frais payés (12 derniers mois)' })).toContainText(
      normalize(fmtMoney(D(analysis.feesNet12m))),
    );
  } else {
    await expect(
      page.locator('tr', { hasText: 'Abonnements payés (12 derniers mois)' }),
    ).toContainText(normalize(fmtMoney(D(analysis.subscriptions12m))));
    await expect(page.locator('tr', { hasText: 'Rentabilité de l’offre' })).toContainText(
      normalize(fmtMoney(D(analysis.netOfSubscription12m ?? '0'), 'EUR', { sign: true })),
    );
  }
});

test('Trading : la somme du calendrier = le réalisé net du tableau de bord', async ({ page }) => {
  test.skip(Boolean(REAL_CSV), 'espace Trading : jeu de démonstration seulement');
  await openDemo(page);

  // Tableau de bord : « Réalisé net » de tout l'historique (ligne de la carte Synthèse).
  await page.goto('#/trading');
  const summaryLine = page.locator('section.summary p.line');
  await expect(summaryLine).toBeVisible();
  const realized = toNumber(plain(await summaryLine.innerText()).match(/Réalisé net (\S+)/)![1]!);

  // Calendrier : somme des totaux hebdomadaires, sur tous les mois atteignables.
  await page.goto('#/trading/stats');
  const previous = page.getByRole('button', { name: 'Mois précédent' });
  await expect(previous).toBeVisible();
  let calendar = 0;
  let weeks = 0;
  for (;;) {
    const totals = await page.locator('.week-total').allInnerTexts();
    for (const raw of totals) {
      if (!/\d/.test(raw)) continue;
      calendar += toNumber(raw);
      weeks++;
    }
    if (await previous.isDisabled()) break;
    await previous.click();
  }
  expect(weeks).toBeGreaterThan(0);
  expect(Math.abs(calendar - realized)).toBeLessThanOrEqual(tol(weeks));
});

/**
 * Vue d'ensemble : elle COMPOSE les deux espaces, elle ne recalcule rien. Personne ne le vérifiait —
 * elle pouvait dériver de l'un ou de l'autre sans qu'aucun test ne bronche.
 */
test('Vue d’ensemble : valeur nette = valeur d’investissement + équité de trading', async ({
  page,
}) => {
  test.skip(Boolean(REAL_CSV), 'Vue d’ensemble : jeu de démonstration seulement');
  await openDemo(page);

  await page.goto('#/');
  const trio = page.locator('section.hero .trio');
  await expect(trio).toBeVisible();
  const big = trio.locator('.big');
  const netWorth = toNumber(await big.nth(0).innerText());
  const investCard = toNumber(await big.nth(1).innerText());
  const tradingCard = toNumber(await big.nth(2).innerText());
  // La carte se recoupe d'abord avec elle-même…
  expect(Math.abs(netWorth - (investCard + tradingCard))).toBeLessThanOrEqual(tol(2));

  // … puis avec chacun des deux espaces, lus sur leur propre écran.
  await page.goto('#/invest');
  expect(Math.abs(investCard - (await readSummary(page)).value)).toBeLessThanOrEqual(tol(1));

  await page.goto('#/trading');
  const equity = toNumber(await page.locator('section.summary .trio .big').nth(1).innerText());
  expect(Math.abs(tradingCard - equity)).toBeLessThanOrEqual(tol(1));
});

/**
 * Constats (décision n° 40) : l'écran affiche EXACTEMENT les phrases produites par le moteur de
 * règles suivi de son rendu français — pas une reformulation faite dans le composant. On compare
 * sur les constats indépendants des prix (frais et abonnement), reproductibles hors navigateur.
 */
test('les « Constats » reprennent le moteur de règles', async ({ page }) => {
  const csv = REAL_CSV ?? FIXTURE;
  const parsed = importCoinhouseCsv(readFileSync(csv, 'utf8'), {}, 'imp:coh');
  if (!parsed.ok) throw new Error(parsed.error);
  const rows = Object.values(parsed.rows);
  const { events } = normalizeCoinhouseRows(rows);
  const report = computePortfolio({
    events,
    prices: {},
    settings: DEFAULT_ENGINE_SETTINGS,
    balances: balanceRecords(rows),
  });
  const expected = renderInsights(
    buildInsights({ report, subscription: analyzeSubscription(events) }),
    { discreet: false, currency: 'EUR' },
  );
  const sentence = (code: string): string | null =>
    expected.find((i) => i.code === code)?.detail ?? null;

  await openDataset(page);
  await page.goto('#/');
  await expect(page.getByRole('heading', { level: 2, name: 'Constats' })).toBeVisible();
  await expect(page.locator('section.insights li')).not.toHaveCount(0);

  // Le rapport les montre tous : c'est là qu'on vérifie les phrases mot pour mot.
  await page.goto('#/report');
  const section = page.locator('section', { has: page.getByRole('heading', { name: 'Constats' }) });
  for (const code of ['fees-12m', 'subscription-net']) {
    const detail = sentence(code);
    if (detail === null) continue;
    await expect(section).toContainText(normalize(detail));
  }
  // Et la frontière information / conseil est écrite noir sur blanc.
  await expect(section).toContainText('ni un conseil en investissement');
});

/**
 * Risque (décision n° 41) : le constat « Repli maximal » et la ligne du tableau « Risque » sont
 * deux rendus de la MÊME mesure — s'ils divergent, c'est qu'un des deux recalcule dans son coin.
 * On compare l'écran à lui-même, faute de pouvoir rejouer l'historique de prix hors navigateur.
 */
test('le repli maximal dit la même chose dans le constat et dans le tableau', async ({ page }) => {
  await openDataset(page);
  await page.goto('#/report');
  const section = page.locator('section', { has: page.getByRole('heading', { name: 'Risque' }) });
  await expect(section).toBeVisible();

  const row = section.locator('tr', { hasText: 'Repli maximal' });
  const rowText = plain(await row.innerText());
  const rowPct = /(\d+[.,]\d+)\s*%/.exec(rowText)?.[1];
  expect(rowPct, rowText).toBeDefined();

  const insight = page.locator('.detail', { hasText: 'plus forte baisse' });
  if ((await insight.count()) === 0) {
    // Aucun repli sur la période : le tableau doit alors afficher « — », pas un chiffre.
    expect(rowText).toContain('—');
    return;
  }
  const insightText = plain(await insight.first().innerText());
  expect(insightText).toContain(rowPct!);
  // Et la mention de recouvrement est la même des deux côtés.
  const recovered = rowText.includes('pas encore retrouvé');
  expect(insightText.includes('n’a pas encore été retrouvé')).toBe(recovered);
});

/**
 * Fiscalité (décision n° 43) : le constat « Fiscalité de l'année » et le tableau « Fiscalité
 * française » sont deux rendus de la MÊME estimation. On compare l'écran à lui-même : rejouer la
 * valeur globale du portefeuille au jour de chaque cession demande l'historique de prix, que seul
 * le navigateur charge.
 */
test('l’estimation fiscale dit la même chose dans le constat et dans le tableau', async ({
  page,
}) => {
  await openDataset(page);
  await page.goto('#/report');
  const section = page.locator('section', {
    has: page.getByRole('heading', { name: 'Fiscalité française (estimation)' }),
  });
  // La section n'apparaît qu'une fois l'historique de prix chargé : on lui laisse le temps.
  await expect(section).toBeVisible({ timeout: 20_000 });
  // Les deux hypothèses qui commandent le résultat doivent rester écrites.
  await expect(section).toContainText('PORTEFEUILLE ENTIER');
  await expect(section).toContainText('ni un conseil fiscal');

  const insight = page.locator('.detail', { hasText: 'cession' }).filter({ hasText: 'En 20' });
  if ((await insight.count()) === 0) return;
  const text = plain(await insight.first().innerText());
  const year = /En (\d{4})/.exec(text)![1]!;
  const row = section.locator('tr', { hasText: `${year} · cessions imposables` });
  await expect(row).toHaveCount(1);
  // Le total des cessions de l'année est le même des deux côtés.
  const rowAmount = /(\d[\d  ]*,\d{2}) €/.exec(plain(await row.innerText()))![1]!;
  expect(text).toContain(rowAmount);
});
