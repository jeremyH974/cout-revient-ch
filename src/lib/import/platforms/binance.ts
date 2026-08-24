/**
 * Binance — trois formats d'export sous UN SEUL convertisseur (`id: 'binance'`), à deux
 * détections/parseurs internes plutôt que deux `PlatformConverter` distincts : les trois partagent
 * la même plateforme et la même logique de frais/devises, et un seul identifiant simplifie le
 * registre (§ périmètre de la tâche : trois nouveaux ids au total pour les trois plateformes).
 * `detect()` reconnaît l'une des trois formes ; `convert()` redétecte la forme (même logique) et
 * délègue.
 *
 * 1. « Statements » (Transaction History) : `User_ID,UTC_Time,Account,Operation,Coin,Change,
 *    Remark` — `User_ID` absent des exports récents, jamais requis. UNE LIGNE = UNE JAMBE ; une
 *    opération complète regroupe plusieurs lignes qui partagent le même `Account` et un `UTC_Time`
 *    à ±1 s (regroupement par ADJACENCE dans l'ordre du fichier, pas un scan global : suppose que
 *    l'export garde les jambes d'une même opération à la suite, ce qui est le cas de l'export
 *    chronologique Binance réel). Les lignes internes (transferts, souscription/rédemption Earn) et
 *    inconnues sont écartées AVANT le regroupement pour ne pas casser l'adjacence d'un groupe
 *    voisin. Les jambes « revenu » (intérêts, staking, airdrops, cashback…) ne sont jamais
 *    regroupées : chaque ligne devient son propre brouillon (un revenu Binance est un événement
 *    autonome par pièce, pas une jambe de trade). Dans un groupe, les jambes de même signe et même
 *    actif sont sommées (Change est signé : négatif = débit) ; si un groupe mélange plusieurs
 *    actifs de même signe (opération composite non prévue par la spec), c'est un `PivotIssue`
 *    explicite plutôt qu'un choix arbitraire. Plusieurs lignes `Fee` dans des actifs différents :
 *    la première est retenue, les suivantes sont mentionnées en description (jamais tues, même
 *    logique que le second frais Kraken). Un groupe qui ne contient qu'un frais (sans jambe
 *    envoyée/reçue) devient une sortie au coût étiquetée `cost` (même choix que Ledger Live).
 *
 * 2. « Trade History » classique : `Date(UTC),Market,Type,Price,Amount,Total,Fee,Fee Coin` —
 *    `Market` est la paire collée sans séparateur (`BTCEUR`) : découpée par une liste de devises de
 *    cotation connues, LES PLUS LONGUES D'ABORD (triée ici par longueur, sans dépendre de l'ordre
 *    de la liste source). `Total` est la contre-valeur brute hors frais.
 *
 * 3. « Trade History » variante « statement » : `Date(UTC),Pair,Side,Price,Executed,Amount,Fee` —
 *    `Executed`, `Amount` et `Fee` sont des chaînes où la quantité et le ticker sont collés
 *    (`0.00025000BTC`, `1,234.56USDT`). `Pair` EST décodée ici, non pour retrouver les devises
 *    (chaque montant porte la sienne) mais pour lever l'ambiguïté d'un ticker commençant par un
 *    chiffre : « 0.51INCH » vaut 0,5 de `1INCH` et non 0,51 de `INCH`, et seule la paire permet de
 *    trancher (`Executed` porte la base, `Amount` la cotation). Sans paire décodable, on retombe
 *    sur le découpage textuel.
 *
 * Aucune contre-valeur EUR n'est inventée : pour un trade, la jambe fiat (EUR/USD) EST déjà
 * `sent`/`received`, donc `netWorth` reste toujours `null` (comme les autres convertisseurs
 * achat/vente de ce registre) ; pour un revenu sans jambe fiat, `netWorth` reste `null` faute de
 * contre-valeur déclarée dans le fichier.
 */
import { D, ZERO, type Big } from '../../domain/money';
import type { PivotAmount } from '../../domain/types';
import type { CsvTable } from '../csv';
import { utcStringToMs } from '../time';
import type { PivotIssue } from '../pivot/rows';
import {
  canonHeader,
  type PlatformConversion,
  type PlatformConverter,
  type PlatformDraft,
} from './types';

const STATEMENTS_REQUIRED = ['utc_time', 'account', 'operation', 'coin', 'change'];
const TRADES_CLASSIC_REQUIRED = [
  'date(utc)',
  'market',
  'type',
  'price',
  'amount',
  'total',
  'fee',
  'fee coin',
];
const TRADES_STATEMENT_REQUIRED = [
  'date(utc)',
  'pair',
  'side',
  'price',
  'executed',
  'amount',
  'fee',
];

