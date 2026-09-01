#!/usr/bin/env node
/**
 * Tests de contrat des API tierces utilisées par l'application : on vérifie que chaque fournisseur
 * répond encore avec la forme exacte que le code consomme (champs, types, ordre des chandelles).
 * Lancé par la surveillance planifiée ; écrit un résumé Markdown et sort en erreur au moindre écart.
 *
 * Aucune clé, aucune donnée personnelle : seules des requêtes publiques sur BTC/EUR et EUR/USD.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { summarise } from './contract-state.ts';

/**
 * 30 s, et non 15. Les instances publiques de Blockscout sont lentes et inégales : mesures du
 * 01/09/2026 sur `arbitrum.blockscout.com`, 6,2 s / 6,6 s / 6,9 s / 7,1 s / 12,2 s / 12,8 s, puis
 * une coupure à 15 s en CI. Un délai trop court transforme un contrôle de **forme** en contrôle de
 * **latence**, et fait échouer la surveillance au hasard — exactement le cri au loup que la
 * décision n° 74 cherche à éteindre.
 */
const TIMEOUT_MS = 30_000;

/**
 * Une erreur de réseau n'est pas un contrat rompu : elle ne dit rien de la forme de la réponse. On
 * redonne donc **une** chance, une seule, avant de conclure. Deux échecs de suite sur 30 s restent
 * un vrai signal — un fournisseur qu'un navigateur ne peut pas joindre est inutilisable.
 */
const NETWORK_RETRIES = 1;
const RETRY_PAUSE_MS = 2_000;

const results = [];

/** GET par défaut ; `options.method`/`body`/`headers` pour les fournisseurs interrogés en POST. */
async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: options.method ?? 'GET',
      body: options.body,
      signal: controller.signal,
      headers: { accept: 'application/json', ...options.headers },
    });
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: response.status, headers: response.headers, json, text };
  } finally {
    clearTimeout(timer);
  }
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isNumericString = (v) => typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v);

/**
 * `options.sursis` déclare un écart **connu et accepté** : il n'alarme plus, mais reste surveillé.
 * Voir `contract-state.ts` pour ce que ça implique — notamment qu'un sursis **expiré** redevient un
 * échec, et qu'un fournisseur qui répond de nouveau sous sursis est signalé sans alarmer.
 */
