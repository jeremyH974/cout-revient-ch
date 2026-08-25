/**
 * Vérification opportuniste des alertes APP FERMÉE (Periodic Background Sync, décision n° 38),
 * chargée dans le service worker généré (vite.config.ts → workbox.importScripts, après
 * sw-alerts-core.js). Chromium uniquement, PWA installée, fréquence décidée par le navigateur
 * (rarement plus de quelques fois par jour) : un bonus best-effort au-dessus de la veille
 * onglet-ouvert — jamais une garantie, et l'interface le dit.
 *
 * Flux : l'app écrit un instantané (seuils EUR précalculés + états d'armement) dans le
 * meta-store IndexedDB (src/lib/notify/background-sync.ts) ; ici on lit l'instantané, on
 * demande les prix EUR à CoinGecko, on compare en décimal exact (sw-alerts-core.js), on
 * notifie, et on dépose les déclenchements que l'app journalise à sa prochaine ouverture.
 * Les seuils ne quittent jamais l'appareil : la requête ne porte que des identifiants d'actifs,
 * comme la veille classique.
 */
(function () {
  'use strict';

  // Mêmes constantes que src/lib/storage/idb-state-store.ts et notify/background-sync.ts :
  // les deux côtés doivent rester alignés (base, version, stores, clés).
  var STATE_DB = 'crch-state';
  var META_STORE = 'meta';
  var STATE_STORE = 'state';
  var SNAPSHOT_KEY = 'alerts.watch-snapshot';
  var FIRES_KEY = 'alerts.sw-fires';
  var MAX_PENDING_FIRES = 50;
  var FETCH_TIMEOUT_MS = 15000;

  function idbOpen() {
    return new Promise(function (resolve, reject) {
      var request = indexedDB.open(STATE_DB, 1);
      // Même création de stores que l'app : si le service worker ouvre la base en premier,
      // elle doit être exactement celle que l'app attend.
      request.onupgradeneeded = function () {
        var db = request.result;
        if (!db.objectStoreNames.contains(STATE_STORE)) db.createObjectStore(STATE_STORE);
        if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE);
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

  function metaGet(key) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(META_STORE, 'readonly');
        var request = tx.objectStore(META_STORE).get(key);
        var value;
        request.onsuccess = function () {
          value = request.result;
        };
        tx.oncomplete = function () {
          db.close();
          resolve(value);
        };
        tx.onerror = function () {
          db.close();
          reject(tx.error);
        };
      });
    });
  }

  function metaSet(key, value) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(META_STORE, 'readwrite');
        tx.objectStore(META_STORE).put(value, key);
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

  /** Miroir de numberToDecimal (src/lib/pricing/types.ts) : nombre JSON → chaîne décimale. */
  function numberToDecimal(value) {
    if (typeof value === 'string') return /^-?\d+(\.\d+)?$/.test(value) ? value : null;
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    var text = String(value);
    if (/e/i.test(text)) text = value.toFixed(20);
    if (text.indexOf('.') !== -1) text = text.replace(/0+$/, '').replace(/\.$/, '');
    return text;
  }

  /** Formatage AFFICHAGE de la notification (fr-FR, euros) — jamais utilisé pour comparer. */
  function fmtEur(text) {
    var value = Number(text);
    if (!Number.isFinite(value)) return text + ' €';
    try {
      return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(value);
    } catch {
      return text + ' €';
    }
  }

  function checkAlerts() {
    return self.clients
      .matchAll({ type: 'window' })
      .then(function (clients) {
        for (var i = 0; i < clients.length; i++) {
          // L'app est visible : c'est elle qui évalue (états plus riches, ré-armement compris).
          if (clients[i].visibilityState === 'visible') return null;
        }
        return metaGet(SNAPSHOT_KEY);
      })
      .then(function (snapshot) {
        if (!snapshot || snapshot.v !== 1 || !Array.isArray(snapshot.rules)) return;
        var armed = snapshot.rules.filter(function (r) {
          return r && r.armed && typeof r.coingeckoId === 'string' && r.coingeckoId !== '';
        });
        if (armed.length === 0) return;
        var ids = [];
        for (var i = 0; i < armed.length; i++) {
          if (ids.indexOf(armed[i].coingeckoId) === -1) ids.push(armed[i].coingeckoId);
        }
        var headers = { accept: 'application/json' };
        if (typeof snapshot.coingeckoDemoKey === 'string' && snapshot.coingeckoDemoKey !== '') {
          headers['x-cg-demo-api-key'] = snapshot.coingeckoDemoKey;
        }
        var controller = new AbortController();
        var timer = setTimeout(function () {
          controller.abort();
        }, FETCH_TIMEOUT_MS);
        var url =
          'https://api.coingecko.com/api/v3/simple/price?ids=' +
          encodeURIComponent(ids.join(',')) +
          '&vs_currencies=eur&precision=full';
        return fetch(url, { headers: headers, signal: controller.signal })
          .then(function (response) {
            clearTimeout(timer);
            if (!response.ok) return;
            return response.json().then(function (body) {
              var prices = {};
              for (var i = 0; i < ids.length; i++) {
                var entry = body[ids[i]];
                var text = numberToDecimal(entry && entry.eur);
                if (text !== null && text.charAt(0) !== '-') prices[ids[i]] = text;
              }
              var result = self.AlertSyncCore.decideFires(snapshot, prices, Date.now());
              if (result.fires.length === 0) return;
              return metaGet(FIRES_KEY)
                .then(function (pending) {
                  var list = Array.isArray(pending) ? pending.concat(result.fires) : result.fires;
                  return metaSet(FIRES_KEY, list.slice(-MAX_PENDING_FIRES));
                })
                .then(function () {
                  return metaSet(
                    SNAPSHOT_KEY,
                    Object.assign({}, snapshot, { rules: result.rules }),
                  );
                })
                .then(function () {
                  var shows = result.fires.map(function (fire) {
                    var sign = fire.direction === 'below' ? '≤' : '≥';
                    var body =
                      fmtEur(fire.priceEur) +
                      ' ' +
                      sign +
                      ' seuil ' +
                      fmtEur(fire.thresholdEur) +
                      (fire.pruEur ? ' · PRU ' + fmtEur(fire.pruEur) : '');
                    return self.registration.showNotification(
                      'Alerte ' + fire.asset.toUpperCase(),
                      {
                        body: body,
                        tag: fire.ruleId,
                        icon: snapshot.icon,
                        data: { url: snapshot.notifUrl },
                      },
                    );
                  });
                  return Promise.all(shows);
                });
            });
          })
          .catch(function () {
            clearTimeout(timer);
            // Hors ligne ou API muette : silence — la prochaine période retentera.
          });
      });
  }

  self.addEventListener('periodicsync', function (event) {
    if (event.tag === 'crch-alerts') {
      event.waitUntil(
        checkAlerts().catch(function () {
          /* best effort : jamais d'échec bruyant en arrière-plan */
        }),
      );
    }
  });
})();
