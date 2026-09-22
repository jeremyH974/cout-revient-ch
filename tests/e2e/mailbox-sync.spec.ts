/**
 * Boîte aux lettres chiffrée (P125) : dossier de synchronisation d'un vrai bout en bout, sur
 * DEUX CONTEXTES de navigateur (donc deux `deviceId` distincts, comme deux appareils réels — même
 * patron que `multi-device.spec.ts`).
 *
 * **PC, sans sélecteur natif pilotable par l'automatisation** : `showDirectoryPicker()` exige un
 * geste utilisateur réel et une boîte de dialogue du système d'exploitation que Playwright ne peut
 * pas piloter. Le point d'injection réservé aux tests (`window.__crchSetMailboxFolderForTests`,
 * `src/main.ts`) accepte à la place un `FileSystemDirectoryHandle` obtenu par la PAGE elle-même via
 * `navigator.storage.getDirectory()` (OPFS) — la même interface que File System Access, exposée
 * SANS dialogue. Voir la note de tête de `src/lib/storage/mailbox-folder.ts` sur pourquoi ceci ne
 * fait pas de l'application elle-même un usage d'OPFS pour ses données.
 *
 * **Téléphone, sans File System Access du tout** : simulé en retirant `showDirectoryPicker` du
 * `window` AVANT le premier chargement (`addInitScript`), ce qui force `isMailboxFolderSupported()`
 * à `false` et donc l'écran sur son chemin « Recevoir / Envoyer ».
 */
import { expect, test, type Page } from '@playwright/test';
import { encryptMailboxEnvelope } from '../../src/lib/storage/mailbox-envelope';
import { mailboxFileName } from '../../src/lib/storage/mailbox';
import { emptyState } from '../../src/lib/storage/schema';
import { FIXTURE, fixtureReport } from './helpers/expected';
import { stubNetwork } from './helpers/network';

/** Une charge utile VALIDE (sinon `restoreBackup` la rejette avant même de compter un pair). */
const EMPTY_PAYLOAD = JSON.stringify(emptyState());

test.beforeEach(({ browserName }) => {
  test.skip(browserName !== 'chromium', 'File System Access / OPFS : Chromium seulement');
});

const PASSPHRASE = 'phrase de synchronisation partagée, e2e';
/** Paramètres Argon2id réduits (même patron que `mailbox-envelope.test.ts`) : tests rapides. */
const FAST_KDF = { m: 64, t: 1, p: 1 };

/**
 * Injecte un sous-dossier OPFS frais comme dossier de synchronisation, à la place du sélecteur —
 * voir la note de tête de fichier. `chosen` reflète le `boolean` que renvoie
 * `AppState.chooseMailboxFolder`.
 */
async function chooseOpfsFolder(page: Page, dirName: string): Promise<void> {
  const chosen = await page.evaluate(async (name) => {
    const root = await navigator.storage.getDirectory();
    const sub = await root.getDirectoryHandle(name, { create: true });
    const hook = (
      window as unknown as {
        __crchSetMailboxFolderForTests: (h: FileSystemDirectoryHandle) => Promise<boolean>;
      }
    ).__crchSetMailboxFolderForTests;
    return hook(sub);
  }, dirName);
  expect(chosen).toBe(true);
}

/** Contenu texte de chaque fichier d'un sous-dossier OPFS déjà créé par `chooseOpfsFolder`. */
async function opfsFiles(page: Page, dirName: string): Promise<Record<string, string>> {
  return page.evaluate(async (name) => {
    const root = await navigator.storage.getDirectory();
    const sub = await root.getDirectoryHandle(name);
    const out: Record<string, string> = {};
    for await (const entry of sub.values()) {
      if (entry.kind !== 'file') continue;
      const fileHandle = await sub.getFileHandle(entry.name);
      const file = await fileHandle.getFile();
      out[entry.name] = await file.text();
    }
    return out;
  }, dirName);
}

/** La feuille « Phrase de synchronisation » est déjà ouverte (ou s'ouvre au prochain effet) : la remplit. */
async function unlockPassphrase(page: Page): Promise<void> {
  await expect(page.getByLabel('Phrase de synchronisation')).toBeVisible();
  await page.getByLabel('Phrase de synchronisation').fill(PASSPHRASE);
  await page.getByRole('button', { name: 'Déverrouiller' }).click();
}

