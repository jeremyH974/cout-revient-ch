/**
 * Cohérence transversale des chiffres AFFICHÉS : les écrans se recoupent entre eux, à l'arrondi
 * près (chaque valeur est arrondie au centime : une somme de k valeurs peut dévier de 0,005 × k).
 * Synthèse ↔ lignes ↔ positions clôturées ↔ fiche actif ↔ onglet Calcul ↔ rapport ↔ export CSV
 * ↔ graphique. Les tests `demo`/`asset` comparent déjà l'écran au moteur ; ici on vérifie que
 * l'outil ne se contredit jamais d'une page à l'autre.
 */
import { existsSync, readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { openDemo } from './helpers/demo';
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
    // Le libellé « Prix » (lecteurs d'écran) précède la valeur.
    const priceText = (await li.locator('.cell.price').innerText()).replace(/^Prix\s*/, '').trim();
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
  // Le ROI global et la devise n'ont pas changé en chemin.
  await page.goto('#/');
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
