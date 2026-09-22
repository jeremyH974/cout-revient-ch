/**
 * Chargé dans le service worker généré (vite.config.ts → workbox.importScripts, après les trois
 * autres scripts) : reçoit un fichier partagé depuis la feuille de partage Android (Web Share
 * Target, `share_target` du manifeste), y compris quand l'app n'était pas encore ouverte (l'OS la
 * lance sur l'action du manifeste : « partage à froid »).
 *
 * Motif recommandé par developer.chrome.com/docs/capabilities/web-apis/web-share-target (vérifié le
 * 22/09/2026) : intercepter le POST par un écouteur `fetch`, lire `event.request.formData()`, puis
 * répondre par une redirection 303 (jamais 200 : un rechargement de la page cible ne doit pas
 * soumettre le partage une seconde fois).
 *
 * **Pourquoi cet écouteur, ajouté à `importScripts` en dernier, n'entre jamais en conflit avec
 * Workbox.** Vérifié le 22/09/2026 en inspectant `dist/sw.js` généré par ce projet
 * (vite-plugin-pwa 1.3.0 / workbox-build 7.4.1) : le fichier commence par charger le runtime Workbox
 * puis exécute, DANS L'ORDRE, `importScripts("sw-notifications.js","sw-alerts-core.js",
 * "sw-alert-sync.js","sw-share-target.js")` — donc CET écouteur `fetch` (posé de façon SYNCHRONE au
 * chargement du script, condition documentée par Workbox pour que Firefox le voie) — AVANT
 * `precacheAndRoute(...)`, qui est le point où workbox-routing pose SON PROPRE écouteur `fetch`
 * (`Router.addFetchListener`, appelé au premier `registerRoute`). Les deux écouteurs sont donc actifs
 * pour chaque requête, mais un seul appelle jamais `respondWith()` pour une requête donnée :
 * - Workbox ne matche que des routes `GET` par défaut (`workbox-routing/utils/constants.ts`,
 *   `defaultMethod = 'GET'` — `NavigationRoute`, utilisée ici pour le repli SPA, ne surcharge pas ce
 *   défaut) ; le partage, lui, est un `POST` — la spec Web Share Target (w3c.github.io/web-share-target)
 *   décrit l'envoi comme une NAVIGATION (« Navigate browsing context to request »), donc
 *   `event.request.mode === 'navigate'` ET `method === 'POST'` : `NavigationRoute` ignore la requête
 *   (mauvaise méthode) et ne répond pas, laissant `respondWith` à cet écouteur-ci.
 * - Cet écouteur, symétriquement, ne répond QUE si `method === 'POST'` et que le chemin est
 *   exactement celui du manifeste : toute autre requête (assets, navigation normale) traverse sans
 *   qu'il y touche, et Workbox répond comme si ce fichier n'existait pas.
 *
 * Le fichier reçu est rangé dans une base IndexedDB DÉDIÉE (jamais `crch-state`) le temps que la
 * page s'ouvre — `src/lib/storage/shared-inbox.ts` le lit puis l'efface. Voir
 * `docs/backup-format.md`, section « Enveloppe v3 de la boîte aux lettres ».
 */
(function () {
  'use strict';

  // Sous la base GitHub Pages (`BASE` de vite.config.ts) : à tenir aligné avec `share_target.action`
  // du manifeste (même fichier) si `BASE` change un jour.
  var SHARE_TARGET_PATH = '/cout-revient-ch/share-target';
  var FILE_FIELD = 'file';
  // Écran de synchronisation (P125, session 2) : `src/lib/storage/shared-inbox.ts` y restitue le
  // fichier reçu (`takeSharedFile()`, appelé au montage de `routes/Synchro.svelte`).
  var REDIRECT_HASH = '#/synchro';

  // Mêmes constantes que src/lib/storage/shared-inbox.ts : les deux côtés doivent rester alignés
  // (même patron que sw-alert-sync.js / idb-state-store.ts).
  var DB_NAME = 'crch-shared-inbox';
  var DB_VERSION = 1;
  var STORE = 'inbox';
  var KEY = 'pending';

  function idbOpen() {
    return new Promise(function (resolve, reject) {
      var request = indexedDB.open(DB_NAME, DB_VERSION);
      // Si la page ouvre cette base la première (aucun partage encore reçu), elle crée déjà ce
      // magasin (shared-inbox.ts) : les deux côtés doivent créer EXACTEMENT le même magasin.
      request.onupgradeneeded = function () {
        var db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      request.onsuccess = function () {
        resolve(request.result);
      };
      request.onerror = function () {
        reject(request.error || new Error('IndexedDB indisponible'));
      };
      request.onblocked = function () {
        reject(new Error('IndexedDB bloquée'));
      };
    });
  }

  function storeSharedFile(entry) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        // Emplacement UNIQUE (« pending ») : un second partage avant que le premier soit consommé
        // remplace le premier plutôt que de constituer une file — suffisant en pratique (l'écran
        // de synchronisation consomme le fichier au montage, `routes/Synchro.svelte`) ; une vraie
        // file resterait à faire si le besoin de plusieurs partages non lus à la fois se confirme.
        tx.objectStore(STORE).put(entry, KEY);
        tx.oncomplete = function () {
          db.close();
          resolve();
        };
        tx.onerror = function () {
          db.close();
          reject(tx.error);
        };
      });
    });
  }

  function handleShare(event) {
    return event.request
      .formData()
      .then(function (formData) {
        var file = formData.get(FILE_FIELD);
        if (!file || typeof file.text !== 'function') return null;
        return file.text().then(function (text) {
          return {
            text: text,
            receivedAt: new Date().toISOString(),
            name: file.name || null,
            type: file.type || null,
          };
        });
      })
      .then(function (entry) {
        return entry ? storeSharedFile(entry) : null;
      })
      .catch(function () {
        // Best effort, comme sw-alert-sync.js : un partage qu'on ne peut pas ranger ne doit jamais
        // empêcher de répondre — l'utilisateur reverrait sinon un POST brut, sans app autour.
      })
      .then(function () {
        return Response.redirect(self.registration.scope + REDIRECT_HASH, 303);
      });
  }

  self.addEventListener('fetch', function (event) {
    var url = new URL(event.request.url);
    if (event.request.method === 'POST' && url.pathname === SHARE_TARGET_PATH) {
      event.respondWith(handleShare(event));
    }
  });
})();