test('PC : dossier OPFS injecté, choisi, synchronisé — le fichier produit est un dépôt v3 valide', async ({
  browser,
}) => {
  const context = await browser.newContext();
  await stubNetwork(context);
  const page = await context.newPage();

  await page.goto('#/import');
  await page.setInputFiles('input[type="file"]', FIXTURE);
  await expect(page.getByRole('heading', { name: 'Import réussi' })).toBeVisible();

  await page.goto('#/synchro');
  await expect(page.getByRole('heading', { level: 1, name: 'Synchronisation' })).toBeVisible();
  await chooseOpfsFolder(page, 'boite-pc-solo');
  await unlockPassphrase(page);
  await expect(page.getByRole('button', { name: 'Synchroniser maintenant' })).toBeVisible();

  const files = await opfsFiles(page, 'boite-pc-solo');
  const names = Object.keys(files);
  expect(names).toHaveLength(1);
  expect(names[0]).toMatch(/^cout-revient-ch-sync-.+-000001\.txt$/);
  const envelope = JSON.parse(Object.values(files)[0]!);
  expect(envelope).toMatchObject({
    app: 'cout-revient-ch',
    kind: 'mailbox',
    version: 3,
    seq: 1,
    kdf: 'argon2id',
    compression: 'gzip',
  });
  expect(typeof envelope.device).toBe('string');
  expect(envelope.device.length).toBeGreaterThan(0);

  await context.close();
});

test('PC dépose (dossier OPFS), téléphone reçoit (sélecteur de fichier) et fusionne', async ({
  browser,
}) => {
  // --- PC : import réel, dossier OPFS, dépôt --------------------------------------------------
  const pcContext = await browser.newContext();
  await stubNetwork(pcContext);
  const pcPage = await pcContext.newPage();

  const { report } = fixtureReport();
  await pcPage.goto('#/import');
  await pcPage.setInputFiles('input[type="file"]', FIXTURE);
  await expect(pcPage.getByRole('heading', { name: 'Import réussi' })).toBeVisible();

  await pcPage.goto('#/synchro');
  await chooseOpfsFolder(pcPage, 'boite-pc-vers-telephone');
  await unlockPassphrase(pcPage);
  await expect(pcPage.getByRole('button', { name: 'Synchroniser maintenant' })).toBeVisible();

  const deposited = await opfsFiles(pcPage, 'boite-pc-vers-telephone');
  const [depositName, depositText] = Object.entries(deposited)[0]!;

  // --- Téléphone : pas de File System Access (retiré AVANT tout chargement) --------------------
  const phoneContext = await browser.newContext();
  await stubNetwork(phoneContext);
  await phoneContext.addInitScript(() => {
    // @ts-expect-error -- suppression volontaire : simule l'absence de File System Access (Android)
    delete window.showDirectoryPicker;
  });
  const phonePage = await phoneContext.newPage();
  await phonePage.goto('#/synchro');
  await expect(phonePage.getByRole('heading', { level: 1, name: 'Synchronisation' })).toBeVisible();
  // Chemin PC absent : aucun bouton de sélecteur de dossier sur cet écran.
  await expect(
    phonePage.getByRole('button', { name: 'Choisir le dossier de synchronisation…' }),
  ).toHaveCount(0);
  await expect(phonePage.getByRole('heading', { name: 'Recevoir' })).toBeVisible();
  await expect(phonePage.getByRole('heading', { name: 'Envoyer' })).toBeVisible();

  await phonePage.setInputFiles('input[type="file"]', {
    name: depositName,
    mimeType: 'text/plain',
    buffer: Buffer.from(depositText, 'utf-8'),
  });
  // Phrase pas encore connue sur CET appareil : la feuille s'ouvre d'elle-même (`ingestOne`).
  await unlockPassphrase(phonePage);
  // Le même texte apparaît aussi dans un toast transitoire : on cible la liste des pairs, seule
  // persistante (un `getByText` non scopé serait ambigu entre les deux).
  await expect(phonePage.locator('.peers').getByText(/^Fusion : /)).toBeVisible();

  // --- La DONNÉE elle-même, pas seulement le rapport de fusion ----------------------------------
  await phonePage.goto('#/invest');
  await expect(
    phonePage.getByRole('list', { name: 'Positions' }).getByRole('listitem'),
  ).toHaveCount(report.positions.length);

  await pcContext.close();
  await phoneContext.close();
});

