import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import ts from 'typescript-eslint';
import svelteConfig from './svelte.config.js';

export default ts.config(
  {
    ignores: [
      'dist/',
      'dev-dist/',
      // Worktrees Claude : ils vivent DANS l'arbre et portent leur propre `node_modules`. Le motif
      // `node_modules/` ci-dessous est relatif à la racine en configuration plate, donc il ne les
      // couvre pas : sans cette ligne, ESLint traverse des dizaines de milliers de fichiers et
      // finit par épuiser la mémoire (constaté le 01/09/2026, 564 paquets dans un seul worktree).
      '.claude/',
      // Bundle du serveur MCP : code généré, jamais relu à la main.
      'mcp/dist/',
      'coverage/',
      'node_modules/',
      'playwright-report/',
      'test-results/',
      'blob-report/',
      '.lighthouseci/',
      'monitor-results/',
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs.recommended,
  prettier,
  ...svelte.configs.prettier,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        __APP_VERSION__: 'readonly',
        __BUILD_SHA__: 'readonly',
      },
    },
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        extraFileExtensions: ['.svelte'],
        parser: ts.parser,
        svelteConfig,
      },
    },
  },
);
