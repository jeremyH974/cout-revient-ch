#!/usr/bin/env node
/**
 * Tests de contrat des API tierces utilisées par l'application : on vérifie que chaque fournisseur
 * répond encore avec la forme exacte que le code consomme (champs, types, ordre des chandelles).
 * Lancé par la surveillance planifiée ; écrit un résumé Markdown et sort en erreur au moindre écart.
 *
 * Aucune clé, aucune donnée personnelle : seules des requêtes publiques sur BTC/EUR et EUR/USD.
 */
import { mkdirSync, writeFileSync } from 'node:fs';

const TIMEOUT_MS = 15_000;
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

async function check(name, url, validate, options = {}) {
  const started = Date.now();
  try {
    const r = await fetchJson(url, options);
    const problems = r.status === 200 ? validate(r.json, r.headers) : [`HTTP ${r.status}`];
    results.push({
      name,
      url,
      ok: problems.length === 0,
      ms: Date.now() - started,
      detail: problems.join(' ; ') || 'conforme',
      rateLimit: [...r.headers.entries()]
        .filter(([k]) => /ratelimit|retry-after/i.test(k))
        .map(([k, v]) => `${k}=${v}`)
        .join(', '),
    });
  } catch (error) {
    results.push({
      name,
      url,
      ok: false,
      ms: Date.now() - started,
      detail: `erreur réseau : ${error instanceof Error ? error.message : String(error)}`,
      rateLimit: '',
    });
  }
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

const failed = results.filter((r) => !r.ok);
const lines = [
  `# Contrat des API tierces — ${new Date().toISOString()}`,
  '',
  '| Fournisseur | État | Délai | Détail | Limites |',
  '| --- | --- | --- | --- | --- |',
  ...results.map(
    (r) =>
      `| ${r.name} | ${r.ok ? '✅' : '❌'} | ${r.ms} ms | ${r.detail.replace(/\|/g, '/')} | ${r.rateLimit || '—'} |`,
  ),
  '',
  failed.length === 0
    ? 'Tous les fournisseurs répondent avec la forme attendue.'
    : `${failed.length} fournisseur(s) en écart : ${failed.map((r) => r.name).join(', ')}.`,
];
mkdirSync('monitor-results', { recursive: true });
writeFileSync('monitor-results/api-contract.md', lines.join('\n'));
console.log(lines.join('\n'));
process.exit(failed.length === 0 ? 0 : 1);