test('mauvaise phrase de synchronisation sur le téléphone : erreur nommée, rien de fusionné', async ({
  browser,
}) => {
  const context = await browser.newContext();
  await stubNetwork(context);
  await context.addInitScript(() => {
    // @ts-expect-error -- simule l'absence de File System Access (Android)
    delete window.showDirectoryPicker;
  });
  const page = await context.newPage();

  const envelope = await encryptMailboxEnvelope(
    EMPTY_PAYLOAD,
    'bonne-phrase',
    'peer-device',
    1,
    crypto.getRandomValues(new Uint8Array(16)),
    { params: FAST_KDF },
  );

  await page.goto('#/synchro');
  await page.setInputFiles('input[type="file"]', {
    name: mailboxFileName('peer-device', 1),
    mimeType: 'text/plain',
    buffer: Buffer.from(JSON.stringify(envelope), 'utf-8'),
  });
  await expect(page.getByLabel('Phrase de synchronisation')).toBeVisible();
  await page.getByLabel('Phrase de synchronisation').fill('mauvaise-phrase');
  await page.getByRole('button', { name: 'Déverrouiller' }).click();

  await expect(page.getByText('Phrase secrète incorrecte ou fichier altéré.')).toBeVisible();
  // Aucun pair listé : rien n'a été fusionné, le fichier reste illisible avec cette phrase.
  await expect(page.getByText("Aucun appareil pair vu pour l'instant.")).toBeVisible();

  await context.close();
});

/**
 * Web Share Target (`public/sw-share-target.js`) jusqu'à l'écran `#/synchro` : `share-target.spec.ts`
 * prouve déjà que le service worker intercepte le POST et range le fichier dans IndexedDB — ce test
 * va plus loin, jusqu'à la CONSOMMATION par l'écran (`shared-inbox.ts` → `AppState.ingestMailboxFile`).
 */
test.describe('Web Share Target jusqu’à la fusion', () => {
  test.use({ serviceWorkers: 'allow' });

  test('un dépôt partagé « à froid » est repris et fusionné à l’arrivée sur #/synchro', async ({
    page,
    context,
  }) => {
    await stubNetwork(context);
    await page.goto('');
    // Même attente que `share-target.spec.ts` : contrôlée par le SW avant de partager quoi que ce soit
    // (situation réelle d'un partage Android, l'app étant déjà installée).
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      const worker = registration.active;
      if (worker && worker.state !== 'activated') {
        await new Promise<void>((resolve) => {
          worker.addEventListener('statechange', () => {
            if (worker.state === 'activated') resolve();
          });
          setTimeout(resolve, 5000);
        });
      }
    });
    if (!(await page.evaluate(() => navigator.serviceWorker.controller !== null))) {
      await page.reload();
      await page.evaluate(() => navigator.serviceWorker.ready);
    }

    const envelope = await encryptMailboxEnvelope(
      EMPTY_PAYLOAD,
      PASSPHRASE,
      'peer-partage',
      1,
      crypto.getRandomValues(new Uint8Array(16)),
      { params: FAST_KDF },
    );
    const fileName = mailboxFileName('peer-partage', 1);
    const content = JSON.stringify(envelope);

    await page.evaluate(
      async ({ content, fileName }) => {
        const formData = new FormData();
        formData.set('file', new Blob([content], { type: 'text/plain' }), fileName);
        await fetch('/cout-revient-ch/share-target', {
          method: 'POST',
          body: formData,
          redirect: 'manual',
        });
      },
      { content, fileName },
    );

    // Le service worker répond par une redirection (voir `share-target.spec.ts`) ; en conditions
    // réelles, c'est le NAVIGATEUR (piloté par l'OS) qui la suit. Ici, on va directement à sa cible
    // — ce que ce test vérifie, c'est que l'écran consomme alors le fichier déposé par le SW.
    await page.goto('#/synchro');
    await expect(page.getByRole('heading', { level: 1, name: 'Synchronisation' })).toBeVisible();
    await unlockPassphrase(page);
    await expect(page.locator('.peers').getByText(/^Fusion : /)).toBeVisible();

    // Deuxième visite : plus rien à reprendre (le fichier a été consommé, pas seulement lu).
    await page.goto('#/more');
    await page.goto('#/synchro');
    await expect(page.getByText('peer-partage'.slice(0, 8))).toBeVisible();
  });
});
