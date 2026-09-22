import { fileURLToPath, URL } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig, type Plugin } from 'vitest/config';
import pkg from './package.json' with { type: 'json' };
// Extension explicite : le chargeur de configuration natif de Vite, futur défaut, l'exige.
import { buildCsp } from './src/lib/support/csp.ts';

/** Chemin de publication sur GitHub Pages (dépôt « cout-revient-ch »). */
const BASE = '/cout-revient-ch/';

/**
 * Le mode « privé » : la variante personnelle, servie depuis cette machine.
 *
 * Trois choses le distinguent du site public, et une seule est cosmétique.
 *
 * 1. **Une origine à elle.** Le site public vit sous `/cout-revient-ch/` sur github.io ; la
 *    variante privée vit à la racine de `http://crch.localhost:7331`. Ce n'est pas un détail de
 *    confort : `localhost:5173` est le port par défaut de Vite, donc une origine **partagée** avec
 *    tout autre projet lancé sur cette machine — et le stockage d'un navigateur est cloisonné par
 *    origine, pas par projet. Un autre chantier sur 5173 lirait `crch-state`. Le suffixe
 *    `.localhost` est résolu en boucle locale par le navigateur lui-même (RFC 6761), sans toucher
 *    au fichier `hosts`, et reste un contexte sécurisé — donc `crypto.subtle` fonctionne.
 * 2. **Aucune sortie réseau par défaut** (`installNetworkGuard` dans `main.ts`).
 * 3. **Pas de service worker** : il n'a rien à mettre en cache d'une application servie depuis le
 *    disque local, et son propre `fetch` échappe au verrou de la page.
 */
const PRIVATE_HOST = 'crch.localhost';
const PRIVATE_PORT = 7331;

/**
 * Content-Security-Policy injectée en <meta> au build uniquement (GitHub Pages ne permet pas
 * d'en-têtes HTTP). En dev, Vite a besoin du websocket HMR et de styles inline : pas de CSP.
 *
 * La liste des origines autorisées vit dans `src/lib/support/csp.ts`, où `csp.test.ts` la croise
 * avec les origines réellement écrites dans le code : une origine contactée sans être déclarée
 * casse la CI, au lieu d'échouer en silence chez l'utilisateur.
 */
const CSP = buildCsp();

function cspMetaOnBuild(): Plugin {
  return {
    name: 'csp-meta-on-build',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
      );
    },
  };
}

/**
 * jsPDF importe dynamiquement canvg, html2canvas et dompurify (doc.html(), SVG) : inutilisés par
 * l'export PDF (texte + tableaux). Sans ce stub, ~350 kB de chunks morts seraient précachés.
 */
function stubJspdfOptionalDeps(): Plugin {
  const stubbed = new Set(['canvg', 'html2canvas', 'dompurify']);
  return {
    name: 'stub-jspdf-optional-deps',
    apply: 'build',
    enforce: 'pre', // avant le résolveur de Vite, sinon node_modules gagne

    resolveId(id) {
      return stubbed.has(id) ? `\0stub:${id}` : null;
    },
    load(id) {
      return id.startsWith('\0stub:') ? 'export default undefined;' : null;
    },
  };
}

