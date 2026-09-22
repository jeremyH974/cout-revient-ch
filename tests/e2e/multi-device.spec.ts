import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { FIXTURE } from './helpers/expected';
import { stubNetwork } from './helpers/network';

/** Identifiant d'appareil porté par une version `<13 chiffres>.<4 chiffres>.<deviceId>` (`sync/hlc.ts`). */
function deviceOf(tick: string | undefined): string | undefined {
  return tick?.split('.').slice(2).join('.');
}

interface BackupLike {
  state: { sync?: { versions?: Record<string, Record<string, { t: string }>> } };
}

function journalDevice(backupPath: string, journalKey: string): string | undefined {
  const backup = JSON.parse(readFileSync(backupPath, 'utf8')) as BackupLike;
  return deviceOf(backup.state.sync?.versions?.['journal']?.[journalKey]?.t);
}

/**
 * Fusion multi-appareils (P… — voir `docs/DECISIONS.md`, décision de ce chantier) : deux CONTEXTES
 * de navigateur, chacun avec son propre `localStorage`/IndexedDB, donc son propre `deviceId`
 * (`$lib/storage/device-id.ts`) — la même isolation que deux appareils réels. Le seul lien entre
 * eux est le fichier de sauvegarde JSON, exactement comme dans la vraie vie (téléchargement, puis
 * restauration ailleurs).
 *
 * Téléchargements : Chromium seulement (comme `downloads.spec.ts`).
 */
test.beforeEach(({ browserName }) => {
  test.skip(browserName !== 'chromium', 'téléchargements : Chromium seulement');
});

/** Sauvegarde JSON de `page` (va aux Réglages d'abord), renvoie le chemin LOCAL du téléchargement. */
async function download(page: Page): Promise<string> {
  await page.goto('#/settings');
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Télécharger une sauvegarde (JSON)' }).click(),
  ]);
  const path = await file.path();
  if (!path) throw new Error('téléchargement sans chemin local');
  return path;
}

/** Restaure `backupPath` sur `page`, dans le mode demandé, et attend le message de résultat. */
async function restore(
  page: Page,
  backupPath: string,
  mode: 'merge' | 'replace',
  expectedToast: RegExp | string,
): Promise<void> {
  await page.goto('#/settings');
  await page.getByLabel('Mode de restauration').selectOption(mode);
  await page.setInputFiles('input[type="file"][accept*="json"]', backupPath);
  await expect(page.getByText(expectedToast)).toBeVisible();
}

