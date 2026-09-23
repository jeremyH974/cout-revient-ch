/**
 * Web Share Target (P125, boîte aux lettres) : un `fetch` POST `multipart/form-data` déclenché
 * depuis une page contrôlée par le service worker — exactement ce qu'envoie la feuille de partage
 * Android vers l'action du manifeste, sans que Playwright puisse simuler cette feuille elle-même
 * (elle n'existe pas hors d'un vrai téléphone) — doit être intercepté par `public/sw-share-target.js`
 * (jamais par Workbox, voir le commentaire en tête de ce fichier), ranger le fichier dans la base
 * IndexedDB dédiée, et répondre par une redirection.
 *
 * Ce test lit IndexedDB directement (boîte noire, DB_NAME/STORE/KEY dupliqués ci-dessous) plutôt que
 * d'importer `src/lib/storage/shared-inbox.ts` : rien n'expose ce module sur `window` (aucun écran
 * ne l'utilise encore, l'écran de synchronisation vient dans la PR suivante), et ce n'est de toute
 * façon pas le but ici — `shared-inbox.test.ts` prouve déjà `takeSharedFile()` en isolation. Ce que
 * SEUL un test de bout en bout peut prouver, c'est que `sw-share-target.js`, une fois RÉELLEMENT
 * empaqueté par `vite-plugin-pwa`/Workbox, intercepte bien la requête avant Workbox — voir le rapport
 * de ce chantier pour la vérification faite en inspectant `dist/sw.js`.
 */
import { expect, test } from '@playwright/test';
import { stubNetwork } from './helpers/network';

test.use({ serviceWorkers: 'allow' });

const SHARE_TARGET_PATH = '/cout-revient-ch/share-target';
// Mêmes constantes que public/sw-share-target.js et src/lib/storage/shared-inbox.ts.
const DB_NAME = 'crch-shared-inbox';
const STORE = 'inbox';
const KEY = 'pending';

/**
 * Attend l'activation ET rend la page CONTRÔLÉE par le service worker — deux choses différentes.
 * `registration.active.state === 'activated'` ne suffit pas : le premier chargement qui installe le
 * worker n'est, par construction, jamais intercepté par lui (`clientsClaim` n'est pas activé côté
 * Workbox, à dessein — voir `vite.config.ts`) ; seule une navigation POSTÉRIEURE à l'activation
 * l'est. C'est exactement la situation réelle d'un partage Android : l'app est déjà installée, donc
 * son service worker est déjà actif AVANT que l'utilisateur partage quoi que ce soit.
 */
async function ensureControlledByServiceWorker(
  page: import('@playwright/test').Page,
): Promise<void> {
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
}

test('POST multipart/form-data vers l’action de partage : intercepté, rangé, redirigé', async ({
  page,
  context,
}) => {
  await stubNetwork(context);
  await page.goto('');
  await ensureControlledByServiceWorker(page);

  const content = JSON.stringify({ app: 'cout-revient-ch', kind: 'mailbox', version: 3, seq: 1 });
  const fileName = 'cout-revient-ch-sync-e2etest-000001.txt';

  const result = await page.evaluate(
    async ({ path, content, fileName }) => {
      const formData = new FormData();
      formData.set('file', new Blob([content], { type: 'text/plain' }), fileName);
      // `redirect: 'manual'` : la seule façon FIABLE, côté page, de constater qu'une redirection a
      // eu lieu. En mode par défaut (`'follow'`), la redirection ISSUE D'UN SERVICE WORKER est bien
      // suivie (constaté en inspectant le réseau pendant le développement de ce test : la requête
      // suivante sert bien `index.html` depuis le cache Workbox), mais `Response.redirected` reste à
      // `false` et `Response.url` pointe vers l'URL interne du cache plutôt que vers la cible de la
      // redirection — un artefact de la reconstruction de réponse par `createHandlerBoundToURL`
      // (workbox-precaching), pas un signal exploitable. `'manual'` évite cette ambiguïté : un statut
      // 3xx quelconque donne toujours `type: 'opaqueredirect'`, un 404/200 direct donnerait `'basic'`.
      const response = await fetch(path, { method: 'POST', body: formData, redirect: 'manual' });
      return { type: response.type, status: response.status };
    },
    { path: SHARE_TARGET_PATH, content, fileName },
  );

  expect(result.type).toBe('opaqueredirect');
  expect(result.status).toBe(0); // toujours 0 pour une réponse opaque — la seule valeur possible

  const stored = await page.evaluate(
    ({ dbName, store, key }) =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName);
        request.onsuccess = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(store)) {
            resolve(null);
            return;
          }
          const getRequest = db.transaction(store, 'readonly').objectStore(store).get(key);
          getRequest.onsuccess = () => resolve(getRequest.result ?? null);
          getRequest.onerror = () => reject(getRequest.error);
        };
        request.onerror = () => reject(request.error);
      }),
    { dbName: DB_NAME, store: STORE, key: KEY },
  );

  expect(stored).toMatchObject({ text: content, name: fileName, type: 'text/plain' });
});

test('un fichier partagé sans nom (type navigateur inconnu) est rangé avec name/type à null', async ({
  page,
  context,
}) => {
  await stubNetwork(context);
  await page.goto('');
  await ensureControlledByServiceWorker(page);

  const content = '{"minimal":true}';

  await page.evaluate(
    async ({ path, content }) => {
      const formData = new FormData();
      // Nom de fichier explicitement vide (jamais omis : un Blob sans nom se voit attribuer
      // « blob » par le navigateur, ce qui ne testerait pas le même chemin) — sw-share-target.js
      // doit ramener une chaîne vide à `null`, jamais la laisser telle quelle.
      formData.set('file', new Blob([content], { type: 'text/plain' }), '');
      await fetch(path, { method: 'POST', body: formData });
    },
    { path: SHARE_TARGET_PATH, content },
  );

  const stored = await page.evaluate(
    ({ dbName, store, key }) =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName);
        request.onsuccess = () => {
          const getRequest = request.result
            .transaction(store, 'readonly')
            .objectStore(store)
            .get(key);
          getRequest.onsuccess = () => resolve(getRequest.result ?? null);
          getRequest.onerror = () => reject(getRequest.error);
        };
        request.onerror = () => reject(request.error);
      }),
    { dbName: DB_NAME, store: STORE, key: KEY },
  );

  expect(stored).toMatchObject({ text: content, name: null });
});
