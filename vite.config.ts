import { fileURLToPath, URL } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig, type Plugin } from 'vitest/config';
import pkg from './package.json' with { type: 'json' };

/** Chemin de publication sur GitHub Pages (dépôt « cout-revient-ch »). */
const BASE = '/cout-revient-ch/';

/**
 * Content-Security-Policy injectée en <meta> au build uniquement (GitHub Pages ne permet pas
 * d'en-têtes HTTP). En dev, Vite a besoin du websocket HMR et de styles inline : pas de CSP.
 * `style-src 'unsafe-inline'` est nécessaire aux attributs style="" ; aucun script inline.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' https://api.coingecko.com https://api.coinbase.com https://api.exchange.coinbase.com https://api.kraken.com https://api.hyperliquid.xyz https://coins.llama.fi wss://api.hyperliquid.xyz https://mempool.space https://blockstream.info https://api.etherscan.io https://api.blockscout.com https://api.routescan.io https://eth.blockscout.com https://arbitrum.blockscout.com https://base.blockscout.com https://api.frankfurter.dev https://api.frankfurter.app",
  "manifest-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

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

export default defineConfig({
  base: BASE,
  preview: {
    port: Number(process.env['PORT']) || 4173,
    strictPort: false,
  },
  server: {
    // Port assigné par l'outil de lancement (variable PORT), 5173 sinon.
    port: Number(process.env['PORT']) || 5173,
    strictPort: false,
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    // Commit déployé (GitHub Actions), « dev » en local : affiché dans le diagnostic copiable.
    __BUILD_SHA__: JSON.stringify((process.env['GITHUB_SHA'] ?? 'dev').slice(0, 7)),
  },
  resolve: {
    alias: { $lib: fileURLToPath(new URL('./src/lib', import.meta.url)) },
  },
  plugins: [
    svelte(),
    cspMetaOnBuild(),
    stubJspdfOptionalDeps(),
    VitePWA({
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
      },
      workbox: {
        // Seuls les assets de l'app sont mis en cache ; jamais les données ni les API de prix.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        navigateFallback: `${BASE}index.html`,
        runtimeCaching: [],
        // Clic sur une notification d'alerte (sw-notifications.js) + vérification opportuniste
        // des alertes app fermée : noyau pur (sw-alerts-core.js, testé via node:vm) puis
        // handler Periodic Background Sync (sw-alert-sync.js) — l'ordre compte.
        importScripts: ['sw-notifications.js', 'sw-alerts-core.js', 'sw-alert-sync.js'],
      },
    }),
  ],
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/lib/**/*.ts'],
      exclude: ['src/lib/**/*.test.ts', 'src/lib/**/*.d.ts'],
      reporter: ['text', 'html'],
      // Seuils bloquants (CI : `npm run test -- --coverage`) : le moteur doit rester le mieux couvert.
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 78,
        branches: 65,
        'src/lib/domain/**/*.ts': { lines: 90, statements: 90, functions: 88, branches: 75 },
      },
    },
  },
});
