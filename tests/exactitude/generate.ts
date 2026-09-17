#!/usr/bin/env node
/**
 * Génère les montants attendus d'une version du banc d'essai, depuis ses seules opérations.
 *
 *   npm run exactitude:generer -- v1
 *
 * **Les attendus ne se tapent jamais à la main** : ils sortent de l'implémentation de référence,
 * pour ne pas ajouter une coquille de recopie au risque d'erreur de calcul. Le générateur écrit
 * trois choses — les attendus dans `cas.json`, l'empreinte dans `manifest.json`, et la section de
 * `docs/exactitude.md` — et le test vérifie ensuite que les trois concordent.
 *
 * **Il refuse de réécrire une version publiée.** Une version citée par un tiers ne doit pas
 * changer sous lui : toute correction ouvre la version suivante.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import {
  dossier,
  empreinte,
  formater,
  lireJeu,
  lireManifeste,
  remplacerSection,
  rendreSection,
} from './banc.ts';
import { deriver } from './reference.ts';

const version = process.argv[2] ?? 'v1';
const manifeste = lireManifeste(version);
if (manifeste.publiee) {
  console.error(
    `La version ${version} est publiée : elle ne se régénère plus. Ouvrez la version suivante pour toute correction.`,
  );
  process.exit(1);
}

const jeu = lireJeu(version);
for (const cas of jeu.cas) cas.attendu = deriver(cas.operations, cas.taux);

const casJson = `${dossier(version)}/cas.json`;
const texte = await formater(JSON.stringify(jeu, null, 2), casJson);
writeFileSync(casJson, texte);

const manifestJson = `${dossier(version)}/manifest.json`;
const manifesteNeuf = { ...manifeste, empreinte: empreinte(texte) };
writeFileSync(manifestJson, await formater(JSON.stringify(manifesteNeuf, null, 2), manifestJson));

const page = readFileSync('docs/exactitude.md', 'utf8');
const pageNeuve = remplacerSection(page, version, rendreSection(jeu));
writeFileSync('docs/exactitude.md', await formater(pageNeuve, 'docs/exactitude.md'));

console.log(
  `${jeu.cas.length} cas générés pour ${version} ; empreinte ${manifesteNeuf.empreinte}.`,
);
