import { expect, test, type Page } from '@playwright/test';
import { openDemo } from './helpers/demo';
import { stubNetwork } from './helpers/network';

/**
 * **Un état DÉJÀ enregistré, de forme ancienne, démarre** — le trou par lequel un plantage est
 * passé en production le 23/09/2026.
 *
 * Toute la suite part d'un stockage neuf ou d'une sauvegarde restaurée : deux chemins qui passent
 * par `migrateState`, donc par `withDefaults` et `sanitizeState`. Le chemin réel d'un utilisateur
 * qui rouvre son application — un instantané IndexedDB écrit AVANT l'ajout d'une clé — n'était
 * joué nulle part. Il rendait l'instantané tel quel (corrigé par la décision n° 187), la liste des
 * trades lisait `ui.tradeFilter.query` sur une valeur absente, et l'écran plantait à l'ouverture.
 *
 * Le test ne fabrique pas un état à la main : il part d'un état RÉEL (la démonstration), lui retire
 * les conteneurs apparus depuis, et le réécrit. Rien à maintenir quand le schéma grandit — et la
 * liste ci-dessous documente d'elle-même ce qui est arrivé après.
 */

/** Écrit dans IndexedDB par `idb-state-store.ts` : base, magasin et clé. */
const STATE_DB = 'crch-state';
const STATE_STORE = 'state';
const STATE_KEY = 'v1';
/** Miroir `localStorage` (`local-storage.ts`) : c'est lui qui gagne à égalité de date. */
const MIRROR_KEY = 'crch:v1:state';

/**
 * Conteneurs ajoutés APRÈS la première version du schéma. Les retirer simule exactement un
 * instantané écrit avant eux. `ui` porte à lui seul une trentaine de réglages, dont `tradeFilter`.
 */
const AJOUTS_RECENTS = ['ui', 'journal', 'manualTrades', 'sync', 'lending', 'alerts'];

/**
 * Attend que l'instantané IndexedDB existe.
 *
 * `openDemo` rend la main dès que les prix s'affichent, mais l'enregistrement part 300 ms après la
 * DERNIÈRE mutation — et chaque cotation appliquée en est une. Lire le stockage juste après revient
 * à le lire avant qu'il n'existe (même piège que `waitForPersisted` dans `vault.spec.ts`).
 */
async function waitForSnapshot(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          ({ db, store, key }) =>
            new Promise<boolean>((resolve) => {
              const request = indexedDB.open(db);
              request.onsuccess = () => {
                const get = request.result
                  .transaction(store, 'readonly')
                  .objectStore(store)
                  .get(key);
                get.onsuccess = () => resolve(get.result !== undefined);
                get.onerror = () => resolve(false);
              };
              request.onerror = () => resolve(false);
            }),
          { db: STATE_DB, store: STATE_STORE, key: STATE_KEY },
        ),
      { timeout: 15_000 },
    )
    .toBe(true);
}

/**
 * Retire ces conteneurs de l'instantané IndexedDB, efface le miroir, et rend la main : au prochain
 * chargement, l'application n'a plus que la voie IndexedDB, et l'instantané est « d'avant ».
 */
async function vieillirEtatEnregistre(page: Page): Promise<string[]> {
  return page.evaluate(
    async ({ db, store, key, mirror, retraits }) => {
      const open = (): Promise<IDBDatabase> =>
        new Promise((resolve, reject) => {
          const request = indexedDB.open(db);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(new Error('IndexedDB indisponible'));
        });
      const connection = await open();
      const lu = await new Promise<Record<string, unknown> | undefined>((resolve) => {
        const get = connection.transaction(store, 'readonly').objectStore(store).get(key);
        get.onsuccess = () => resolve(get.result as Record<string, unknown> | undefined);
        get.onerror = () => resolve(undefined);
      });
      if (!lu || typeof lu['state'] !== 'object' || lu['state'] === null)
        throw new Error("aucun instantané à vieillir : l'application n'a rien enregistré");
      const etat = lu['state'] as Record<string, unknown>;
      const retires = retraits.filter((clef) => clef in etat);
      for (const clef of retires) delete etat[clef];
      await new Promise<void>((resolve, reject) => {
        const tx = connection.transaction(store, 'readwrite');
        tx.objectStore(store).put({ ...lu, state: etat }, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(new Error('écriture refusée'));
      });
      connection.close();
      // Sans miroir, la voie IndexedDB est la seule lue — c'est celle qu'on veut éprouver.
      localStorage.removeItem(mirror);
      localStorage.removeItem(`${mirror}.savedAt`);
      return retires;
    },
    {
      db: STATE_DB,
      store: STATE_STORE,
      key: STATE_KEY,
      mirror: MIRROR_KEY,
      retraits: AJOUTS_RECENTS,
    },
  );
}

test.beforeEach(async ({ context }) => {
  await stubNetwork(context);
});

test('un état enregistré avant l’ajout de clés démarre, et reçoit leurs valeurs par défaut', async ({
  page,
}) => {
  const plantages: string[] = [];
  page.on('pageerror', (error) => plantages.push(error.message));

  await openDemo(page);
  await waitForSnapshot(page);
  const retires = await vieillirEtatEnregistre(page);
  expect(retires, 'le vieillissement doit avoir retiré au moins les réglages').toContain('ui');

  await page.reload();

  // 1. L'application démarre : ni écran de données illisibles, ni page blanche.
  await expect(page.getByRole('navigation', { name: 'Navigation principale' })).toBeVisible();
  await expect(page.getByText('Données illisibles.')).toHaveCount(0);

  // 2. L'écran qui plantait s'ouvre, et son champ de recherche existe : la valeur par défaut de
  //    `ui.tradeFilter` a bien été posée au chargement.
  await page.goto('#/trading/trades');
  await expect(page.getByRole('searchbox', { name: /Rechercher/ })).toBeVisible();

  // 3. Les données, elles, ont survécu au vieillissement : on n'a pas rechargé une app vide.
  await page.goto('#/invest');
  await expect(page.getByRole('list', { name: 'Positions' })).toBeVisible();

  expect(plantages, 'aucune exception non rattrapée pendant le parcours').toEqual([]);
});