async function check(name, url, validate, options = {}) {
  const started = Date.now();
  const { sursis } = options;
  let lastError = null;
  for (let attempt = 0; attempt <= NETWORK_RETRIES; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, RETRY_PAUSE_MS));
    try {
      const r = await fetchJson(url, options);
      // Troisième argument : le texte brut. Le Trésor rend du XML, la Fed du CSV, le FOMC du
      // HTML — `JSON.parse` n'en tire rien. Les validateurs plus anciens l'ignorent.
      const problems =
        r.status === 200 ? validate(r.json, r.headers, r.text) : [`HTTP ${r.status}`];
      results.push({
        name,
        url,
        sursis,
        ok: problems.length === 0,
        ms: Date.now() - started,
        detail: problems.join(' ; ') || 'conforme',
        rateLimit: [...r.headers.entries()]
          .filter(([k]) => /ratelimit|retry-after/i.test(k))
          .map(([k, v]) => `${k}=${v}`)
          .join(', '),
      });
      return;
    } catch (error) {
      // Seule la couche réseau est réessayée : une réponse mal formée est un vrai écart, et la
      // rejouer ne ferait que retarder le constat.
      lastError = error;
    }
  }
  results.push({
    name,
    url,
    sursis,
    ok: false,
    ms: Date.now() - started,
    detail: `erreur réseau après ${NETWORK_RETRIES + 1} tentatives : ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
    rateLimit: '',
  });
}

await check(
  'CoinGecko simple/price',
  'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=eur&precision=full&include_last_updated_at=true',
  (json) => {
    const problems = [];
    if (!json || typeof json !== 'object') return ['réponse non JSON'];
    const btc = json.bitcoin;
    if (!btc || !isNum(btc.eur)) problems.push('bitcoin.eur absent ou non numérique');
    if (btc && btc.last_updated_at !== undefined && !isNum(btc.last_updated_at))
      problems.push('last_updated_at non numérique');
    return problems;
  },
);

await check('Coinbase spot', 'https://api.coinbase.com/v2/prices/BTC-EUR/spot', (json) => {
  const amount = json?.data?.amount;
  return isNumericString(amount) || isNum(amount) ? [] : ['data.amount absent ou non numérique'];
});

await check('Coinbase Exchange products', 'https://api.exchange.coinbase.com/products', (json) => {
  if (!Array.isArray(json)) return ['réponse non tabulaire'];
  const btc = json.find((p) => p && p.id === 'BTC-EUR');
  if (!btc) return ['produit BTC-EUR absent'];
  if (btc.quote_currency !== 'EUR') return ['quote_currency ≠ EUR'];
  return [];
});

await check(
  'Coinbase Exchange candles',
  'https://api.exchange.coinbase.com/products/BTC-EUR/candles?granularity=86400',
  (json) => {
    if (!Array.isArray(json) || json.length === 0) return ['aucune chandelle'];
    const first = json[0];
    if (!Array.isArray(first) || first.length < 6 || !first.slice(0, 6).every(isNum))
      return ['chandelle ≠ [time, low, high, open, close, volume] numériques'];
    if (json.length > 1 && !(json[0][0] > json[1][0]))
      return ['chandelles attendues du plus récent au plus ancien'];
    return [];
  },
);

await check(
  'Kraken OHLC',
  'https://api.kraken.com/0/public/OHLC?pair=XBTEUR&interval=1440',
  (json) => {
    if (!json || !Array.isArray(json.error)) return ['champ error absent'];
    if (json.error.length > 0) return [`erreur Kraken : ${json.error.join(', ')}`];
    const key = Object.keys(json.result ?? {}).find((k) => k !== 'last');
    const rows = key ? json.result[key] : null;
    if (!Array.isArray(rows) || rows.length === 0) return ['aucune bougie'];
    const row = rows[rows.length - 1];
    if (!Array.isArray(row) || row.length < 8 || !isNum(row[0]) || !isNumericString(row[4]))
      return ['bougie ≠ [time, open, high, low, close, vwap, volume, count]'];
    return [];
  },
);

await check('Kraken AssetPairs', 'https://api.kraken.com/0/public/AssetPairs', (json) => {
  const pairs = json?.result ?? {};
  const eur = Object.values(pairs).filter((p) => p && (p.quote === 'ZEUR' || p.quote === 'EUR'));
  return eur.length > 0 ? [] : ['aucune paire cotée en EUR'];
});

await check('Kraken Ticker', 'https://api.kraken.com/0/public/Ticker?pair=XBTEUR', (json) => {
  if (!json || !Array.isArray(json.error)) return ['champ error absent'];
  if (json.error.length > 0) return [`erreur Kraken : ${json.error.join(', ')}`];
  const entries = Object.values(json.result ?? {});
  const hit = entries.some((v) => v && Array.isArray(v.c) && isNumericString(v.c[0]));
  return hit ? [] : ['aucun résultat avec c[0] numérique'];
});

await check(
  'Hyperliquid allMids',
  'https://api.hyperliquid.xyz/info',
  (json) => {
    if (!json || typeof json !== 'object') return ['réponse non JSON'];
    return isNumericString(json.BTC) ? [] : ['BTC absent ou non numérique'];
  },
  {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'allMids' }),
  },
);

// Import Hyperliquid (P20) : formes des réponses `info` consommées par `src/lib/import/hyperliquid`,
// interrogées sur l'adresse fictive de la fixture (aucune activité : formes vides mais exactes).
const HL_DEMO_ADDRESS = '0x000000000000000000000000000000000000d3a0';
const hlPost = (body) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

await check(
  'Hyperliquid spotMeta',
  'https://api.hyperliquid.xyz/info',
  (json) => {
    if (!json || !Array.isArray(json.tokens) || !Array.isArray(json.universe))
      return ['tokens/universe absents'];
    const usdc = json.tokens.find((t) => t?.name === 'USDC');
    if (!usdc || usdc.index !== 0) return ['jeton USDC absent ou index ≠ 0'];
    const pair = json.universe[0];
    if (!pair || !Array.isArray(pair.tokens) || typeof pair.name !== 'string' || !isNum(pair.index))
      return ['universe[0] sans tokens/name/index'];
    return [];
  },
  hlPost({ type: 'spotMeta' }),
);

await check(
  'Hyperliquid clearinghouseState',
  'https://api.hyperliquid.xyz/info',
  (json) => {
    const m = json?.marginSummary;
    if (!m || !isNumericString(m.accountValue)) return ['marginSummary.accountValue absent'];
    if (!Array.isArray(json.assetPositions)) return ['assetPositions absent'];
    if (!isNumericString(json.withdrawable)) return ['withdrawable absent'];
    return [];
  },
  hlPost({ type: 'clearinghouseState', user: HL_DEMO_ADDRESS }),
);

await check(
  'Hyperliquid spotClearinghouseState',
  'https://api.hyperliquid.xyz/info',
  (json) => (Array.isArray(json?.balances) ? [] : ['balances absent']),
  hlPost({ type: 'spotClearinghouseState', user: HL_DEMO_ADDRESS }),
);

await check(
  'Hyperliquid userFillsByTime',
  'https://api.hyperliquid.xyz/info',
  (json) => (Array.isArray(json) ? [] : ['réponse non tableau']),
  hlPost({ type: 'userFillsByTime', user: HL_DEMO_ADDRESS, startTime: 0 }),
);

await check(
  'DefiLlama current (coingecko:bitcoin)',
  'https://coins.llama.fi/prices/current/coingecko:bitcoin?searchWidth=4h',
  (json) => {
    const price = json?.coins?.['coingecko:bitcoin']?.price;
    return isNum(price) && price > 0
      ? []
      : ['coins["coingecko:bitcoin"].price absent ou non positif'];
  },
);

// Historique profond (src/lib/history/providers/defillama.ts) : `start` ancré à midi UTC,
// `confidence` au niveau de la série (et non par point comme /batchHistorical), pas de clé.
await check(
  'DefiLlama chart (série quotidienne)',
  'https://coins.llama.fi/chart/coingecko:bitcoin?start=1704110400&span=5&period=1d',
  (json) => {
    const series = json?.coins?.['coingecko:bitcoin'];
    if (!series) return ['coins["coingecko:bitcoin"] absent'];
    const problems = [];
    if (!isNum(series.confidence)) problems.push('confidence non numérique au niveau série');
    const prices = series.prices;
    if (!Array.isArray(prices) || prices.length < 2)
      return [...problems, 'prices absent ou trop court'];
    if (!prices.every((p) => isNum(p?.timestamp) && isNum(p?.price) && p.price > 0)) {
      problems.push('un point sans timestamp/price numériques positifs');
    }
    const gap = prices[1].timestamp - prices[0].timestamp;
    if (Math.abs(gap - 86_400) > 120) problems.push(`écart non journalier : ${gap} s`);
    return problems;
  },
);

// Le fournisseur pagine par fenêtres de 500 points : c'est la borne haute acceptée par l'API
// (`span=501` répond HTTP 400). Si ce plafond baissait, toutes nos requêtes échoueraient d'un coup
// — ce contrôle le détecte avant les utilisateurs.
await check(
  'DefiLlama chart : plafond de 500 points accepté',
  'https://coins.llama.fi/chart/coingecko:bitcoin?start=1704110400&span=500&period=1d',
  (json) => {
    const prices = json?.coins?.['coingecko:bitcoin']?.prices;
    return Array.isArray(prices) && prices.length > 0
      ? []
      : ['span=500 refusé ou série vide : le plafond a peut-être baissé'];
  },
);

await check(
  'Frankfurter (BCE) v1',
  'https://api.frankfurter.dev/v1/2026-08-03..2026-08-07?base=EUR&symbols=USD',
  (json) => {
    const rates = json?.rates;
    if (!rates || typeof rates !== 'object') return ['rates absent'];
    const days = Object.keys(rates);
    if (days.length === 0) return ['aucun jour'];
    if (!days.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && isNum(rates[d]?.USD)))
      return ['rates[jour].USD absent ou non numérique'];
    return [];
  },
);

// On-chain (P25) : adresses publiques CANONIQUES et célèbres uniquement (genesis BTC, vitalik.eth),
// jamais une adresse d'utilisateur — la sonde vérifie la FORME des réponses, pas des soldes.
await check(
  'mempool.space address txs (genesis)',
  'https://mempool.space/api/address/1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa/txs',
  (json) => {
    if (!Array.isArray(json)) return ['réponse non tabulaire'];
    const tx = json.find((t) => t?.status?.confirmed === true);
    if (!tx) return ['aucune transaction confirmée'];
    const problems = [];
    if (typeof tx.txid !== 'string') problems.push('txid absent');
    if (!isNum(tx.status?.block_time)) problems.push('status.block_time non numérique');
    if (!Array.isArray(tx.vout) || !tx.vout.some((o) => isNum(o?.value)))
      problems.push('vout[].value non numérique');
    return problems;
  },
);

await check(
  'Blockscout eth token-transfers (vitalik.eth)',
  'https://eth.blockscout.com/api/v2/addresses/0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045/token-transfers?type=ERC-20',
  (json) => {
    if (!Array.isArray(json?.items)) return ['items absent'];
    const item = json.items[0];
    if (!item) return []; // liste vide possible : la forme de l'enveloppe suffit
    const problems = [];
    const contract = item?.token?.address_hash ?? item?.token?.address;
    if (typeof contract !== 'string') problems.push('token.address_hash absent');
    if (!isNumericString(item?.total?.value)) problems.push('total.value non décimal');
    if (typeof item?.transaction_hash !== 'string') problems.push('transaction_hash absent');
    return problems;
  },
);

// Blockscout a officiellement basculé son trafic vers une Pro API à clé le 1ᵉʳ juillet 2026 ; les
// instances par chaîne répondaient encore sans clé le 24/08/2026. Ce contrôle est là pour que la
// CI nous prévienne le jour où elles s'arrêtent — avant que les utilisateurs ne le découvrent.
// Base est tombée le 30/08/2026 : l'instance répond 500 — six fois sur sept, mesuré le 01/09/2026,
// avec de rares succès isolés qui ne valent pas guérison. Il n'existe pas
// de secours sans clé pour cette chaîne (Routescan : « chain not supported »), et l'application le
// dit à l'utilisateur en l'invitant à fournir une clé gratuite. Rien à corriger dans le code : on
// déclare donc un sursis, et le contrôle continue — c'est lui qui dira si Base revient.
const SURSIS_BASE = {
  depuis: '2026-08-30',
  jusquau: '2027-03-01',
  pourquoi:
    'instance publique éteinte après la bascule de Blockscout vers sa Pro API à clé (1ᵉʳ juillet 2026)',
};

for (const [chain, host, sursis] of [
  ['arbitrum', 'https://arbitrum.blockscout.com', undefined],
  ['base', 'https://base.blockscout.com', SURSIS_BASE],
]) {
  await check(
    `Blockscout ${chain} sans clé (survie de l'API publique)`,
    `${host}/api/v2/addresses/0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045/transactions`,
    (json) => (Array.isArray(json?.items) ? [] : ['items absent : instance passée en Pro API ?']),
    { sursis },
  );
}

await check(
  'Routescan Ethereum sans clé (secours EVM)',
  'https://api.routescan.io/v2/network/mainnet/evm/1/etherscan/api?module=account&action=txlist&address=0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045&page=1&offset=2&sort=desc',
  (json) => {
    if (!Array.isArray(json?.result)) return ['result non tableau : secours indisponible'];
    const row = json.result[0];
    if (!row) return [];
    const problems = [];
    if (!/^\d+$/.test(String(row.timeStamp))) problems.push('timeStamp non entier (secondes)');
    if (!/^\d+$/.test(String(row.value))) problems.push('value non entier (wei)');
    if (typeof row.hash !== 'string') problems.push('hash absent');
    return problems;
  },
);

await check(
  'Etherscan V2 (contrat de rejet sans clé)',
  'https://api.etherscan.io/v2/api?chainid=1&module=account&action=balance&address=0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045&tag=latest',
  (json) =>
    // Sans clé, la réponse ATTENDUE est un rejet explicite. Si elle changeait de forme, notre
    // détection « clé manquante » deviendrait muette.
    typeof json?.result === 'string' && /api key/i.test(json.result)
      ? []
      : ['le rejet « Missing/Invalid API Key » a changé de forme'],
);

await check(
  'alternative.me Fear & Greed (contexte de marché, opt-in)',
  'https://api.alternative.me/fng/?limit=1',
  (json) => {
    const first = Array.isArray(json?.data) ? json.data[0] : null;
    const problems = [];
    if (!first) return ['pas de tableau `data`'];
    // L'app lit trois champs et rien d'autre : value, value_classification, timestamp (secondes).
    if (!isNumericString(String(first.value))) problems.push('`value` non numérique');
    else if (Number(first.value) < 0 || Number(first.value) > 100)
      problems.push('`value` hors de l’échelle 0-100');
    if (typeof first.value_classification !== 'string')
      problems.push('`value_classification` absent');
    if (!isNumericString(String(first.timestamp))) problems.push('`timestamp` non numérique');
    return problems;
  },
);

/*
 * ── Sources des générateurs (décision n° 82) ────────────────────────────────
 *
 * Le calendrier macro et l'instantané des indicateurs sont compilés dans le bundle par
 * `scripts/generate-*.ts`, qui interrogent ces pages depuis la CI. Elles n'étaient couvertes par
 * AUCUN contrôle : un changement de forme ne se serait vu qu'à l'échec du cron.
 *
 * On vérifie ici la **forme réellement consommée** — le marqueur que le parseur cherche — et non la
 * simple disponibilité : une page qui répond 200 en ayant renommé son champ casse le générateur
 * tout aussi sûrement qu'une page morte.
 *
 * **Le BLS est absent, et ce n'est pas un oubli** : son réseau de diffusion refuse tout client
 * non-navigateur, ce qui est précisément la raison d'être de sa table tenue à la main (décision
 * n° 58). Son garde-fou est la barrière à deux étages de la décision n° 72, pas ce fichier.
 */

await check(
  'Trésor US, XML des taux (générateur macro)',
  'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value=2026',
  (_json, _headers, text) => {
    const problems = [];
    if (!text.includes('<entry')) problems.push('aucun <entry> : le flux Atom a changé de forme');
    if (!/<d:NEW_DATE[^>]*>\d{4}-\d{2}-\d{2}/.test(text))
      problems.push('d:NEW_DATE absent ou de format inattendu');
    // Le champ que `parseTreasuryXml` extrait pour le taux nominal à 10 ans.
    if (!/<d:BC_10YEAR[^>]*>/.test(text)) problems.push('d:BC_10YEAR absent');
    return problems;
  },
);

await check(
  'Fed, H.4.1 en CSV (générateur macro)',
  'https://www.federalreserve.gov/datadownload/Output.aspx?rel=H41&series=cc73dc54904678a485aa7d87a81c786f&from=01/01/2015&to=12/31/2035&filetype=csv&label=include&layout=seriescolumn',
  (_json, _headers, text) => {
    // Les colonnes sont choisies par identifiant stable, jamais par libellé (voir generate-macro).
    return text.includes('RESH4R_N.WW')
      ? []
      : ['identifiant de série RESH4R_N.WW absent : la sélection a-t-elle changé ?'];
  },
);

await check(
  'BEA, dates de publication (générateur calendrier)',
  'https://apps.bea.gov/API/signup/release_dates.json',
  (json) => {
    const serie = json?.['Personal Income and Outlays']?.release_dates;
    if (!Array.isArray(serie)) return ['série « Personal Income and Outlays » absente'];
    return serie.length > 0 ? [] : ['série présente mais vide'];
  },
);

await check(
  'Fed, page du calendrier FOMC (générateur calendrier)',
  'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',
  (_json, _headers, text) => {
    const problems = [];
    if (!text.includes('fomc-meeting__month')) problems.push('classe fomc-meeting__month absente');
    if (!text.includes('fomc-meeting__date')) problems.push('classe fomc-meeting__date absente');
    return problems;
  },
);

await check(
  'BCE, calendrier du Conseil des gouverneurs (générateur calendrier)',
  'https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html',
  (_json, _headers, text) => {
    const problems = [];
    // Ce que le parseur cherche vraiment : le balisage `dt`/`dd`, et le marqueur qui distingue une
    // décision de taux d'une réunion non monétaire ou d'une conférence de presse isolée.
    if (!/<dt>\s*\d{2}\/\d{2}\/\d{4}/.test(text)) problems.push('dates <dt> JJ/MM/AAAA absentes');
    if (!/followed by press conference/i.test(text))
      problems.push(
        'marqueur « followed by press conference » absent : le filtre ne trie plus rien',
      );
    return problems;
  },
);

await check(
  'BCE, calendrier de publication de l’IPCH (générateur calendrier)',
  'https://www.ecb.europa.eu/press/calendars/statscal/ges/html/sthicp.en.html',
  (_json, _headers, text) => {
    const problems = [];
    if (!/<dt>\s*\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}/.test(text))
      problems.push('dates <dt> avec heure absentes');
    if (!/flash estimate/i.test(text))
      problems.push(
        'mention « flash estimate » absente : rapide et définitif ne se distinguent plus',
      );
    // Le libellé de fuseau : s'il se met à écrire « CEST », la lecture « heure locale » tombe.
    if (/CEST/.test(text))
      problems.push('la page écrit désormais CEST : revoir la conversion de fuseau');
    return problems;
  },
);

