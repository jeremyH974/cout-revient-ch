import { mount } from 'svelte';
import { registerSW } from 'virtual:pwa-register';
import App from './App.svelte';
import './app.css';
import { installGlobalErrorCapture } from './lib/support/errors';
import { installServiceWorkerUrlPolicy } from './lib/support/trusted-types';
import { app } from './state/app.svelte';
import { update } from './state/ui.svelte';

const target = document.getElementById('app');
if (!target) throw new Error('Élément #app introuvable');

// Les erreurs non interceptées alimentent le diagnostic copiable (jamais envoyées nulle part).
installGlobalErrorCapture();
await app.init();

// Crochet de développement (absent du build) : pilotage depuis les outils de test.
if (import.meta.env.DEV) Object.assign(window, { __crch: app });

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

export default mount(App, { target });
