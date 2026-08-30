/**
 * Appariement de colonnes assisté (P64), **sans aucune clé d'API** : c'est le parcours que 100 %
 * des utilisateurs auront.
 *
 * Le fichier est une fixture 100 % synthétique aux en-têtes français inédits qu'aucune table
 * fermée de l'application ne reconnaît (« Horodatage », « Quantité vendue », « Contre-valeur
 * (EUR) »), avec des dates `jj/MM/aaaa` et des décimales à virgule. Aucun chiffre n'est écrit en
 * dur dans ce test : tout est comparé au moteur, rejoué depuis le même appariement
 * (`tests/e2e/helpers/expected.ts`, même règle que les autres parcours).
 *
 * Le parcours va jusqu'au bout de ce que P64 promet : appariement, **correction d'une ligne**,
 * import, concordance avec le moteur, puis **annulation de l'import** et retour à l'état antérieur.
 */
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { computePortfolio } from '../../src/lib/domain/engine';
import { DEFAULT_ENGINE_SETTINGS } from '../../src/lib/domain/types';
import { fmtQty } from '../../src/lib/format/fr';
import { parseCsvText } from '../../src/lib/import/csv';
import { confirmedMapping, proposeMapping } from '../../src/lib/import/mapping/propose';
import { importMappedCsv } from '../../src/lib/import/mapping/index';
import { pivotLedgerEvents } from '../../src/lib/import/pivot/events';
import { stubNetwork } from './helpers/network';

const FIXTURE = 'tests/fixtures/mapping/demo-inconnu.csv';
/** Même taux que le stub Frankfurter de `helpers/network.ts`. */
const USD_RATE = (): string => '1.1';

/** Rejoue le fichier comme l'app : proposition déterministe → lignes → événements → moteur. */
function expected() {
  const text = readFileSync(FIXTURE, 'utf8');
  const table = parseCsvText(text);
  const proposal = proposeMapping(table);
  const mapping = confirmedMapping(proposal);
  const result = importMappedCsv(text, mapping, {}, 'csv:e2e-mapping', 'i1', USD_RATE);
  if (!result.ok) throw new Error(result.error);
  const { events } = pivotLedgerEvents(Object.values(result.rows), {}, USD_RATE);
  const report = computePortfolio({ events, prices: {}, settings: DEFAULT_ENGINE_SETTINGS });
  return { report, importReport: result.report, proposal };
}

test.beforeEach(async ({ context }) => {
  await stubNetwork(context);
});

/**
 * En-têtes de la fixture, dans l'ordre. On choisit une colonne par son INDICE : dès qu'elle est
 * affectée, son option porte un suffixe « (actuellement : …) » et un libellé exact ne la trouve
 * plus — c'est ce qui faisait échouer ce test à sa première exécution réelle.
 */
const HEADERS = [
  'Horodatage',
  'Opération',
  'Quantité vendue',
  'Devise vendue',
  'Quantité achetée',
  'Devise achetée',
  'Commission',
  'Devise des frais',
  'Contre-valeur (EUR)',
  'Note',
] as const;
const col = (name: (typeof HEADERS)[number]): string => String(HEADERS.indexOf(name));

