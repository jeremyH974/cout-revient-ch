import { defineConfig } from 'vite';

/**
 * Build du serveur MCP local (décision n° 47) : un seul fichier ESM, exécutable par Node, tout
 * inclus. Vite est déjà une dépendance du projet — ce build n'en ajoute aucune.
 *
 * Pourquoi un build alors que Node 24 exécute TypeScript nativement : `src/lib` importe sans
 * extension de fichier (`./money`), ce que le résolveur ESM de Node refuse. Plutôt que d'imposer
 * des extensions à tout le code de l'app pour le confort d'un outil annexe, on regroupe ici.
 */
export default defineConfig({
  build: {
    ssr: 'mcp/server.ts',
    outDir: 'mcp/dist',
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    rollupOptions: {
      output: { format: 'esm', entryFileNames: 'server.js' },
    },
  },
  // `big.js` est regroupé lui aussi : le fichier produit se suffit à lui-même.
  ssr: { noExternal: true },
});