export default defineConfig(({ mode }) => {
  const isPrivate = mode === 'prive';
  return {
    base: isPrivate ? '/' : BASE,
    /*
     * Cache de pré-bundling HORS de `node_modules`, et UN PAR PROCESSUS dans le bac à sable de
     * Stryker (décisions n° 147 et 153).
     *
     * Stryker relie `node_modules` à son bac à sable au lieu de le copier ; le cache de Vite y étant
     * logé par défaut, deux processus écrivaient le même dossier et Windows refusait le renommage
     * final — `EPERM: operation not permitted, rename …/deps___vitest___temp_… -> …/deps___vitest__`.
     * Une exécution sur deux échouait, sur une erreur qui n'accusait ni le code ni les tests.
     *
     * Le sortir de `node_modules` a réglé la collision ENTRE exécutions, pas celle qui se joue au
     * SEIN d'une exécution : un seul bac à sable, mais plusieurs processus de test qui y démarrent
     * ensemble et pré-bundlent tous dans le même `.vite` vide. L'erreur est revenue deux fois de
     * suite le 15/09/2026, et un rapport périmé se lit alors comme un relevé sans progrès.
     * Chaque processus du bac à sable a donc désormais son propre sous-dossier ; hors bac à sable,
     * rien ne change et le cache reste partagé d'une commande à l'autre.
     */
    cacheDir: process.cwd().includes('.stryker-tmp') ? `.vite/${process.pid}` : '.vite',
    preview: {
      port: Number(process.env['PORT']) || (isPrivate ? PRIVATE_PORT : 4173),
      strictPort: false,
      ...(isPrivate ? { allowedHosts: [PRIVATE_HOST] } : {}),
    },
    server: {
      // Port assigné par l'outil de lancement (variable PORT), 5173 sinon — 7331 en mode privé,
      // pour que l'origine ne soit JAMAIS celle que partagent tous les projets Vite de la machine.
      port: Number(process.env['PORT']) || (isPrivate ? PRIVATE_PORT : 5173),
      strictPort: false,
      // `crch.localhost` n'est pas dans la liste blanche par défaut de Vite : sans cela, le serveur
      // répond « Blocked request » et l'origine dédiée ne sert à rien.
      ...(isPrivate ? { allowedHosts: [PRIVATE_HOST] } : {}),
    },
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      // Commit déployé (GitHub Actions), « dev » en local : affiché dans le diagnostic copiable.
      __BUILD_SHA__: JSON.stringify((process.env['GITHUB_SHA'] ?? 'dev').slice(0, 7)),
      /** Variante personnelle locale : sortie réseau coupée par défaut, pas de service worker. */
      __PRIVATE_BUILD__: JSON.stringify(isPrivate),
    },
    resolve: {
      alias: { $lib: fileURLToPath(new URL('./src/lib', import.meta.url)) },
    },
    plugins: [
      svelte(),
      cspMetaOnBuild(),
      stubJspdfOptionalDeps(),
      VitePWA({
        /*
         * Aucun service worker dans la variante personnelle. Le greffon reste chargé — il
         * fournit le module virtuel `virtual:pwa-register` qu'importe `main.ts` — mais ne
         * produit plus rien : ni `sw.js`, ni les 1,8 Mio de précache d'une application déjà
         * servie depuis le disque de la machine.
         *
         * La raison de fond n'est pas le poids. Le `fetch` d'un service worker s'exécute dans
         * une AUTRE portée que la page, donc **hors du verrou de sortie réseau** ; celui-ci
         * interroge CoinGecko pour vérifier les alertes application fermée. Le laisser actif,
         * ce serait garder une porte de sortie que le mode local prétend avoir fermée.
         */
        disable: isPrivate,
        registerType: 'prompt',
        injectRegister: null,
        includeAssets: ['favicon.svg', 'apple-touch-icon-180x180.png', 'og-image.png'],
        manifest: {
          name: 'Coût de revient CH',
          short_name: 'Coût CH',
          description:
            'PRU et plus/moins-values par crypto à partir de votre export Coinhouse, calculés dans votre navigateur.',
          lang: 'fr',
          start_url: BASE,
          scope: BASE,
          display: 'standalone',
          background_color: '#0f1115',
          theme_color: '#0f1115',
          categories: ['finance', 'productivity'],
          icons: [
            { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
            { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
            {
              src: 'maskable-icon-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
          /**
           * Boîte aux lettres chiffrée (P125) : reçoit un fichier partagé depuis Drive, Quick
           * Share ou tout autre expéditeur Android. `enctype: multipart/form-data` est requis dès
           * qu'un champ fichier existe (developer.chrome.com/docs/capabilities/web-apis/web-share-target,
           * vérifié le 22/09/2026). `accept` liste MIME **et** extension pour chaque type : les
           * fichiers de la boîte aux lettres sont en `.txt` (`navigator.share()` refuse les
           * `.json` côté émission — MDN, `Navigator.share()`, vérifié le 22/09/2026), mais un
           * expéditeur peut annoncer `application/json` selon comment l'OS a sniffé le fichier ;
           * mieux vaut accepter les deux que perdre un partage sur un type trop strict. Traité par
           * `public/sw-share-target.js` (voir ce fichier pour l'interaction avec Workbox) ; absent
           * de la variante privée, qui n'a ni manifeste ni service worker (`disable` ci-dessus).
           */
          share_target: {
            action: `${BASE}share-target`,
            method: 'POST',
            enctype: 'multipart/form-data',
            params: {
              files: [
                { name: 'file', accept: ['text/plain', '.txt', 'application/json', '.json'] },
              ],
            },
          },
        },
        workbox: {
          // Seuls les assets de l'app sont mis en cache ; jamais les données ni les API de prix.
          globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
          /**
           * Les logos de cryptos sont EXCLUS du précache. La table des prix couvre désormais des
           * centaines d'actifs : tout précacher imposerait plusieurs mégaoctets à chaque
           * installation, pour des logos que personne ne détient tous. Ils passent en cache
           * d'exécution ci-dessous — un utilisateur télécharge les logos de SES actifs, une fois.
           * Contrepartie assumée : hors ligne, un actif jamais affiché montre ses initiales, ce que
           * `CoinBadge` sait déjà faire.
           */
          globIgnores: ['**/icons/*.svg'],
          navigateFallback: `${BASE}index.html`,
          runtimeCaching: [
            {
              // Même origine, donc rien de nouveau ne sort de l'appareil : c'est un cache, pas une
              // requête tierce. `CacheFirst` parce qu'un logo ne change jamais pour un ticker donné.
              urlPattern: ({ url }: { url: URL }) =>
                url.origin === self.location.origin && url.pathname.includes('/icons/'),
              handler: 'CacheFirst',
              options: {
                cacheName: 'crypto-icons',
                expiration: { maxEntries: 600, maxAgeSeconds: 60 * 60 * 24 * 365 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
          ],
          // Clic sur une notification d'alerte (sw-notifications.js) + vérification opportuniste
          // des alertes app fermée : noyau pur (sw-alerts-core.js, testé via node:vm) puis
          // handler Periodic Background Sync (sw-alert-sync.js) — l'ordre compte. Ajouté en
          // dernier : réception Web Share Target (sw-share-target.js, boîte aux lettres P125) —
          // son écouteur `fetch` doit être posé avant que `precacheAndRoute` (plus bas) pose celui
          // de Workbox, voir le commentaire en tête de ce fichier.
          importScripts: [
            'sw-notifications.js',
            'sw-alerts-core.js',
            'sw-alert-sync.js',
            'sw-share-target.js',
          ],
        },
      }),
    ],
    test: {
      include: ['src/**/*.test.ts', 'tests/**/*.test.ts', 'mcp/**/*.test.ts'],
      environment: 'node',
      /*
       * 15 s au lieu des 5 s par défaut. Mesuré le 01/09/2026 : `mapping.property.test.ts` tourne en
       * 2,25 s sans couverture, mais l'instrumentation du périmètre élargi (voir ci-dessous) l'a fait
       * dépasser les 5 s de façon **intermittente**. Une CI qui échoue au hasard finit ignorée — c'est
       * le défaut que les décisions n° 72 à 74 viennent de corriger ailleurs, et il n'y a aucune
       * raison de l'introduire ici.
       */
      testTimeout: 15_000,
      coverage: {
        provider: 'v8',
        /*
         * Le périmètre de mesure, et ce qu'il ne peut pas atteindre (décision n° 78).
         *
         * Il ne valait que `src/lib/**` : 20 844 lignes échappaient à tout seuil, et l'écart s'était
         * creusé de 3 367 lignes en 49 commits sans que rien ne le dise.
         *
         * Ce qui entre ici est ce qui est **réellement atteignable** depuis Vitest : les `.ts` et les
         * modules runes `.svelte.ts`. Restent dehors, faute de pouvoir être exécutés dans un
         * environnement `node` sans test de composant : les `.svelte` de `src/components`, et tout
         * `src/routes` — 9 484 lignes qui ne contiennent aucun `.ts`. Les inclure afficherait 0 % à
         * perpétuité, ce qui ne mesure rien et fait croire le contraire.
         */
        include: ['src/lib/**/*.ts', 'src/state/**/*.ts', 'src/components/**/*.ts'],
        exclude: ['src/**/*.test.ts', 'src/**/*.d.ts'],
        reporter: ['text', 'html'],
        /*
         * Seuils bloquants (CI : `npm run test -- --coverage`).
         *
         * Le seuil de fonctions passe de 78 à 75 : c'est le prix **mesuré** de l'élargissement
         * (77,81 % constatés), pas un relâchement de complaisance — les trois autres métriques
         * tiennent sans être touchées. `src/state/**` reçoit un plancher non nul qui sert de
         * **cliquet** : le chiffre apparaît à chaque exécution et ne peut plus redescendre.
         *
         * Deux comportements de Vitest, constatés le 01/09/2026 et non supposés :
         *
         * 1. **Un seuil par glob n'exclut pas ses fichiers du calcul global** — le global reste
         *    calculé sur tout le périmètre. C'est pourquoi le seuil de fonctions doit descendre :
         *    aucun glob ne peut « sortir » `src/state` de la moyenne.
         * 2. **Deux globs qui se recouvrent font exploser la mémoire** : ajouter `src/lib/**` à côté
         *    de `src/lib/domain/**` a fait échouer la suite en `out of memory`, même avec 8 Go de
         *    tas. D'où l'absence d'un seuil propre à `src/lib/**` : la garantie du moteur repose sur
         *    le glob du domaine, qui reste à 90 %.
         */
        thresholds: {
          lines: 80,
          statements: 80,
          functions: 75,
          branches: 65,
          'src/lib/domain/**/*.ts': { lines: 90, statements: 90, functions: 88, branches: 75 },
          // Resserré de 95/90 aux valeurs mesurées le 13/09/2026 (décision n° 149) : 98,93 % de
          // lignes et 98,27 % de branches, pour 100 % de lignes et de fonctions. Le dossier est
          // aussi le seul que Stryker tient au-dessus de 96 % — la couverture y est un plancher,
          // la mutation le vrai plafond.
          'src/lib/derive/**/*.ts': { lines: 98, statements: 98, functions: 100, branches: 98 },
          /*
           * Relevé de 1 à 2 le 01/09/2026 (`ui.svelte.ts` testé, décision n° 88), puis resserré sur
           * les valeurs MESURÉES le 13/09/2026 (décision n° 147) : un cliquet qu'on ne resserre
           * jamais est une décoration. Le plancher reste dérisoire et ne prétend rien mesurer — il
           * empêche seulement d'ajouter du code non testé dans `src/state` sans que rien ne le dise.
           *
           * Il ne montera pas beaucoup plus haut par des tests : `app.svelte.ts` est une classe à
           * runes couplée au navigateur. La voie qui marche est l'EXTRACTION vers `src/lib/derive`
           * (décision n° 94), où le seuil est de 95 % et où Stryker passe.
           *
           * `lines`/`statements` REDESCENDUS (2,6/2,4 → 2,5/2,3) à la fusion multi-appareils
           * (décision n° 182, `docs/DECISIONS.md`) : `app.svelte.ts` gagne le branchement
           * de `stampChanges`/`mergeSynced`/`restoreBackup` — de la CIRCUITERIE, conforme à la voie
           * ci-dessus, mais qui dilue mécaniquement le ratio tant qu'elle n'est exercée que par les
           * specs Playwright (hors de cette mesure). La LOGIQUE, elle, vit dans `src/lib/storage/
           * sync/`, mesurée à 99,14 % de lignes juste à côté. `functions`/`branches` n'ont pas eu
           * besoin de baisser (4,43 % et 0,38 % mesurés, planchers inchangés).
           *
           * Même geste à la boîte aux lettres synchronisée (décision n° 183, `docs/DECISIONS.md`,
           * 22/09/2026) : `app.svelte.ts` gagne le câblage de `syncMailbox`/`buildMailboxDeposit`
           * (démarrage, retour au premier plan, anti-rebond 60 s, écran `Synchro.svelte`) — encore
           * de la circuiterie, la LOGIQUE restant dans `src/lib/storage/mailbox-sync.ts`, mesurée à
           * 96,36 % de lignes. `lines`/`statements`/`functions` redescendus sous leur valeur
           * MESURÉE (2,38 %/2,19 %/4,28 %) ; `branches` n'a pas eu besoin de baisser (0,36 % mesuré,
           * plancher inchangé).
           */
          'src/state/**/*.ts': { lines: 2.3, statements: 2.1, functions: 4.2, branches: 0.3 },
        },
      },
    },
  };
});
