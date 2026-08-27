#!/usr/bin/env node
/**
 * Génère `src/lib/pricing/tickers.generated.ts` — la couverture large de la table des prix.
 *
 * Pourquoi générer plutôt que recopier : chacun détient des cryptos différentes, et une table de
 * 70 entrées écrite à la main ne suivra jamais le marché. Passer de 500 à 1 000 actifs doit être un
 * paramètre, pas un chantier.
 *
 * **La règle qui décide de tout : un symbole ambigu n'est PAS cartographié.** CoinGecko compte
 * plusieurs milliers d'actifs et un même symbole peut désigner deux projets. Un mauvais identifiant
 * ne donne pas « pas de prix » : il donne un **prix faux**, donc un PRU faux, sans que rien ne le
 * signale à l'écran. Sur le top 500 mesuré le 27/08/2026, sept symboles seulement sont en conflit
 * (1,4 %) — les écarter coûte une couverture dérisoire et supprime entièrement ce risque.
 *
 * Et la règle intuitive « le mieux classé gagne » est fausse : pour `safe`, elle donnerait
 * *safecoin* (#260) alors que le jeton que tout le monde appelle SAFE est *safe* (#336).
 *
 * La table **curée** (`tickers.ts`) reste prioritaire : elle porte des décisions humaines — `eurcv`
 * sans identifiant parce qu'ancré à l'euro, `wif` → `dogwifcoin` — qu'aucune génération ne doit
 * écraser. Ce script ne réémet donc jamais un symbole déjà curé.
 *
 * Usage : `node scripts/generate-tickers.mjs [top]`   (défaut : 500)
 */
import { readFileSync, writeFileSync } from 'node:fs';

const TOP = Number(process.argv[2] ?? 500);
const PER_PAGE = 250;
const ENDPOINT = 'https://api.coingecko.com/api/v3/coins/markets';
/** Le plan gratuit tolère quelques requêtes par minute : on espace franchement. */
const DELAY_MS = 2500;
const OUT = 'src/lib/pricing/tickers.generated.ts';
const CURATED = 'src/lib/pricing/tickers.ts';

/** Codes d'actifs de l'app : minuscules, alphanumériques. Le reste n'est pas représentable. */
const CODE = /^[a-z0-9]{2,12}$/;

function curatedCodes() {
  const src = readFileSync(CURATED, 'utf8');
  return new Set([...src.matchAll(/^ {2}([a-z0-9]+): T\(/gm)].map((m) => m[1]));
}

async function fetchPage(page) {
  const url = `${ENDPOINT}?vs_currency=eur&order=market_cap_desc&per_page=${PER_PAGE}&page=${page}`;
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`CoinGecko HTTP ${response.status} (page ${page})`);
  const body = await response.json();
  if (!Array.isArray(body)) throw new Error('CoinGecko : réponse inattendue');
  return body;
}

const escape = (value) => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

async function main() {
  const pages = Math.ceil(TOP / PER_PAGE);
  const coins = [];
  for (let page = 1; page <= pages; page += 1) {
    coins.push(...(await fetchPage(page)));
    if (page < pages) await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  const bySymbol = new Map();
  for (const coin of coins.slice(0, TOP)) {
    const symbol = String(coin.symbol ?? '').toLowerCase();
    const id = String(coin.id ?? '');
    const name = String(coin.name ?? '').trim();
    if (!CODE.test(symbol) || id === '' || name === '') continue;
    if (!bySymbol.has(symbol)) bySymbol.set(symbol, []);
    bySymbol.get(symbol).push({ id, name, rank: coin.market_cap_rank ?? null });
  }

  const curated = curatedCodes();
  const ambiguous = [];
  const kept = [];
  for (const [symbol, entries] of [...bySymbol.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (entries.length > 1) {
      ambiguous.push({ symbol, entries });
      continue;
    }
    if (curated.has(symbol)) continue;
    kept.push({ symbol, ...entries[0] });
  }

  // Les clés sont TOUJOURS citées : un symbole comme `1inch` ou `2z` n'est pas un identifiant
  // JavaScript valide, et le fichier ne compilerait pas.
  const lines = kept.map((e) => `  '${e.symbol}': G('${escape(e.name)}', '${escape(e.id)}'),`);
  const conflicts = ambiguous.map(
    (a) => ` * - \`${a.symbol}\` : ${a.entries.map((e) => `${e.id} (#${e.rank})`).join(' vs ')}`,
  );

  const file = `/**
 * **Fichier généré — ne pas modifier à la main.**
 * \`node scripts/generate-tickers.mjs ${TOP}\` le réécrit entièrement.
 *
 * Couverture large de la table des prix : le top ${TOP} CoinGecko par capitalisation, au
 * ${new Date().toISOString().slice(0, 10)}. Une table de marché vieillit — cette date dit de quand
 * elle parle.
 *
 * Les symboles **ambigus** en sont volontairement absents : quand deux projets partagent un
 * symbole, aucun identifiant n'est retenu, et l'actif reste sans cotation automatique plutôt que
 * de risquer un prix faux. L'utilisateur peut toujours forcer l'identifiant depuis la fiche actif.
 * Écartés à cette génération :
${conflicts.length > 0 ? conflicts.join('\n') : ' * - (aucun)'}
 *
 * Les symboles déjà présents dans la table **curée** (\`tickers.ts\`) ne sont pas réémis : la table
 * curée porte des décisions humaines et reste prioritaire.
 */
import type { TickerInfo } from './tickers';

/** Entrée générée : identifiant CoinGecko seulement — CoinGecko ne connaît ni Coinbase ni Kraken. */
const G = (name: string, coingeckoId: string): TickerInfo => ({ name, coingeckoId, coinbase: null });

export const GENERATED_TICKERS: Record<string, TickerInfo> = {
${lines.join('\n')}
};

/** Symboles écartés pour ambiguïté, avec leurs candidats : lus par le test de non-régression. */
export const AMBIGUOUS_SYMBOLS: readonly string[] = [
${ambiguous.map((a) => `  '${a.symbol}',`).join('\n')}
];
`;

  writeFileSync(OUT, file, 'utf8');
  console.log(`${OUT} : ${kept.length} entrées générées sur le top ${TOP}`);
  console.log(
    `écartés pour ambiguïté : ${ambiguous.length} (${ambiguous.map((a) => a.symbol).join(', ')})`,
  );
  console.log(
    `déjà curés, non réémis : ${[...bySymbol.keys()].filter((s) => curated.has(s)).length}`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