type BinanceShape = 'statements' | 'trades-classic' | 'trades-statement';

function detectShape(canonical: readonly string[]): BinanceShape | null {
  const has = (name: string): boolean => canonical.includes(name);
  if (STATEMENTS_REQUIRED.every(has)) return 'statements';
  if (TRADES_CLASSIC_REQUIRED.every(has)) return 'trades-classic';
  if (TRADES_STATEMENT_REQUIRED.every(has)) return 'trades-statement';
  return null;
}

/** Normalisation d'une valeur de cellule (pas d'en-tête) : espaces multiples inclus. */
const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ');

// --- Format 1 : Statements ---------------------------------------------------------------------

const TRADE_OPS = new Set([
  'buy',
  'sell',
  'transaction buy',
  'transaction sold',
  'transaction spend',
  'transaction revenue',
  'transaction related',
]);
const FEE_OPS = new Set(['fee', 'transaction fee']);
const MOVEMENT_OPS = new Set([
  'deposit',
  'fiat deposit',
  'withdraw',
  'withdrawal',
  'fiat withdraw',
  'fiat withdrawal',
  'send',
]);
const REWARD_OPS = new Set([
  'savings interest',
  'simple earn flexible interest',
  'simple earn locked interest',
  'staking rewards',
  'eth 2.0 staking rewards',
  'launchpool interest',
  'bnb vault rewards',
  'distribution',
  'airdrop assets',
  'hodler airdrops distribution',
  'commission history',
  'referral commission',
  'cashback voucher',
]);
/** Souscription/rédemption Earn et staking : mouvement interne, jamais un `PivotIssue`. */
const INTERNAL_EXACT_OPS = new Set([
  'staking purchase',
  'staking redemption',
  'simple earn flexible subscription',
  'simple earn flexible redemption',
]);
const isInternalOp = (op: string): boolean => op.includes('transfer') || INTERNAL_EXACT_OPS.has(op);

interface StatementRow {
  lineNo: number;
  native: string;
  timeMs: number;
  account: string;
  operationRaw: string;
  operation: string;
  coin: string;
  change: Big;
}