await check(
  'BCE, taux de la facilité de dépôt (générateur macro)',
  'https://data-api.ecb.europa.eu/service/data/FM/D.U2.EUR.4F.KR.DFR.LEV?lastNObservations=1&format=csvdata',
  (_json, _headers, text) => {
    const problems = [];
    // La clé de série ET les colonnes nommées : le parseur dépend des deux, et une réponse 200 qui
    // aurait renommé l'une des deux rendrait une série vide sans rien dire.
    if (!text.includes('FM.D.U2.EUR.4F.KR.DFR.LEV')) problems.push('clé de série absente');
    if (!text.includes('TIME_PERIOD')) problems.push('colonne TIME_PERIOD absente');
    if (!text.includes('OBS_VALUE')) problems.push('colonne OBS_VALUE absente');
    return problems;
  },
  // Le portail de la BCE HONORE la négociation de contenu, contrairement au Trésor et à la Fed :
  // avec l'`accept: application/json` par défaut du contrôleur, il rend du SDMX-JSON et le contrôle
  // validerait un document que le générateur ne lit jamais. Demander la même représentation que lui
  // est la seule façon de vérifier le contrat qui compte.
  { headers: { accept: 'text/csv' } },
);

const stampedAt = new Date().toISOString();
const report = summarise(results, stampedAt.slice(0, 10), stampedAt);

mkdirSync('monitor-results', { recursive: true });
writeFileSync('monitor-results/api-contract.md', report.markdown);
// L'empreinte permet au workflow de ne commenter l'issue que lorsque l'état change.
writeFileSync(
  'monitor-results/contract-state.json',
  `${JSON.stringify(
    { signature: report.signature, failed: report.failed, reprieved: report.reprieved },
    null,
    2,
  )}\n`,
);
console.log(report.markdown);
process.exit(report.ok ? 0 : 1);
