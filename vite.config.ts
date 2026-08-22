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
  "connect-src 'self' https://api.coingecko.com https://api.coinbase.com https://api.kraken.com https://api.frankfurter.dev https://api.frankfurter.app",
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
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  resolve: {
    alias: { $lib: fileURLToPath(new URL('./src/lib', import.meta.url)) },
  },
  plugins: [
    svelte(),
    cspMetaOnBuild(),
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
    },
  },
});
