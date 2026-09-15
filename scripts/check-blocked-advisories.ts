#!/usr/bin/env node
/**
 * **Les avis de sécurité qu'on a délibérément laissés ouverts, et leur date de réveil.**
 *
 * Un avis sans correctif se referme mal : on écrit la décision, on l'oublie, et le jour où le
 * correctif paraît personne ne le voit. C'est d'autant plus vrai ici que **rien ne le dirait** —
 * les correctifs automatiques de sécurité sont désactivés sur ce dépôt, et dependabot ne propose
 * jamais de montée de version pour une dépendance **transitive** : la seule voie serait une PR de
 * sécurité, précisément celle qui est coupée.
 *
 * Ce script est donc la sonnerie du réveil. Il ne corrige rien : il demande au registre npm si ce
 * qui bloquait a cessé de bloquer, et il le dit dans l'issue de surveillance. Même famille que la
 * barrière du calendrier BLS, qui réclame sa relecture avant de s'épuiser.
 *
 * **Une panne du registre ne fait pas échouer ce contrôle**, contrairement à `audit-deps.ts`
 * (décision n° 99). La différence est dans ce que chacun protège : l'audit de production est un
 * **garde** — il ne doit jamais dire « rien à signaler » quand il n'a pas pu regarder, parce qu'un
 * déploiement en dépend. Celui-ci est un **rappel** : rien n'en dépend, et le faire crier au loup
 * toutes les six heures sur un `503` éteindrait la seule chose qu'il apporte, l'attention.
 * L'impossibilité de regarder est écrite dans le résumé, pas transformée en alarme.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Ce qui, une fois publié, rouvrirait un dossier qu'on a refermé faute de correctif. */
export interface WatchedRelease {
  /** Le paquet à surveiller sur le registre. */
  name: string;
  /** La version au-dessus de laquelle il se passe quelque chose. */
  above: string;
  /** Ce que sa parution voudrait dire, en une phrase adressée à qui lira l'issue. */
  means: string;
}

export interface BlockedAdvisory {
  /** Le paquet vulnérable, tel que l'avis le nomme. */
  packageName: string;
  advisories: readonly string[];
  /** Pourquoi on ne corrige pas. */
  because: string;
  watch: readonly WatchedRelease[];
}

/**
 * **La liste, adossée à ce script** (règle maison n° 90). Une ligne ici veut dire : « on sait, on a
 * tranché, et voici ce qui ferait revenir sur la décision ». Retirer l'avis sans retirer la ligne
 * laisse une surveillance qui ne surveille plus rien ; la décision n° 154 porte le raisonnement.
 */
export const BLOCKED: readonly BlockedAdvisory[] = [
  {
    packageName: 'extract-zip',
    advisories: ['CVE-2026-19693', 'CVE-2026-56876'],
    because:
      "aucune version corrigée n'existe — le correctif amont a consisté à s'en débarrasser, " +
      "`@puppeteer/browsers` 3.x l'ayant remplacé par `modern-tar`. Mais `puppeteer-core@24.43.1` " +
      "l'épingle à 2.13.2 exactement, et `lighthouse@12.6.1` demande `^24.10.0`.",
    watch: [
      {
        name: 'extract-zip',
        above: '2.0.1',
        means:
          'un correctif est publié. `@puppeteer/browsers` demande `^2.0.1`, donc une résolution ' +
          'neuve suffit : effacer son entrée du verrou et réinstaller.',
      },
      {
        name: '@lhci/cli',
        above: '0.15.1',
        means:
          "l'outil est republié après quinze mois de gel. La chaîne `lighthouse` → " +
          "`puppeteer-core` peut enfin bouger, et avec elle la sortie d'`extract-zip`.",
      },
    ],
  },
];

