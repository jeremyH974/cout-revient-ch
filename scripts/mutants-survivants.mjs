// Lit le rapport de mutation et dit CE QUI RESTE À VÉRIFIER, en texte.
//
// Stryker écrit un rapport HTML de 1,3 Mo : excellent pour flâner, inutilisable pour travailler —
// on ne peut ni le lire d'un coup, ni le donner à relire, ni comparer deux relevés. Ce script lit
// le rapport JSON du même run et rend deux choses : le score par fichier, et la LISTE des mutants
// non tués d'un module, avec la ligne, le mutateur, le code d'origine et son remplacement.
//
// C'est cette liste qui transforme un score en travail : un survivant se lit comme une question —
// quel test aurait dû rougir ici ? — et la réponse est presque toujours une assertion manquante.
//
// La distinction qui compte, et que le score global écrase : un mutant `Survived` a été EXÉCUTÉ
// sans être vérifié ; un `NoCoverage` n'a même pas été atteint. Le second est un pan de code que
// personne n'appelle — un trou plus large, et souvent plus vite comblé.
//
//   node scripts/mutants-survivants.mjs                    → le score par fichier
//   node scripts/mutants-survivants.mjs domain/tax-fr.ts   → les survivants de ce module
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const REPORT = 'reports/mutation/mutation.json';
const filter = process.argv[2] ?? null;

let report;
let writtenAt;
try {
  report = JSON.parse(readFileSync(REPORT, 'utf8'));
  writtenAt = statSync(REPORT).mtime;
} catch {
  console.error(`Rapport introuvable ou illisible : ${REPORT}`);
  console.error('Lancez `npm run mutation` d’abord (le rapporteur `json` est dans la config).');
  process.exit(1);
}

/**
 * **Un rapport périmé se lit comme un relevé sans progrès.** Stryker échoue parfois en fin de course
 * (`EPERM` sous Windows, piège n° 3) : le rapport de la veille reste alors en place, et la commande
 * rend des chiffres au mot près identiques — on croit n'avoir rien gagné alors qu'on n'a rien
 * mesuré. Vécu le 15/09/2026. La date du relevé s'affiche donc toujours, et une source plus récente
 * que lui le dit en toutes lettres.
 */
const newestUnder = (dir) => {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    const at = entry.isDirectory() ? newestUnder(path) : statSync(path).mtimeMs;
    if (at > newest) newest = at;
  }
  return newest;
};
const stale = newestUnder('src') > writtenAt.getTime();
console.log(`Relevé du ${writtenAt.toLocaleString('fr-FR')}${stale ? '' : '\n'}`);
if (stale)
  console.log(
    'ATTENTION : `src/` a changé depuis. Ces chiffres ne décrivent plus le code — relancez `npm run mutation`\net vérifiez son code de retour, une course qui échoue laisse le rapport précédent en place.\n',
  );

/** Un mutant `Ignored` n’a jamais été joué ; il ne compte ni au numérateur ni au dénominateur. */
const counted = (mutants) => mutants.filter((m) => m.status !== 'Ignored');
const killed = (mutants) => mutants.filter((m) => m.status === 'Killed' || m.status === 'Timeout');
const alive = (mutants) =>
  mutants.filter((m) => m.status === 'Survived' || m.status === 'NoCoverage');

const files = Object.entries(report.files)
  .map(([path, file]) => {
    const total = counted(file.mutants).length;
    return {
      path,
      file,
      total,
      killed: killed(file.mutants).length,
      alive: alive(file.mutants),
      score: total === 0 ? 100 : (killed(file.mutants).length / total) * 100,
    };
  })
  .sort((a, b) => a.score - b.score);

console.log('=== score par fichier, du moins mesuré au mieux mesuré ===');
for (const f of files) {
  const noCoverage = f.alive.filter((m) => m.status === 'NoCoverage').length;
  const reste =
    noCoverage > 0 ? `${f.alive.length} dont ${noCoverage} jamais couverts` : `${f.alive.length}`;
  console.log(
    `${f.score.toFixed(2).padStart(6)} %  ${String(reste).padStart(24)} / ${String(f.total).padStart(4)}  ${f.path}`,
  );
}
const sum = files.reduce(
  (acc, f) => ({
    total: acc.total + f.total,
    killed: acc.killed + f.killed,
    alive: acc.alive + f.alive.length,
  }),
  { total: 0, killed: 0, alive: 0 },
);
console.log(
  `ENSEMBLE ${((sum.killed / sum.total) * 100).toFixed(2)} % — ${sum.alive} mutants non tués sur ${sum.total}`,
);

if (filter === null) {
  console.log('\nPour la liste d’un module : node scripts/mutants-survivants.mjs domain/tax-fr.ts');
  process.exit(0);
}

const matches = files.filter((f) => f.path.includes(filter));
if (matches.length === 0) {
  console.error(`\nAucun fichier muté ne correspond à « ${filter} ».`);
  process.exit(1);
}

/**
 * **Le fragment EXACT, jamais la ligne entière.** Une ligne porte souvent plusieurs mutants
 * distincts, et lire la ligne fait croire que la mutation porte sur tout : sur
 * `if (event.kind !== 'income' || event.nature !== 'interest') continue;`, le mutant survivant ne
 * remplace que son PREMIER membre — auquel cas le second continue d'écarter les mêmes événements,
 * et le mutant est équivalent. Affichée comme une ligne, la même mutation ressemble à un trou béant.
 * Cette confusion a fait perdre une demi-heure le 15/09/2026 ; d'où les colonnes, et la citation du
 * seul texte réellement remplacé.
 */
const fragmentOf = (lines, m) => {
  const { start, end } = m.location;
  if (start.line !== end.line)
    return `${(lines[start.line - 1] ?? '').trim()} … (${end.line - start.line + 1} lignes)`;
  return (lines[start.line - 1] ?? '').slice(start.column - 1, end.column - 1);
};

for (const f of matches) {
  console.log(`\n=== ${f.path} — ${f.alive.length} mutants non tués ===`);
  const lines = f.file.source.split('\n');
  for (const m of [...f.alive].sort((a, b) => a.location.start.line - b.location.start.line)) {
    const { start, end } = m.location;
    const replacement = (m.replacement ?? '').split('\n')[0].slice(0, 100);
    const jamais = m.status === 'NoCoverage' ? ', jamais couvert' : '';
    console.log(
      `L${start.line}:${start.column}-${end.column} [${m.mutatorName}${jamais}]\n    ${JSON.stringify(fragmentOf(lines, m))}\n    devient ${JSON.stringify(replacement)}`,
    );
  }
}
