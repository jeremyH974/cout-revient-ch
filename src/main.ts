import { mount } from 'svelte';
import { registerSW } from 'virtual:pwa-register';
import App from './App.svelte';
import './app.css';
import { installGlobalErrorCapture } from './lib/support/errors';
import { installNetworkGuard, setLocalOnly } from './lib/net/local-only';
import { installServiceWorkerUrlPolicy } from './lib/support/trusted-types';
import { app } from './state/app.svelte';
import { update } from './state/ui.svelte';

const target = document.getElementById('app');
if (!target) throw new Error('Élément #app introuvable');

// Les erreurs non interceptées alimentent le diagnostic copiable (jamais envoyées nulle part).
installGlobalErrorCapture();

/*
 * Le verrou de sortie réseau, posé AVANT tout le reste.
 *
 * L'emballage de `fetch` et `WebSocket` est installé dans les deux variantes, mais il n'est
 * *fermé* que dans la variante personnelle. La raison de l'installer quand même côté public : un
 * module qui capture `fetch` au chargement en garderait la version d'origine, et le verrou posé
 * plus tard ne le concernerait plus. On emballe d'abord, on décide ensuite.
 */
installNetworkGuard();
setLocalOnly(__PRIVATE_BUILD__);

await app.init();

// Crochet de développement (absent du build) : pilotage depuis les outils de test.
if (import.meta.env.DEV) Object.assign(window, { __crch: app });

/**
 * Point d'injection RÉSERVÉ AUX TESTS DE BOUT EN BOUT (Playwright) — contrairement à `__crch`
 * ci-dessus, TOUJOURS présent, y compris dans le build de PRODUCTION que `npm run e2e` sert via
 * `vite preview` (`import.meta.env.DEV` y est déjà faux à ce moment-là). Une seule responsabilité :
 * accepter un `FileSystemDirectoryHandle` déjà obtenu par la PAGE ELLE-MÊME — la racine (ou un
 * sous-dossier) d'OPFS, `navigator.storage.getDirectory()`, dans un test « PC » de la boîte aux
 * lettres (P125), faute de sélecteur natif pilotable par l'automatisation — à la place de
 * `showDirectoryPicker()`. Aucun risque au-delà de l'appel normal : obtenir un tel handle exige
 * déjà d'être un script de CETTE origine, capable d'appeler lui-même `getDirectory()`.
 */
Object.assign(window, {
  __crchSetMailboxFolderForTests: (handle: FileSystemDirectoryHandle) =>
    app.chooseMailboxFolder(handle),
});

/*
 * Pas de service worker dans la variante personnelle. Deux raisons, et la seconde suffit :
 *
 * - il n'a rien à mettre en cache d'une application déjà servie depuis le disque de la machine ;
 * - son `fetch` s'exécute dans une AUTRE portée que la page, donc **hors du verrou** posé
 *   ci-dessus. Il interroge CoinGecko pour vérifier les alertes application fermée : le garder
 *   reviendrait à laisser une porte de sortie que le mode local prétend avoir fermée.
 */
if (!__PRIVATE_BUILD__) {
  // Doit précéder `registerSW` : sous Trusted Types, `register()` refuse une chaîne, et l'échec
  // serait avalé par `onRegisterError` — plus de service worker, sans un mot. Voir DECISIONS n° 75.
  installServiceWorkerUrlPolicy(`${import.meta.env.BASE_URL}sw.js`);

  const updateSW = registerSW({
    immediate: false,
    onNeedRefresh() {
      update.arm(() => void updateSW(true));
    },
    onRegisteredSW(_url, registration) {
      // Les PWA restent ouvertes longtemps : vérifier une nouvelle version toutes les heures.
      if (registration) setInterval(() => void registration.update(), 60 * 60_000);
    },
  });
}

export default mount(App, { target });
