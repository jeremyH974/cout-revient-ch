/**
 * Le banc d'essai d'exactitude : lire un jeu, le rendre lisible, en calculer l'empreinte.
 *
 * Partagé par le générateur (`generate.ts`) et par le test (`exactitude.test.ts`), pour qu'aucun
 * des deux ne tienne sa propre idée du format. Aucune dépendance au moteur de l'application : ce
 * module ne connaît que le jeu publié et l'implémentation de référence.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as prettier from 'prettier';
import type { Attendu, Operation } from './reference.ts';

export interface Source {
  id: string;
  libelle: string;
  url: string;
}

export interface Cas {
  id: string;
  titre: string;
  /** Ce que le cas prouve, en une phrase : la raison d'être du cas, pas sa description. */
  prouve: string;
  sources: string[];
  /** Taux global par année, donné avec sa source plutôt que deviné par la référence. */
  taux: Record<string, string>;
  operations: Operation[];
  /** Rempli par le générateur ; absent tant qu'il n'a pas tourné. */
  attendu?: Attendu;
}

export interface Jeu {
  banc: 'exactitude';
  version: string;
  licence: string;
  regime: string;
  lecture: string;
  sources: Source[];
  cas: Cas[];
}

export interface Manifeste {
  banc: 'exactitude';
  version: string;
  /** Date de gel du jeu (AAAA-MM-JJ). */
  gele: string;
  /**
   * Une version publiée ne se régénère plus : toute correction ouvre la suivante. C'est ce qui
   * permet à un tiers de citer « v1 » en sachant que ce qu'il cite ne bougera pas sous lui.
   */
  publiee: boolean;
  /** SHA-256 de `cas.json` : un tiers vérifie qu'il rejoue exactement le jeu publié. */
  empreinte: string;
}

export const dossier = (version: string): string => `tests/fixtures/exactitude/${version}`;

export const lireJeu = (version: string): Jeu =>
  JSON.parse(readFileSync(`${dossier(version)}/cas.json`, 'utf8')) as Jeu;

export const lireManifeste = (version: string): Manifeste =>
  JSON.parse(readFileSync(`${dossier(version)}/manifest.json`, 'utf8')) as Manifeste;

/**
 * Empreinte du fichier **tel qu'il est écrit sur le disque**, fins de ligne comprises. Git peut
 * convertir les fins de ligne à l'extraction : on normalise donc en `\n` avant de hacher, faute de
 * quoi le même jeu aurait deux empreintes selon la machine qui le lit.
 */
export function empreinte(texte: string): string {
  return createHash('sha256').update(texte.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

/**
 * Met un texte généré dans la forme exacte qu'exige le dépôt (`prettier --check`). Sans cela, le
 * premier `npm run format` alignerait les tableaux de la page et réécrirait le JSON — l'empreinte
 * publiée ne correspondrait plus au fichier, et la page ne correspondrait plus au jeu, sans
 * qu'aucune donnée ait changé.
 */
export async function formater(texte: string, fichier: string): Promise<string> {
  const options = (await prettier.resolveConfig(fichier)) ?? {};
  return prettier.format(texte, { ...options, filepath: fichier });
}

/** Marqueurs qui encadrent, dans `docs/exactitude.md`, la section générée d'une version. */
export const marqueurs = (version: string): { debut: string; fin: string } => ({
  debut: `<!-- exactitude:${version}:debut — section générée par npm run exactitude:generer, ne pas éditer -->`,
  fin: `<!-- exactitude:${version}:fin -->`,
});

const oui = (b: boolean): string => (b ? 'oui' : 'non');

/**
 * La section de la page, rendue depuis le jeu. **Les montants y sont écrits exactement comme dans
 * `cas.json`** — sans séparateur de milliers ni virgule décimale — pour qu'on puisse les comparer
 * à la sortie d'un autre outil par un simple copier-coller.
 */
export function rendreSection(jeu: Jeu): string {
  const sources = new Map(jeu.sources.map((s) => [s.id, s]));
  const lignes: string[] = [];
  for (const cas of jeu.cas) {
    if (!cas.attendu) throw new Error(`Le cas ${cas.id} n'a pas d'attendu : lancez le générateur.`);
    lignes.push(`### ${cas.id} — ${cas.titre}`, '', cas.prouve, '');
    lignes.push(
      `Sources : ${cas.sources.map((id) => `[${id}](${sources.get(id)?.url ?? '#'})`).join(', ')}.`,
      '',
    );
    lignes.push(
      '| Cession | l. 212 | l. 213 | l. 214 | l. 217 | l. 218 | l. 220 | l. 221 | l. 223 | Fraction | l. 224 | PTA après |',
      '| ------- | -----: | -----: | -----: | -----: | -----: | -----: | -----: | -----: | -------: | -----: | --------: |',
    );
    for (const c of cas.attendu.cessions)
      lignes.push(
        `| ${c.date} | ${c.l212} | ${c.l213} | ${c.l214} | ${c.l217} | ${c.l218} | ${c.l220} | ${c.l221} | ${c.l223} | ${c.fraction} | ${c.l224} | ${c.ptaApres} |`,
      );
    lignes.push('');
    for (const c of cas.attendu.cessions) lignes.push(`- ${c.date} : \`${c.calcul}\``);
    lignes.push(
      '',
      '| Année | l. 51 | Exonérée | Plus-values | Moins-values | Net | Taux | Impôt |',
    );
    lignes.push('| ----- | ----: | :------: | ----------: | -----------: | --: | ---: | ----: |');
    for (const a of cas.attendu.annees)
      lignes.push(
        `| ${a.annee} | ${a.l51} | ${oui(a.exoneree)} | ${a.plusValues} | ${a.moinsValues} | ${a.net} | ${a.taux} | ${a.impot} |`,
      );
    lignes.push('');
  }
  return lignes.join('\n');
}

/** Remplace, dans le texte de la page, la section encadrée par les marqueurs de la version. */
export function remplacerSection(page: string, version: string, section: string): string {
  const { debut, fin } = marqueurs(version);
  const i = page.indexOf(debut);
  const j = page.indexOf(fin);
  if (i === -1 || j === -1 || j < i)
    throw new Error(`Marqueurs de la version ${version} introuvables dans docs/exactitude.md.`);
  return `${page.slice(0, i + debut.length)}\n\n${section}\n${page.slice(j)}`;
}

/** Extrait la section générée d'une version, telle qu'elle est aujourd'hui dans la page. */
export function extraireSection(page: string, version: string): string {
  const { debut, fin } = marqueurs(version);
  const i = page.indexOf(debut);
  const j = page.indexOf(fin);
  if (i === -1 || j === -1 || j < i) return '';
  return page.slice(i + debut.length, j).trim();
}