/** Trade manuel + note de journal, jusqu'à la fiche du trade — renvoie le fragment d'URL de la fiche. */
async function addManualTradeWithJournal(page: Page, thesis: string): Promise<string> {
  await page.goto('#/trading/add');
  await page.getByLabel('Symbole').fill('BTC');
  await page.getByLabel('Taille').fill('0.1');
  await page.getByLabel("Prix d'entrée").fill('60000');
  // `fill` refuse les secondes sur un datetime-local (step=1) : DOM + event input (voir discreet.spec.ts).
  // Deux champs datetime-local sur ce formulaire (entrée/sortie) : on cible « Entrée le » par son label.
  await page.getByLabel('Entrée le').evaluate((el, value) => {
    const input = el as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, '2026-01-10T10:00:00');
  await page.getByRole('button', { name: 'Enregistrer le trade' }).click();
  await expect(page).toHaveURL(/#\/trading\/trade\/man%3A/);
  await page.getByLabel(/Pourquoi j'ai pris ce trade/).fill(thesis);
  await page.getByRole('button', { name: 'Enregistrer le journal' }).click();
  await expect(page.getByText('Journal enregistré.')).toBeVisible();
  return new URL(page.url()).hash;
}

test('deux appareils convergent : note ajoutée, note modifiée, trade supprimé — et un fichier fusionné une seconde fois ne ressuscite rien', async ({
  browser,
}) => {
  const deviceA = await browser.newContext();
  const deviceB = await browser.newContext();
  await stubNetwork(deviceA);
  await stubNetwork(deviceB);
  const pageA = await deviceA.newPage();
  const pageB = await deviceB.newPage();

  // --- A : import réel (pas la démo), un trade manuel, une note de journal --------------------
  await pageA.goto('#/import');
  await pageA.setInputFiles('input[type="file"]', FIXTURE);
  await expect(pageA.getByRole('heading', { name: 'Import réussi' })).toBeVisible();
  const tradeHash = await addManualTradeWithJournal(pageA, 'Thèse initiale, écrite par A.');

  // --- A exporte, B restaure « en remplaçant » : B part avec EXACTEMENT les données de A -------
  const fromA1 = await download(pageA);
  await restore(pageB, fromA1, 'replace', 'Sauvegarde restaurée.');

  // --- B modifie la note (même trade, retrouvé au même identifiant) ---------------------------
  await pageB.goto(tradeHash);
  const thesisB = pageB.getByLabel(/Pourquoi j'ai pris ce trade/);
  await expect(thesisB).toHaveValue('Thèse initiale, écrite par A.');
  await thesisB.fill('Thèse révisée par B.');
  await pageB.getByRole('button', { name: 'Enregistrer le journal' }).click();
  await expect(pageB.getByText('Journal enregistré.')).toBeVisible();

  // --- B exporte, A fusionne : A doit désormais afficher la note de B -------------------------
  const fromB1 = await download(pageB);
  await restore(pageA, fromB1, 'merge', /Fusion : 0 ajoutés?, 1 mis à jour, 0 supprimés?\./);
  await pageA.goto(tradeHash);
  await expect(pageA.getByLabel(/Pourquoi j'ai pris ce trade/)).toHaveValue('Thèse révisée par B.');

  // --- `baseline` réalignée après la fusion (et pas seulement le CONTENU affiché) --------------
  // La note affichée peut être correcte alors que sa VERSION a été ré-attribuée en silence à A —
  // exactement ce qu'un `baseline` non réalignée provoquerait au prochain enregistrement (§
  // `AppState.restoreBackup`, `docs/DECISIONS.md`). On le prouve en import/export, pas en lisant
  // l'écran : ré-exporter IMMÉDIATEMENT après la fusion (sans aucune autre édition) doit encore
  // porter la version de B sur cette entrée de journal — jamais une version fraîche de A.
  const journalKey = decodeURIComponent(tradeHash.split('/trading/trade/')[1] ?? '');
  const journalDeviceB = journalDevice(fromB1, journalKey);
  const journalDeviceA = journalDevice(fromA1, journalKey);
  expect(journalDeviceB, 'B doit avoir daté sa propre édition').toBeTruthy();
  expect(journalDeviceA, 'A doit avoir daté sa note initiale').toBeTruthy();
  expect(journalDeviceB).not.toBe(journalDeviceA); // les deux appareils sont bien distincts
  const fromA1b = await download(pageA); // aucune édition entre la fusion et cet export
  expect(
    journalDevice(fromA1b, journalKey),
    "la version de l'entrée de journal doit rester celle de B, pas être réattribuée à A au premier enregistrement suivant la fusion",
  ).toBe(journalDeviceB);

  // --- A supprime le trade manuel, exporte -----------------------------------------------------
  await pageA.goto(tradeHash);
  await pageA.getByRole('button', { name: 'Supprimer ce trade manuel' }).click();
  await expect(pageA.getByText('Trade supprimé.')).toBeVisible();
  await expect(pageA).toHaveURL(/#\/trading\/trades$/);
  const fromA2 = await download(pageA);

  // --- B fusionne : le trade disparaît chez B aussi ----------------------------------------------
  // `removeManualTrade` retire aussi l'entrée de journal rattachée (`app.svelte.ts`) : DEUX
  // suppressions traversent la fusion (`manualTrades` ET `journal`), pas une seule.
  await restore(pageB, fromA2, 'merge', /Fusion : 0 ajoutés?, 0 mis à jour, 2 supprimés?\./);
  await pageB.goto(tradeHash);
  await expect(pageB.getByText('Trade introuvable')).toBeVisible();

  // --- A refusionne l'ANCIEN fichier de B (`fromB1`, antérieur à la suppression) : le trade ne
  //     doit PAS ressusciter — la pierre tombale de A, plus récente, l'emporte toujours. Rien ne
  //     change plus (A avait déjà ce fichier absorbé), d'où un rapport entièrement à zéro.
  await restore(pageA, fromB1, 'merge', 'Fusion : 0 ajouté, 0 mis à jour, 0 supprimé.');
  await pageA.goto(tradeHash);
  await expect(pageA.getByText('Trade introuvable')).toBeVisible();
  await pageA.goto('#/trading/trades');
  await expect(pageA.getByText("Aucun trade pour l'instant")).toBeVisible();

  await deviceA.close();
  await deviceB.close();
});
