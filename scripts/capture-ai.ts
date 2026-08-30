/**
 * Capture des cassettes RÉELLES du banc d'essai (P65) :
 *   npm run ai:capture
 *
 * **Hors CI, toujours.** La CI ne sort jamais sur Internet et n'appelle jamais un modèle
 * (décision n° 68) : ce script se lance à la main, avec la clé de celui qui le lance, et le
 * résultat est committé — c'est le motif « instantané committé + barrière » des générateurs de
 * calendrier et de macro (décision n° 58).
 *
 * ## Ce qu'il a le droit de lire, et rien d'autre
 *
 * L'export réel de l'utilisateur vit à la RACINE du dépôt (ignoré par git). Un script de capture
 * qui accepterait un chemin en paramètre serait le chemin le plus court entre des données réelles
 * et une cassette committée — exactement ce que la décision n° 17 interdit, et qu'aucune relecture
 * ne rattraperait une fois le fichier poussé.
 *
 * Donc : **aucun paramètre d'entrée** (le script refuse de démarrer s'il en reçoit), et toute
 * lecture passe par `readAllowed`, qui n'admet que deux emplacements — les cas du banc d'essai et
 * le jeu de démonstration synthétique. La règle n'est pas écrite dans un commentaire : elle est
 * appliquée par une fonction, sur des chemins résolus.
 *
 * ## Trois tirages, et tout ou rien
 *
 * Un modèle n'est pas déterministe. Une capture unique mesurerait la chance ; trois tirages
 * mesurent une tendance. **Si l'un des trois échoue à l'ancrage ou au lexique, rien n'est écrit**
 * et le script sort en erreur : un cas dont deux réponses sur trois passent n'est pas un cas qui
 * passe, c'est un cas qui échoue une fois sur trois. Un seul tirage est committé — les trois
 * seraient trois fois le même test.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cassetteKey, type Cassette } from '../src/lib/ai/adapters/recorded.ts';
import { buildRequest } from '../src/lib/ai/contract.ts';
import { judgeNarrative } from '../src/lib/ai/narrative.ts';
import { anchorCoverage } from '../src/lib/ai/anchor.ts';
import { ANTHROPIC_MODEL_ID, anthropicAdapter } from '../src/lib/net/anthropic.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CASES_DIR = join(ROOT, 'tests', 'fixtures', 'ai', 'cases');
const REPLIES_DIR = join(ROOT, 'tests', 'fixtures', 'ai', 'replies');
/** Le jeu de démonstration : 100 % synthétique, jamais dérivé d'un export réel (décision n° 17). */
const DEMO_CSV = join(ROOT, 'tests', 'fixtures', 'coinhouse', 'export-demo.csv');

/** Nombre de tirages. Trois : assez pour voir une variance, assez peu pour coûter trois centimes. */
const DRAWS = 3;

/**
 * Espace fine insécable, espace insécable, espace fine, moins typographique : les caractères que
 * le français impose et qu'un relecteur ne voit pas. Ils sont **échappés dans le fichier**, sans
 * quoi une cassette qui teste le séparateur des milliers ressemblerait, à l'œil, à une cassette
 * qui teste l'espace ordinaire — et une relecture ne pourrait rien y voir.
 */
