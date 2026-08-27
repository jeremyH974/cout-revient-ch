#!/usr/bin/env node
/**
 * Génère les logos manquants dans `public/icons/` et réécrit `KNOWN_ICONS`.
 *
 * Source : `@web3icons/core` (**MIT**), déjà à l'origine de 61 des 62 premiers logos. Le paquet
 * n'est **pas** une dépendance du projet : 49 Mo réinstallés à chaque exécution de CI pour un outil
 * à usage unique ne se justifient pas, et le dossier `public/icons/` suit la convention déjà écrite
 * dans son `LICENSE.md` — les fichiers sont copiés ponctuellement, pas résolus au build.
 *
 *   npm install --no-save @web3icons/core@4.0.55
 *   node scripts/generate-icons.mjs
 *   npm uninstall @web3icons/core
 *
 * **Les fichiers existants ne sont jamais écrasés.** Sept d'entre eux portent des retouches à la
 * main documentées dans `public/icons/LICENSE.md` (variantes « mono » posées sur un disque, icônes
 * réseau réutilisées, masque corrigé) : une régénération aveugle les perdrait en silence.
 *
 * Transformation appliquée, identique à celle des premiers logos : variante « background » du
 * paquet, dont le **fond carré devient un disque** (et le `clipPath` avec), attributs `width`,
 * `height` et `class` retirés, espaces entre balises réduits.
 *
 * Un symbole **ambigu** — deux projets pour un même ticker — n'est pas embarqué : `@web3icons/core`
 * nomme par ticker et a donc tranché sans nous le dire. Afficher le mauvais logo est moins grave
 * qu'un prix faux, mais ce n'est pas une raison de le faire exprès.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';

const PKG = 'node_modules/@web3icons/core/dist/svgs/tokens/background';
const OUT = 'public/icons';
const ICONS_TS = 'src/lib/pricing/icons.ts';
const CURATED = 'src/lib/pricing/tickers.ts';
const GENERATED = 'src/lib/pricing/tickers.generated.ts';

/** Le test de sécurité de `icons.test.ts` : aucun script, aucune référence externe. */
const FORBIDDEN = /<script|<image|<foreignObject|href=|https?:\/\/(?!www\.w3\.org)/;
/** Fond plein 24 × 24, sous ses deux écritures observées dans le paquet. */
const SQUARE = /<path fill="(#[0-9A-Fa-f]{3,8})" d="(?:M24 0H0v24h24z|M0 0h24v24H0z)"\/>/;

function wantedCodes() {
  const codes = new Set();
  for (const [file, re] of [
    [CURATED, /^ {2}([a-z0-9]+): T\(/gm],
    [GENERATED, /^ {2}'([a-z0-9]+)': G\(/gm],
  ]) {
    for (const m of readFileSync(file, 'utf8').matchAll(re)) codes.add(m[1]);
  }
  return codes;
}

/** Extrait la chaîne SVG du module JS et la déséchappe. */
function svgOf(file) {
  const src = readFileSync(file, 'utf8');
  const start = src.indexOf("'");
  const end = src.lastIndexOf("'");
  if (start < 0 || end <= start) return null;
  return src
    .slice(start + 1, end)
    .replace(/\\n/g, '\n')
    .replace(/\\'/g, "'");
}

function toDisc(svg) {
  let out = svg
    .replace(/\s+width="24"/, '')
    .replace(/\s+height="24"/, '')
    .replace(/\s+class="web3icons"/, '');
  const square = SQUARE.exec(out);
  // Sans fond carré identifiable, la conversion en disque n'est pas sûre : on saute plutôt que de
  // livrer un logo à la géométrie différente des 62 autres.
  if (!square) return null;
  out = out.replace(SQUARE, `<circle cx="12" cy="12" r="12" fill="${square[1].toLowerCase()}"/>`);
  // Le masque doit devenir circulaire lui aussi, sinon le disque est recoupé au carré.
  out = out.replace(
    /<clipPath id="([^"]+)">\s*<path[^>]*\/>\s*<\/clipPath>/,
    '<clipPath id="$1"><circle cx="12" cy="12" r="12"/></clipPath>',
  );
  return out.replace(/>\s+</g, '><').trim();
}

function main() {
  if (!existsSync(PKG)) {
    console.error(
      `${PKG} introuvable — lancez d'abord : npm install --no-save @web3icons/core@4.0.55`,
    );
    process.exit(1);
  }
  const available = new Map();
  for (const file of readdirSync(PKG)) {
    if (!file.endsWith('.svg.js')) continue;
    available.set(file.slice(0, -'.svg.js'.length).toLowerCase(), `${PKG}/${file}`);
  }

  const wanted = wantedCodes();
  let written = 0;
  const skippedShape = [];
  const skippedUnsafe = [];
  const absent = [];

  for (const code of [...wanted].sort()) {
    const target = `${OUT}/${code}.svg`;
    if (existsSync(target)) continue; // jamais d'écrasement : voir l'en-tête
    const source = available.get(code);
    if (!source) {
      absent.push(code);
      continue;
    }
    const raw = svgOf(source);
    const svg = raw === null ? null : toDisc(raw);
    if (svg === null) {
      skippedShape.push(code);
      continue;
    }
    if (FORBIDDEN.test(svg) || !svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')) {
      skippedUnsafe.push(code);
      continue;
    }
    writeFileSync(target, `${svg}\n`, 'utf8');
    written += 1;
  }

  const files = readdirSync(OUT)
    .filter((f) => f.endsWith('.svg'))
    .map((f) => f.slice(0, -'.svg'.length))
    .sort();
  rewriteKnownIcons(files);

  console.log(`logos écrits : ${written}`);
  console.log(`total dans ${OUT} : ${files.length}`);
  console.log(`absents du paquet : ${absent.length}`);
  if (skippedShape.length > 0)
    console.log(`sautés (fond non reconnu) : ${skippedShape.join(', ')}`);
  if (skippedUnsafe.length > 0)
    console.log(`sautés (contenu refusé) : ${skippedUnsafe.join(', ')}`);
}

/** Réécrit le `Set` : c'était une connaissance dupliquée écrite à la main, elle est désormais dérivée. */
function rewriteKnownIcons(files) {
  const src = readFileSync(ICONS_TS, 'utf8');
  const block = `export const KNOWN_ICONS: ReadonlySet<string> = new Set([\n${files
    .map((f) => `  '${f}',`)
    .join('\n')}\n]);`;
  const next = src.replace(
    /export const KNOWN_ICONS: ReadonlySet<string> = new Set\(\[[\s\S]*?\]\);/,
    block,
  );
  if (next === src) throw new Error('KNOWN_ICONS introuvable dans icons.ts');
  writeFileSync(ICONS_TS, next, 'utf8');
}

main();
