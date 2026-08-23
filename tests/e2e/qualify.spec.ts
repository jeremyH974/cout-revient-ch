import { expect, test } from '@playwright/test';
import { computePortfolio } from '../../src/lib/domain/engine';
import type { EventId, Qualification } from '../../src/lib/domain/types';
import { DEFAULT_ENGINE_SETTINGS } from '../../src/lib/domain/types';
import { fmtQty } from '../../src/lib/format/fr';
import { balanceRecords } from '../../src/lib/import/coinhouse/balances';
import { COINHOUSE_HEADER_2026_08 } from '../../src/lib/import/coinhouse/detect';
import { importCoinhouseCsv } from '../../src/lib/import/coinhouse/index';
import { normalizeCoinhouseRows } from '../../src/lib/import/coinhouse/normalize';
import { normalize, position } from './helpers/expected';
import { stubNetwork } from './helpers/network';

test.beforeEach(async ({ context }) => {
  await stubNetwork(context);
});

/**
 * Deux achats de SOL (« Echange », deux lignes chacun — jambe actif puis jambe EUR contrepartie,
 * mêmes formats de cellules que `export-demo.csv`), puis une ligne d'un type inconnu (« Staking
 * SOL » : reconnu par la famille de mots « staking », jamais confirmé par un export réel → à
 * qualifier, avec « Ignorer » suggéré). Trié du plus récent au plus ancien, comme un vrai export.
 */
const CSV =
  [
    COINHOUSE_HEADER_2026_08.join(','),
    'a0000003,20/01/2026 09:00:00,Staking SOL,0.5,sol,82,41.0,,,,8.5,Portefeuille',
    'a0000002,12/01/2026 10:00:00,Echange,3.0,sol,85,255.0,,,,8.0,Portefeuille',
    'a0000002,12/01/2026 10:00:00,Echange,-255.0,eur,1,-255.0,2.64,2.64,0.0,,""',
    'a0000001,05/01/2026 10:00:00,Echange,5.0,sol,80,400.0,,,,5.0,Portefeuille',
    'a0000001,05/01/2026 10:00:00,Echange,-400.0,eur,1,-400.0,4.08,4.08,0.0,,""',
  ].join('\n') + '\n';

/** Rejoue l'import (moteur pur) pour obtenir les chiffres attendus : jamais de chiffre en dur. */
function reportFor(qualifications: Record<EventId, Qualification> = {}) {
  const result = importCoinhouseCsv(CSV, {}, 'imp:qualify-spec');
  if (!result.ok) throw new Error(result.error);
  const rows = Object.values(result.rows);
  const { events } = normalizeCoinhouseRows(rows, qualifications);
  const report = computePortfolio({
    events,
    prices: {},
    settings: DEFAULT_ENGINE_SETTINGS,
    balances: balanceRecords(rows),
  });
  return { report, events, rows };
}

test('qualifie une opération inconnue en récompense (suggestion pré-sélectionnée), puis annule', async ({
  page,
}) => {
  const before = reportFor();
  expect(before.report.unqualified).toHaveLength(1);
  const unqualified = before.report.unqualified[0]!;

  const after = reportFor({ [unqualified.id]: { kind: 'reward', fairValueEur: null } });
  const solBefore = position(before.report, 'sol');
  const solAfter = position(after.report, 'sol');
  expect(solAfter.qty.gt(solBefore.qty)).toBe(true);
  const qtyBeforeText = normalize(fmtQty(solBefore.qty, { abbreviate: true }));
  const qtyAfterText = normalize(fmtQty(solAfter.qty, { abbreviate: true }));

  await page.goto('#/import');
  await page.setInputFiles('input[type="file"]', {
    name: 'export.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(CSV),
  });
  await expect(page.getByRole('heading', { name: 'Import réussi' })).toBeVisible();
  await expect(
    page.getByText(`${before.rows.length} nouvelle(s) ligne(s) · 0 déjà connue(s)`),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Voir mon portefeuille' }).click();
  await expect(page.getByRole('heading', { name: 'À qualifier (1)' })).toBeVisible();

  // Avant qualification : la récompense de 0,5 SOL n'entre pas dans la position.
  await page.goto('#/asset/sol');
  await expect(page.getByRole('heading', { level: 1, name: 'SOL' })).toBeVisible();
  const heldStat = page.locator('.trio > div').filter({ hasText: 'Détenu' }).locator('p.big');
  await expect(heldStat).toHaveText(qtyBeforeText);

  await page.goto('#/');
  await page.getByRole('button', { name: 'Qualifier', exact: true }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: "Qualifier l'opération" })).toBeVisible();
  await expect(dialog.getByRole('radio', { name: 'Ignorer (mouvement interne)' })).toBeChecked();

  await dialog.getByRole('radio', { name: 'Récompense (staking, intérêts, parrainage)' }).check();
  await dialog.getByRole('button', { name: 'Enregistrer' }).click();

  await expect(page.getByRole('heading', { name: 'À qualifier (1)' })).toBeHidden();
  await expect(
    page.getByRole('heading', { name: 'Qualifications enregistrées (1)' }),
  ).toBeVisible();

  // Après qualification : la quantité de SOL augmente de la quantité reçue en récompense.
  await page.goto('#/asset/sol');
  await expect(heldStat).toHaveText(qtyAfterText);

  await page.goto('#/');
  await page.getByRole('button', { name: /Annuler la qualification/ }).click();
  await expect(page.getByRole('heading', { name: 'À qualifier (1)' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Qualifications enregistrées (1)' })).toBeHidden();
});