function convertStatements(table: CsvTable, canonical: readonly string[]): PlatformConversion {
  const col = (name: string): number => canonical.indexOf(name);
  const c = {
    utcTime: col('utc_time'),
    account: col('account'),
    operation: col('operation'),
    coin: col('coin'),
    change: col('change'),
  };
  const drafts: PlatformDraft[] = [];
  const issues: PivotIssue[] = [];
  let skippedInternal = 0;
  const groupable: StatementRow[] = [];

  table.rows.forEach((cells, i) => {
    const lineNo = table.lineNumbers[i]!;
    const cell = (index: number): string => (index >= 0 ? (cells[index] ?? '').trim() : '');
    const native = cells.map((x) => (x ?? '').trim()).join('|');

    const rawTime = cell(c.utcTime);
    const timeMs = utcStringToMs(rawTime);
    if (timeMs === null) {
      issues.push({
        lineNo,
        message: `Date Binance illisible « ${rawTime} » (UTC_Time attendu en UTC).`,
      });
      return;
    }
    const operationRaw = cell(c.operation);
    const operation = norm(operationRaw);
    const account = cell(c.account);
    const coin = cell(c.coin).toLowerCase();
    let change: Big;
    try {
      change = D(cell(c.change) === '' ? '0' : cell(c.change));
    } catch {
      issues.push({ lineNo, message: `Montant Binance illisible « ${cell(c.change)} » (Change).` });
      return;
    }

    if (isInternalOp(operation)) {
      skippedInternal++;
      return;
    }

    if (REWARD_OPS.has(operation)) {
      const qty = change.abs();
      if (qty.lte(ZERO)) {
        issues.push({
          lineNo,
          message: `Revenu Binance « ${operationRaw} » de quantité nulle ou illisible (Change « ${cell(c.change)} »).`,
        });
        return;
      }
      drafts.push({
        lineNo,
        nativeContent: native,
        timeMs,
        sent: null,
        received: { amount: qty.toString(), currency: coin },
        fee: null,
        netWorth: null,
        label: 'reward',
        description: null,
        txHash: null,
      });
      return;
    }

    if (TRADE_OPS.has(operation) || FEE_OPS.has(operation) || MOVEMENT_OPS.has(operation)) {
      groupable.push({ lineNo, native, timeMs, account, operationRaw, operation, coin, change });
      return;
    }

    issues.push({
      lineNo,
      message: `Opération Binance inconnue « ${operationRaw} » : ligne non importée.`,
    });
  });

  // Regroupement par adjacence : même Account, même horodatage à ±1 s du 1er élément du groupe
  // (les lignes internes/inconnues/revenu ont déjà été retirées ci-dessus, donc ne peuvent pas
  // couper l'adjacence d'un groupe voisin).
  const groups: StatementRow[][] = [];
  for (const row of groupable) {
    const current = groups[groups.length - 1];
    const anchor = current?.[0];
    if (
      current &&
      anchor &&
      anchor.account === row.account &&
      Math.abs(row.timeMs - anchor.timeMs) <= 1000
    ) {
      current.push(row);
    } else {
      groups.push([row]);
    }
  }

  const foldLegs = (
    rows: readonly StatementRow[],
  ): { leg: PivotAmount | null; assets: string[] } => {
    if (rows.length === 0) return { leg: null, assets: [] };
    const byAsset = new Map<string, Big>();
    for (const r of rows) byAsset.set(r.coin, (byAsset.get(r.coin) ?? ZERO).plus(r.change.abs()));
    const assets = [...byAsset.keys()];
    if (assets.length > 1) return { leg: null, assets };
    const asset = assets[0]!;
    return { leg: { amount: byAsset.get(asset)!.toString(), currency: asset }, assets };
  };

  for (const group of groups) {
    const feeRows = group.filter((r) => FEE_OPS.has(r.operation));
    const moveRows = group.filter((r) => !FEE_OPS.has(r.operation));
    const zeroMove = moveRows.find((r) => r.change.eq(ZERO));
    if (zeroMove) {
      issues.push({
        lineNo: zeroMove.lineNo,
        message: `Binance : variation nulle pour « ${zeroMove.operationRaw} » (${zeroMove.coin.toUpperCase()}), ligne ignorée.`,
      });
    }
    const usableMoves = moveRows.filter((r) => !r.change.eq(ZERO));

    const sentFold = foldLegs(usableMoves.filter((r) => r.change.lt(ZERO)));
    const receivedFold = foldLegs(usableMoves.filter((r) => r.change.gt(ZERO)));
    if (sentFold.assets.length > 1 || receivedFold.assets.length > 1) {
      const bad = [...sentFold.assets, ...receivedFold.assets].map((a) => a.toUpperCase());
      issues.push({
        lineNo: Math.min(...group.map((r) => r.lineNo)),
        message: `Binance : opération composite non reconnue (${bad.join(', ')}) au même horodatage/compte : qualifiez l'opération à la main.`,
      });
      continue;
    }

    const notes: string[] = [];
    let fee: PivotAmount | null = null;
    if (feeRows.length > 0) {
      const byAsset = new Map<string, Big>();
      for (const r of feeRows)
        byAsset.set(r.coin, (byAsset.get(r.coin) ?? ZERO).plus(r.change.abs()));
      const entries = [...byAsset.entries()];
      const first = entries[0];
      if (first) {
        fee = { amount: first[1].toString(), currency: first[0] };
        for (const [asset, amount] of entries.slice(1)) {
          notes.push(`second frais ${amount.toString()} ${asset.toUpperCase()} non déduit`);
        }
      }
    }

    let sent = sentFold.leg;
    const received = receivedFold.leg;
    let label: string | null = null;
    if (sent === null && received === null) {
      if (fee === null) continue; // groupe entièrement vide (n'arrive pas en pratique)
      sent = fee;
      fee = null;
      label = 'cost';
    }

    const ordered = [...group].sort((a, b) => a.lineNo - b.lineNo);
    drafts.push({
      lineNo: ordered[0]!.lineNo,
      nativeContent: ordered.map((r) => r.native).join('||'),
      timeMs: Math.min(...group.map((r) => r.timeMs)),
      sent,
      received,
      fee,
      netWorth: null,
      label,
      description: notes.length > 0 ? `Binance : ${notes.join(' ; ')}.` : null,
      txHash: null,
    });
  }

  return { drafts, issues, skippedInternal };
}

// --- Formats 2 & 3 : Trade History ---------------------------------------------------------------

/** Devises de cotation connues, triées par longueur décroissante (évite `BTCUSDT` → `BTCUSD`+`T`). */
const QUOTES = [
  'USDT',
  'USDC',
  'FDUSD',
  'TUSD',
  'BUSD',
  'EUR',
  'USD',
  'GBP',
  'TRY',
  'BTC',
  'ETH',
  'BNB',
].sort((a, b) => b.length - a.length);