/** Compare deux versions `a.b.c`. Les préversions ne nous intéressent pas : elles ne débloquent rien. */
export function isAbove(candidate: string, floor: string): boolean {
  const clean = (v: string): number[] => v.split('-')[0]!.split('.').map(Number);
  const a = clean(candidate);
  const b = clean(floor);
  for (let i = 0; i < 3; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

export interface Unblocked {
  advisory: BlockedAdvisory;
  watched: WatchedRelease;
  published: string;
}

/**
 * Ce qui a bougé, à partir de ce que le registre a rendu. Fonction **pure** : c'est elle que les
 * tests éprouvent, sans sortir sur Internet (règle maison des tests).
 */
export function unblocked(
  blocked: readonly BlockedAdvisory[],
  latest: Readonly<Record<string, string>>,
): Unblocked[] {
  const found: Unblocked[] = [];
  for (const advisory of blocked)
    for (const watched of advisory.watch) {
      const published = latest[watched.name];
      if (published !== undefined && isAbove(published, watched.above))
        found.push({ advisory, watched, published });
    }
  return found;
}

/** Le résumé que l'issue de surveillance affiche. */
export function summarise(
  blocked: readonly BlockedAdvisory[],
  latest: Readonly<Record<string, string>>,
  unreachable: readonly string[],
): string {
  const moved = unblocked(blocked, latest);
  const lines = ['### Avis de sécurité laissés ouverts', ''];
  if (moved.length === 0)
    lines.push('Rien n’a bougé : chaque avis reste bloqué pour la raison écrite.');
  for (const { advisory, watched, published } of moved)
    lines.push(
      `- **${advisory.packageName}** (${advisory.advisories.join(', ')}) — ` +
        `\`${watched.name}\` est passé en **${published}**, au-dessus de ${watched.above}. ` +
        `${watched.means}`,
    );
  lines.push('');
  for (const advisory of blocked)
    lines.push(
      `- \`${advisory.packageName}\` : ${advisory.because} ` +
        `Surveillé : ${advisory.watch.map((w) => `\`${w.name}\` > ${w.above}`).join(', ')}.`,
    );
  if (unreachable.length > 0) {
    lines.push('');
    lines.push(
      `_Registre npm muet pour ${unreachable.map((n) => `\`${n}\``).join(', ')} : ` +
        'ce n’est pas un verdict, c’est une non-réponse. Rien n’est conclu de ces paquets._',
    );
  }
  return lines.join('\n');
}

const REGISTRY = 'https://registry.npmjs.org';
const TIMEOUT_MS = 15_000;
const ATTEMPTS = 2;

/**
 * Le chemin du registre pour un paquet. Le registre npm veut la forme `@portee%2fnom` : le `@`
 * reste littéral, la barre oblique est échappée.
 *
 * **`replaceAll`, et non `replace`** : `String.replace` avec une chaîne ne remplace que la
 * **première** occurrence, si bien qu'un nom en portant deux en laisserait une intacte et
 * changerait le chemin interrogé. La table de ce fichier est écrite en dur, donc rien n'est
 * exploitable — mais le code serait faux dès qu'elle ne le serait plus, et c'est CodeQL
 * (`js/incomplete-sanitization`) qui l'a nommé.
 */
export const registryPath = (name: string): string => name.replaceAll('/', '%2f');

/** La dernière version publiée d'un paquet, ou `null` si le registre n'a rien rendu d'exploitable. */
async function latestOf(name: string): Promise<string | null> {
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const response = await fetch(`${REGISTRY}/${registryPath(name)}`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { accept: 'application/vnd.npm.install-v1+json' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body: unknown = await response.json();
      const tag = (body as { 'dist-tags'?: { latest?: unknown } })['dist-tags']?.latest;
      if (typeof tag === 'string') return tag;
      throw new Error('aucune version dans dist-tags');
    } catch (error) {
      if (attempt === ATTEMPTS) {
        console.warn(`Registre muet pour ${name} : ${(error as Error).message}`);
        return null;
      }
    }
  }
  return null;
}

async function main(): Promise<void> {
  const names = [...new Set(BLOCKED.flatMap((a) => a.watch.map((w) => w.name)))];
  const latest: Record<string, string> = {};
  const unreachable: string[] = [];
  for (const name of names) {
    const version = await latestOf(name);
    if (version === null) unreachable.push(name);
    else latest[name] = version;
  }

  const summary = summarise(BLOCKED, latest, unreachable);
  mkdirSync('monitor-results', { recursive: true });
  writeFileSync('monitor-results/advisories.md', `${summary}\n`);
  console.log(summary);

  const moved = unblocked(BLOCKED, latest);
  if (moved.length === 0) {
    console.log('\nAucun avis bloqué ne peut être rouvert aujourd’hui.');
    return;
  }
  console.error(
    `\n${moved.length} avis peut désormais être traité : voir docs/DECISIONS.md n° 154 pour la marche à suivre.`,
  );
  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
