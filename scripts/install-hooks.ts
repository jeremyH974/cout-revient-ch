/**
 * Installe les hooks Git du dépôt, en une commande explicite.
 *
 * ## Pourquoi ce n'est pas automatique
 *
 * L'usage répandu est un `prepare` dans `package.json`, exécuté à chaque `npm install`. Il ne
 * fonctionnerait **pas** ici : `.npmrc` pose `ignore-scripts` (décision n° 13, après le ver npm
 * « Shai-Hulud »), ce qui fait taire tous les scripts de cycle de vie — les nôtres compris. Un
 * `prepare` donnerait l'illusion d'un garde-fou posé alors qu'aucun ne le serait, ce qui est pire
 * que pas de garde-fou du tout.
 *
 * D'où une commande qu'on lance sciemment : `npm run hooks:install`.
 *
 * ## Pourquoi `core.hooksPath` plutôt qu'une copie dans `.git/hooks`
 *
 * Parce qu'un fichier copié se périme en silence. Avec `core.hooksPath`, les hooks vivent dans le
 * dépôt, sont versionnés, relus comme le reste du code, et une modification s'applique sans qu'on
 * ait à réinstaller quoi que ce soit.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const HOOKS = join(ROOT, '.githooks');

if (!existsSync(HOOKS)) {
  console.error(`Dossier introuvable : ${HOOKS}`);
  process.exit(1);
}

execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: ROOT, stdio: 'inherit' });

/*
 * Le bit d'exécution est ignoré par Windows mais indispensable ailleurs, et `git` le conserve dans
 * l'index. Le poser ici évite qu'un dépôt cloné sur macOS ou Linux se retrouve avec des hooks que
 * Git refuse d'exécuter sans un mot.
 */
const posed: string[] = [];
for (const name of readdirSync(HOOKS)) {
  const file = join(HOOKS, name);
  try {
    chmodSync(file, 0o755);
  } catch {
    /* système de fichiers sans bit d'exécution : sans conséquence sous Windows */
  }
  posed.push(name);
}

console.log(`Hooks Git installés (core.hooksPath = .githooks) : ${posed.join(', ')}`);
console.log("Un commit qui embarquerait un relevé réel sera refusé avant d'exister.");