export function splitBinancePair(pair: string): { base: string; quote: string } | null {
  const upper = pair.trim().toUpperCase();
  for (const quote of QUOTES) {
    if (upper.endsWith(quote) && upper.length > quote.length) {
      return {
        base: upper.slice(0, upper.length - quote.length).toLowerCase(),
        quote: quote.toLowerCase(),
      };
    }
  }
  return null;
}

const GLUED_RE = /^([\d,]+(?:\.\d+)?)([A-Za-z0-9]+)$/;

/** `0.00025000BTC` / `1,234.56USDT` → montant + devise. Limite connue : ticker débutant par un
 *  chiffre (`1INCH`) ambigu, voir docstring d'en-tête. */
/**
 * Quantité et ticker collés (`0.00025000BTC`, `1,234.56USDT`). `expected` est la devise attendue
 * quand on la connaît par ailleurs (la paire de la ligne) : elle est alors découpée par SUFFIXE,
 * ce qui est la seule façon de lire correctement un ticker commençant par un chiffre — `0.51INCH`
 * vaut 0,5 de `1INCH`, pas 0,51 de `INCH`, et aucune regex ne peut le deviner seule.
 */
export function parseGluedAmount(raw: string, expected?: string): PivotAmount | null {
  const trimmed = raw.trim();
  const isAmount = (value: string): boolean => /^\d+(\.\d+)?$/.test(value);
  if (expected !== undefined && expected !== '') {
    const suffix = expected.toUpperCase();
    if (trimmed.toUpperCase().endsWith(suffix)) {
      const amount = trimmed.slice(0, trimmed.length - suffix.length).replace(/,/g, '');
      if (isAmount(amount)) return { amount, currency: expected.toLowerCase() };
    }
  }
  const m = GLUED_RE.exec(trimmed);
  if (!m) return null;
  const amount = m[1]!.replace(/,/g, '');
  if (!isAmount(amount)) return null;
  return { amount, currency: m[2]!.toLowerCase() };
}

function convertTradesClassic(table: CsvTable, canonical: readonly string[]): PlatformConversion {
  const col = (name: string): number => canonical.indexOf(name);
  const c = {
    date: col('date(utc)'),
    market: col('market'),
    type: col('type'),
    amount: col('amount'),
    total: col('total'),
    fee: col('fee'),
    feeCoin: col('fee coin'),
  };
  const drafts: PlatformDraft[] = [];
  const issues: PivotIssue[] = [];

  table.rows.forEach((cells, i) => {
    const lineNo = table.lineNumbers[i]!;
    const cell = (index: number): string => (index >= 0 ? (cells[index] ?? '').trim() : '');
    const native = cells.map((x) => (x ?? '').trim()).join('|');

    const rawDate = cell(c.date);
    const timeMs = utcStringToMs(rawDate);
    if (timeMs === null) {
      issues.push({ lineNo, message: `Date Binance Trade History illisible « ${rawDate} ».` });
      return;
    }
    const market = cell(c.market);
    const pair = splitBinancePair(market);
    if (!pair) {
      issues.push({
        lineNo,
        message: `Paire Binance illisible « ${market} » (devise de cotation inconnue).`,
      });
      return;
    }
    const type = cell(c.type).toUpperCase();
    if (type !== 'BUY' && type !== 'SELL') {
      issues.push({ lineNo, message: `Type Binance Trade History inconnu « ${cell(c.type)} ».` });
      return;
    }
    let qty: Big;
    let total: Big;
    let fee: Big;
    try {
      qty = D(cell(c.amount) === '' ? '0' : cell(c.amount)).abs();
      total = D(cell(c.total) === '' ? '0' : cell(c.total)).abs();
      fee = D(cell(c.fee) === '' ? '0' : cell(c.fee)).abs();
    } catch {
      issues.push({
        lineNo,
        message: `Montant Binance Trade History illisible (Amount « ${cell(c.amount)} », Total « ${cell(c.total)} » ou Fee « ${cell(c.fee)} »).`,
      });
      return;
    }
    if (qty.lte(ZERO) || total.lte(ZERO)) {
      issues.push({
        lineNo,
        message: `Quantité ou Total Binance nul (Amount « ${cell(c.amount)} », Total « ${cell(c.total)} »).`,
      });
      return;
    }
    const baseLeg: PivotAmount = { amount: qty.toString(), currency: pair.base };
    const quoteLeg: PivotAmount = { amount: total.toString(), currency: pair.quote };
    const feeCoin = cell(c.feeCoin).toLowerCase();
    let feeLeg: PivotAmount | null = null;
    if (fee.gt(ZERO)) {
      if (feeCoin === '') {
        issues.push({
          lineNo,
          message: `Frais Binance Trade History « ${cell(c.fee)} » sans devise (Fee Coin manquant).`,
        });
        return;
      }
      feeLeg = { amount: fee.toString(), currency: feeCoin };
    }

    drafts.push({
      lineNo,
      nativeContent: native,
      timeMs,
      sent: type === 'BUY' ? quoteLeg : baseLeg,
      received: type === 'BUY' ? baseLeg : quoteLeg,
      fee: feeLeg,
      netWorth: null,
      label: null,
      description: null,
      txHash: null,
    });
  });

  return { drafts, issues, skippedInternal: 0 };
}

