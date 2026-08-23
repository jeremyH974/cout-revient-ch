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