test('un CSV aux en-têtes inconnus : appariement déterministe, correction, import, annulation', async ({
  page,
}) => {
  const { report, importReport, proposal } = expected();
  // Le fichier ne ressemble à AUCUN format connu, et pourtant tout est apparié sans modèle.
  expect(proposal.admissible).toBe(true);
  expect(proposal.columns).toHaveLength(10);

  await page.goto('#/import');
  await page.setInputFiles('input[type="file"]', FIXTURE);

  // 1) L'écran d'appariement s'ouvre, avec ses contrôles au vert.
  await expect(page.getByRole('heading', { name: 'Quelle colonne est quoi ?' })).toBeVisible();
  await expect(page.getByText('Sens des opérations : vérifié')).toBeVisible();
  // L'écart de solde est DÉCLARÉ inapplicable, jamais réputé vert : le fichier n'a pas de solde.
  await expect(page.getByText('Écart de solde : non applicable')).toBeVisible();
  // Aucun bouton de modèle sans clé : la voie déterministe se suffit à elle-même.
  await expect(page.getByRole('button', { name: 'Demander à un modèle' })).toHaveCount(0);

  // 2) Correction d'une ligne : on retire la description, puis on la remet. L'écran suit.
  const description = page.getByLabel('Description');
  await description.selectOption('');
  await expect(page.getByRole('button', { name: /^Importer \d+ ligne/ })).toBeEnabled();
  await description.selectOption(col('Note'));

  // 3) Une inversion des jambes fait rougir le contrôle du SENS, avant tout import.
  // Permutation COMPLÈTE des deux jambes. Ne voler que les colonnes « envoyé » rendrait
  // l'appariement incomplet, et le refus viendrait alors de l'admissibilité — pas du sens. Or
  // c'est le contrôle du SENS qu'on veut voir mordre : lui seul détecte une inversion sur un
  // fichier par ailleurs parfaitement lisible.
  await page.getByLabel('Quantité envoyée').selectOption(col('Quantité achetée'));
  await page.getByLabel('Actif envoyé').selectOption(col('Devise achetée'));
  await page.getByLabel('Quantité reçue').selectOption(col('Quantité vendue'));
  await page.getByLabel('Actif reçu').selectOption(col('Devise vendue'));
  // Les colonnes indispensables sont toutes là : le refus qui suit ne peut venir que du sens.
  await expect(page.getByText('Colonnes indispensables : vérifié')).toBeVisible();
  await expect(page.getByText('Sens des opérations : refusé')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Importer \d+ ligne/ })).toBeDisabled();
  // On rétablit : le contrôle repasse au vert et l'import redevient possible.
  await page.getByLabel('Quantité envoyée').selectOption(col('Quantité vendue'));
  await page.getByLabel('Actif envoyé').selectOption(col('Devise vendue'));
  await page.getByLabel('Quantité reçue').selectOption(col('Quantité achetée'));
  await page.getByLabel('Actif reçu').selectOption(col('Devise achetée'));
  await expect(page.getByText('Sens des opérations : vérifié')).toBeVisible();

  // 4) Import : les chiffres de l'écran sont ceux du moteur, jamais des littéraux.
  await page.getByRole('button', { name: /^Importer \d+ ligne/ }).click();
  await expect(page.getByRole('heading', { name: 'Import réussi' })).toBeVisible();
  await expect(
    page.getByText(`${importReport.newRows} nouvelle(s) ligne(s) · 0 déjà connue(s)`),
  ).toBeVisible();

  await page.getByRole('link', { name: 'Voir mon portefeuille' }).click();
  await expect(page.getByRole('list', { name: 'Positions' }).getByRole('listitem')).toHaveCount(
    report.positions.length,
  );
  const btc = report.positions.find((p) => p.asset === 'btc');
  if (btc === undefined) throw new Error('la fixture doit porter une position BTC');
  await expect(
    page
      .getByRole('list', { name: 'Positions' })
      .getByRole('listitem')
      .filter({ hasText: 'BTC' })
      .getByText(fmtQty(btc.qty), { exact: false }),
  ).toBeVisible();

  // 5) Annulation de l'import : retour à l'état antérieur, portefeuille vide.
  await page.goto('#/import');
  await page.setInputFiles('input[type="file"]', FIXTURE);
  await expect(page.getByRole('heading', { name: 'Quelle colonne est quoi ?' })).toBeVisible();
  // L'appariement confirmé a été MÉMORISÉ sur le compte : le même en-tête le retrouve seul.
  await page.getByRole('radio', { name: /existant/ }).check();
  await expect(page.getByText('Appariement retrouvé sur ce compte')).toBeVisible();
  await page.getByRole('button', { name: /^Importer \d+ ligne/ }).click();
  await expect(page.getByRole('heading', { name: 'Import réussi' })).toBeVisible();
  await page.getByRole('button', { name: 'Annuler cet import' }).click();
  await expect(page.getByText(/Import annulé/)).toBeVisible();

  // Le second import n'avait rien ajouté (lignes déjà connues) : le portefeuille est intact.
  await page.goto('#/portfolio');
  await expect(page.getByRole('list', { name: 'Positions' }).getByRole('listitem')).toHaveCount(
    report.positions.length,
  );
});
