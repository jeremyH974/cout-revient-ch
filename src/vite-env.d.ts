/// <reference types="svelte" />
/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/** Version de l'application, injectée au build depuis package.json. */
declare const __APP_VERSION__: string;
/** Sept premiers caractères du commit déployé (« dev » hors CI). */
declare const __BUILD_SHA__: string;
