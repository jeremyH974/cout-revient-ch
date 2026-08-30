/**
 * Crochet de résolution ESM pour les scripts lancés à la main.
 *
 * Le code de l'application écrit ses imports relatifs **sans extension** (résolution « bundler »,
 * `tsconfig.json`), ce que Node refuse. Les générateurs existants s'en accommodent parce qu'ils
 * n'importent que des modules feuilles ; `scripts/capture-ai.ts`, lui, a besoin du pipeline
 * complet — ancrage, lexique, contrat — pour juger ce qu'un vrai modèle répond.
 *
 * Ce crochet ajoute `.ts` quand un spécificateur relatif n'a pas d'extension et que le fichier
 * existe. Il ne s'applique **qu'aux scripts qui le chargent explicitement** (`node --import
 * ./scripts/ts-resolve.mjs …`) : ni l'application, ni la CI, ni les tests n'en dépendent.
 */
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(candidate))) return { url: candidate.href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