const INVISIBLE = /[\u00a0\u202f\u2009\u2212]/g;
const escapeInvisible = (json: string): string =>
  json.replace(INVISIBLE, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

/** Lecture autorisée, sur chemin RÉSOLU : les cas du banc d'essai, et le jeu synthétique. */
function readAllowed(path: string): string {
  const full = resolve(path);
  const inCases = full.startsWith(`${CASES_DIR}${sep}`);
  if (!inCases && full !== DEMO_CSV)
    throw new Error(
      `Lecture refusée : ${full}\n` +
        `Ce script ne lit que ${CASES_DIR} et ${DEMO_CSV}. ` +
        'Aucune capture ne doit jamais être faite sur un export réel (décision n° 17).',
    );
  return readFileSync(full, 'utf8');
}

interface CaptureCase {
  readonly id: string;
  readonly input: unknown;
  /** Seuls les cas qui le demandent sont capturés (voir plus bas). */
  readonly capture: boolean;
  readonly mustRefuse: string | null;
}

function loadCases(): CaptureCase[] {
  return readdirSync(CASES_DIR)
    .filter((file) => file.endsWith('.json'))
    .map((file) => JSON.parse(readAllowed(join(CASES_DIR, file))) as Record<string, unknown>)
    .map((raw) => ({
      id: String(raw['id']),
      input: raw['input'],
      capture: raw['capture'] === true,
      mustRefuse: ((raw['expect'] as Record<string, unknown>)?.['mustRefuse'] ?? null) as
        string | null,
    }));
}

async function main(): Promise<void> {
  if (process.argv.length > 2)
    throw new Error(
      `Ce script ne prend aucun paramètre (reçu : ${process.argv.slice(2).join(' ')}).\n` +
        'Le corpus de capture est figé — voir l’en-tête du fichier.',
    );
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey)
    throw new Error(
      'ANTHROPIC_API_KEY manquante. La capture appelle un vrai modèle et se facture : elle ne ' +
        'tourne qu’à la main, jamais en CI.',
    );
  // Une lecture du jeu synthétique, pour que son absence soit une erreur bruyante : c'est la SEULE
  // autre source admise, et le jour où quelqu'un voudra capturer sur des données, ce sera celle-là.
  if (readAllowed(DEMO_CSV).length === 0) throw new Error('Jeu de démonstration vide.');

  const cases = loadCases().filter((spec) => spec.capture && spec.mustRefuse === null);
  if (cases.length === 0)
    throw new Error('Aucun cas marqué `"capture": true` dans le jeu de référence.');

  const adapter = anthropicAdapter(apiKey);
  const capturedAt = new Date().toISOString().slice(0, 19);
  const written: string[] = [];

  for (const spec of cases) {
    const request = buildRequest('narrative', spec.input);
    const draws: string[] = [];
    for (let draw = 1; draw <= DRAWS; draw += 1) {
      const reply = await adapter.complete(request);
      const outcome = judgeNarrative(reply.text, spec.input, reply.modelId, capturedAt);
      if (outcome.status !== 'ok') {
        // Tout ou rien : on n'écrit pas la cassette du tirage chanceux.
        throw new Error(
          `${spec.id} — tirage ${draw}/${DRAWS} refusé (${outcome.reason}). Rien n’est écrit.\n` +
            `Texte reçu :\n${reply.text}`,
        );
      }
      console.info(
        `${spec.id} — tirage ${draw}/${DRAWS} : ancré, lexique propre, ` +
          `couverture ${(anchorCoverage(outcome.audit) * 100).toFixed(0)} %, ` +
          `${reply.text.length} caractères.`,
      );
      draws.push(reply.text);
    }
    const text = draws[0];
    if (text === undefined) throw new Error(`${spec.id} : aucun tirage.`);
    const hash = cassetteKey(request, ANTHROPIC_MODEL_ID);
    const cassette: Cassette = {
      hash,
      modelId: ANTHROPIC_MODEL_ID,
      capturedAt,
      // La provenance est la seule barrière entre le dépôt et une capture faite sur des données
      // réelles : `parseCassette` refuse toute autre valeur.
      source: 'fixture-capture',
      text,
    };
    writeFileSync(
      join(REPLIES_DIR, `${hash}.json`),
      `${escapeInvisible(JSON.stringify(cassette, null, 2))}\n`,
    );
    written.push(`${spec.id} → ${hash}.json`);
  }

  console.info(`\n${written.length} cassette(s) écrite(s) :\n  ${written.join('\n  ')}`);
  console.info(
    '\nLa cassette manuscrite du même cas est remplacée : relancez `npm run check`, puis relisez ' +
      'le texte capturé avant de le committer.',
  );
}

await main();