function convertTradesStatement(table: CsvTable, canonical: readonly string[]): PlatformConversion {
  const col = (name: string): number => canonical.indexOf(name);
  const c = {
    date: col('date(utc)'),
    pair: col('pair'),
    side: col('side'),
    executed: col('executed'),
    amount: col('amount'),
    fee: col('fee'),
  };
  const drafts: PlatformDraft[] = [];
  const issues: PivotIssue[] = [];

  table.rows.forEach((cells, i) => {
    const lineNo = table.lineNumbers[i]!;
    const cell = (index: number): string => (index >= 0 ? (cells[index] ?? '').trim() : '');
    const native = cells.map((x) => (x ?? '').trim()).join('|');

    const rawDate = cell(c.date);
    const timeMs = utcStringToMs(rawDate);
    if (timeMs === null) {
      issues.push({ lineNo, message: `Date Binance Trade History illisible « ${rawDate} ».` });
      return;
    }
    const side = cell(c.side).toUpperCase();
    if (side !== 'BUY' && side !== 'SELL') {
      issues.push({ lineNo, message: `Side Binance Trade History inconnu « ${cell(c.side)} ».` });
      return;
    }
    // `Pair` lève l'ambiguïté que la seule chaîne collée ne peut pas trancher : « 0.51INCH » se lit
    // « 0.5 » de 1INCH ou « 0.51 » de INCH selon le ticker. Or `Executed` porte toujours l'actif de
    // BASE et `Amount` la devise de COTATION, et la cotation appartient à une liste courte connue.
    // On préfère donc les devises déduites de la paire, et on ne retombe sur celles du texte que si
    // la paire est indécodable.
    const pair = splitBinancePair(cell(c.pair));
    const executed = parseGluedAmount(cell(c.executed), pair?.base);
    const amount = parseGluedAmount(cell(c.amount), pair?.quote);
    if (!executed || !amount) {
      issues.push({
        lineNo,
        message: `Montant Binance Trade History illisible (Executed « ${cell(c.executed)} » ou Amount « ${cell(c.amount)} »).`,
      });
      return;
    }
    const rawFee = cell(c.fee);
    let feeLeg: PivotAmount | null = null;
    if (rawFee !== '') {
      const fee = parseGluedAmount(rawFee);
      if (!fee) {
        issues.push({ lineNo, message: `Frais Binance Trade History illisibles « ${rawFee} ».` });
        return;
      }
      if (D(fee.amount).gt(ZERO)) feeLeg = fee;
    }

    drafts.push({
      lineNo,
      nativeContent: native,
      timeMs,
      sent: side === 'BUY' ? amount : executed,
      received: side === 'BUY' ? executed : amount,
      fee: feeLeg,
      netWorth: null,
      label: null,
      description: null,
      txHash: null,
    });
  });

  return { drafts, issues, skippedInternal: 0 };
}

export const binance: PlatformConverter = {
  id: 'binance',
  label: 'Binance — historique (Statements ou Trade History)',
  detect(header) {
    return detectShape(header.map(canonHeader)) !== null;
  },
  convert(table: CsvTable) {
    const canonical = table.header.map(canonHeader);
    const shape = detectShape(canonical);
    switch (shape) {
      case 'statements':
        return convertStatements(table, canonical);
      case 'trades-classic':
        return convertTradesClassic(table, canonical);
      case 'trades-statement':
        return convertTradesStatement(table, canonical);
      default:
        return {
          drafts: [],
          issues: [
            { lineNo: 1, message: 'Format Binance non reconnu (incohérence detect/convert).' },
          ],
          skippedInternal: 0,
        };
    }
  },
};
