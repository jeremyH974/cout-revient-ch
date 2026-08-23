/**
 * Jeu de démonstration Hyperliquid **entièrement synthétique** (P20, adresse fictive).
 *   node scripts/generate-hl-fixture.ts   →   tests/fixtures/hyperliquid/demo.json
 *
 * Déterministe : mulberry32 à graine fixe, aucune horloge, aucune adresse réelle — tout est
 * inventé (adresse démo, contrepartie du transfert spot, montants, dates, prix). Le scénario
 * (mars → 20 août 2026) couvre :
 *   - le grand livre (2 dépôts, 2 transferts spot ↔ perps, un transfert spot entrant d'un autre
 *     compte, un retrait) ;
 *   - 14 fills spot sur deux paires (`PURR/USDC` canonique, `@107` = HYPE/USDC) ;
 *   - ~60 fills perps sur BTC (long ouvert en 3 tranches puis clôturé en gain), ETH (short ouvert
 *     puis retourné en long, clôturé en perte), HYPE (long liquidé) et SOL (accumulation encore
 *     ouverte à l'instantané final) ;
 *   - le funding toutes les 8h (00:00/08:00/16:00 UTC) pour chaque position perp ouverte ;
 *   - un instantané (`clearinghouseState` / `spotClearinghouseState`) dont l'équité est la somme
 *     exacte de tout ce qui précède, vérifiée par `tests/integration/hl-fixture.test.ts`
 *     (réconciliation du moteur Trading, `src/lib/domain/trading/compute.ts`).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import Big from 'big.js';
import type { HlFixture } from '../src/lib/import/hyperliquid/fixture-client';

// Même configuration que `src/lib/domain/money.ts` (script autonome, exécuté hors Vite).
Big.DP = 30;
Big.RM = Big.roundHalfEven;
Big.NE = -30;
Big.PE = 40;
Big.strict = true;

export const HL_FIXTURE_PATH = 'tests/fixtures/hyperliquid/demo.json';
export const HL_DEMO_ADDRESS = '0x000000000000000000000000000000000000d3a0';
/** Expéditeur inventé du transfert spot entrant : jamais synchronisé par l'app. */
const FOREIGN_ADDRESS = `0x${'f00dfeed'.padStart(40, '0')}`;

const SEED = 20260320;
const HALF_UP = Big.roundHalfUp;
const ZERO = new Big('0');

const TAKER_RATE = '0.00045';
const MAKER_RATE = '0.00015';
const MAKER_REBATE_RATE = '-0.00003';
const SPOT_FEE_RATE = '0.0007';

const CURVE_START = Date.UTC(2026, 2, 1);
const CURVE_END = Date.UTC(2026, 7, 20);
const SNAPSHOT_TIME = Date.UTC(2026, 7, 20, 12, 0, 0);

type PerpCoin = 'BTC' | 'ETH' | 'HYPE' | 'SOL';
const PERP_COINS: readonly PerpCoin[] = ['BTC', 'ETH', 'HYPE', 'SOL'];

/** mulberry32 : même graine → même suite sur toute plateforme (arithmétique entière 32 bits). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ms = (y: number, m: number, d: number, h = 0, mi = 0, s = 0): number =>
  Date.UTC(y, m - 1, d, h, mi, s);

const round = (value: Big, dp: number): Big => value.round(dp, HALF_UP);

/** `toFixed` sans zéros de fin inutiles, mais toujours une décimale (style de l'API : « 66000.0 »). */
function fmt(value: Big): string {
  return value
    .toFixed(10)
    .replace(/(\.\d*?[1-9])0+$/, '$1')
    .replace(/\.0+$/, '.0');
}

function hex(rnd: () => number, len: number): string {
  let out = '';
  for (let i = 0; i < len; i++) out += Math.floor(rnd() * 16).toString(16);
  return out;
}

const sign = (b: Big): -1 | 0 | 1 => (b.eq(ZERO) ? 0 : b.lt(ZERO) ? -1 : 1);

/** Instants de règlement du funding (00:00/08:00/16:00 UTC) dans `[fromMs, toMs]`. */
function fundingCheckpoints(fromMs: number, toMs: number): number[] {
  const out: number[] = [];
  const start = new Date(fromMs);
  const dayStart = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  for (let day = dayStart; day <= toMs; day += 86_400_000) {
    for (const h of [0, 8, 16]) {
      const t = day + h * 3_600_000;
      if (t >= fromMs && t <= toMs) out.push(t);
    }
  }
  return out;
}

/** Un fill brut, avant conversion en chaînes décimales pour le JSON final. */
interface FillRecord {
  coin: string;
  px: Big;
  sz: Big;
  side: 'A' | 'B';
  time: number;
  startPosition: Big;
  dir: string;
  closedPnl: Big;
  hash: string;
  oid: number;
  crossed: boolean;
  fee: Big;
  tid: number;
  feeToken: string;
  builderFee: Big | null;
  liquidation: { markPx: Big } | null;
}

export function generateHlFixture(): HlFixture {
  const rnd = mulberry32(SEED);
  let tidCounter = 900450001000;
  let oidCounter = 500220000000;
  let nonceCounter = 771000001;
  const nextNonce = (): number => nonceCounter++;

  // --- Positions perps : état + chronologie (pour le funding) -------------------------------
  const perpState = new Map<PerpCoin, { position: Big; avgEntry: Big }>();
  const perpTimeline = new Map<PerpCoin, { time: number; position: Big }[]>();
  for (const c of PERP_COINS) {
    perpState.set(c, { position: ZERO, avgEntry: ZERO });
    perpTimeline.set(c, []);
  }
  const positionAt = (coin: PerpCoin, t: number): Big => {
    const timeline = perpTimeline.get(coin)!;
    let result = ZERO;
    for (const point of timeline) {
      if (point.time <= t) result = point.position;
      else break;
    }
    return result;
  };

  let totalRealized = ZERO;
  let totalPerpFees = ZERO;
  const perpFills: FillRecord[] = [];

  /** Comptabilité perp complète (chaîne startPosition, avgEntry pondéré, closedPnl, dir, frais). */
  function applyPerpFill(
    coin: PerpCoin,
    time: number,
    side: 'A' | 'B',
    szStr: string,
    pxStr: string,
    crossed: boolean,
    feeMode: 'taker' | 'maker' | 'rebate',
    builderFee: string | null,
    liquidation: boolean,
  ): FillRecord {
    const st = perpState.get(coin)!;
    const start = st.position;
    const sz = new Big(szStr);
    const px = new Big(pxStr);
    const delta = side === 'B' ? sz : sz.neg();
    const next = start.plus(delta);
    const startSign = sign(start);
    const nextSign = sign(next);
    let dir: string;
    let closedPnlRaw = ZERO;

    if (startSign === 0) {
      dir = side === 'B' ? 'Open Long' : 'Open Short';
      st.avgEntry = px;
    } else if (nextSign === 0) {
      dir = startSign > 0 ? 'Close Long' : 'Close Short';
      closedPnlRaw =
        startSign > 0 ? px.minus(st.avgEntry).times(sz) : st.avgEntry.minus(px).times(sz);
      st.avgEntry = ZERO;
    } else if (nextSign === startSign) {
      if (next.abs().gt(start.abs())) {
        dir = startSign > 0 ? 'Open Long' : 'Open Short';
        const oldNotional = st.avgEntry.times(start.abs());
        st.avgEntry = oldNotional.plus(px.times(sz)).div(next.abs());
      } else {
        dir = startSign > 0 ? 'Close Long' : 'Close Short';
        closedPnlRaw =
          startSign > 0 ? px.minus(st.avgEntry).times(sz) : st.avgEntry.minus(px).times(sz);
      }
    } else {
      dir = startSign > 0 ? 'Long > Short' : 'Short > Long';
      const closedQty = start.abs();
      closedPnlRaw =
        startSign > 0
          ? px.minus(st.avgEntry).times(closedQty)
          : st.avgEntry.minus(px).times(closedQty);
      st.avgEntry = px;
    }
    if (liquidation) dir = startSign > 0 ? 'Close Long' : 'Close Short';
    st.position = next;
    perpTimeline.get(coin)!.push({ time, position: next });

    const closedPnl = round(closedPnlRaw, 6);
    totalRealized = totalRealized.plus(closedPnl);

    const notional = px.times(sz);
    const rate =
      feeMode === 'taker' ? TAKER_RATE : feeMode === 'maker' ? MAKER_RATE : MAKER_REBATE_RATE;
    let fee = round(notional.times(rate), 6);
    const builderFeeBig = builderFee !== null ? new Big(builderFee) : null;
    if (builderFeeBig) fee = fee.plus(builderFeeBig);
    totalPerpFees = totalPerpFees.plus(fee);

    const record: FillRecord = {
      coin,
      px,
      sz,
      side,
      time,
      startPosition: start,
      dir,
      closedPnl,
      hash: `0x${hex(rnd, 64)}`,
      oid: 0,
      crossed,
      fee,
      tid: 0,
      feeToken: 'USDC',
      builderFee: builderFeeBig,
      liquidation: liquidation ? { markPx: px } : null,
    };
    perpFills.push(record);
    return record;
  }

  // --- BTC : long ouvert en 3 tranches (même oid), clôturé partiellement puis totalement -----
  const btcF1 = applyPerpFill(
    'BTC',
    ms(2026, 8, 1, 9, 0, 0),
    'B',
    '0.05',
    '62000',
    true,
    'taker',
    '0.05',
    false,
  );
  const btcF2 = applyPerpFill(
    'BTC',
    ms(2026, 8, 1, 17, 0, 0),
    'B',
    '0.05',
    '62300',
    false,
    'maker',
    null,
    false,
  );
  const btcF3 = applyPerpFill(
    'BTC',
    ms(2026, 8, 2, 9, 0, 0),
    'B',
    '0.05',
    '62800',
    true,
    'taker',
    null,
    false,
  );
  const btcOpenOid = oidCounter++;
  btcF1.oid = btcOpenOid;
  btcF2.oid = btcOpenOid;
  btcF3.oid = btcOpenOid;

  for (let i = 0; i < 12; i++) {
    const t = ms(2026, 8, 3, 1 + i * 2, 0, 0);
    const px = (63200 + i * ((65100 - 63200) / 11)).toFixed(1);
    const crossed = i % 3 !== 2;
    applyPerpFill('BTC', t, 'A', '0.01', px, crossed, crossed ? 'taker' : 'maker', null, false);
  }
  applyPerpFill(
    'BTC',
    ms(2026, 8, 4, 8, 15, 0),
    'A',
    '0.03',
    '65900',
    false,
    'rebate',
    null,
    false,
  );

  // --- ETH : short ouvert (3 tranches), retourné en long (un fill), clôturé en perte ---------
  applyPerpFill('ETH', ms(2026, 8, 5, 9, 0, 0), 'A', '0.5', '2300', true, 'taker', null, false);
  applyPerpFill('ETH', ms(2026, 8, 5, 13, 0, 0), 'A', '0.4', '2320', false, 'rebate', null, false);
  applyPerpFill('ETH', ms(2026, 8, 5, 17, 0, 0), 'A', '0.3', '2340', true, 'taker', null, false);
  applyPerpFill('ETH', ms(2026, 8, 6, 12, 0, 0), 'B', '2.0', '2400', true, 'taker', null, false);

  const ethCloseTimes = [
    ms(2026, 8, 6, 14, 0, 0),
    ms(2026, 8, 6, 15, 30, 0),
    ms(2026, 8, 6, 17, 0, 0),
    ms(2026, 8, 6, 18, 30, 0),
    ms(2026, 8, 6, 20, 0, 0),
    ms(2026, 8, 6, 21, 30, 0),
    ms(2026, 8, 6, 23, 0, 0),
    ms(2026, 8, 7, 0, 30, 0),
  ];
  const ethClosePrices = [2390, 2380, 2375, 2365, 2360, 2355, 2352, 2345];
  for (let i = 0; i < ethCloseTimes.length; i++) {
    const crossed = i % 2 === 0;
    applyPerpFill(
      'ETH',
      ethCloseTimes[i]!,
      'A',
      '0.09',
      String(ethClosePrices[i]!),
      crossed,
      crossed ? 'taker' : 'maker',
      null,
      false,
    );
  }
  applyPerpFill('ETH', ms(2026, 8, 7, 10, 0, 0), 'A', '0.08', '2340', true, 'taker', null, false);

  // --- HYPE : long ouvert en 4 tranches, liquidé en 2 fills (partiel puis total) -------------
  applyPerpFill('HYPE', ms(2026, 8, 8, 9, 0, 0), 'B', '15', '32.4', true, 'taker', null, false);
  applyPerpFill('HYPE', ms(2026, 8, 8, 13, 0, 0), 'B', '10', '32.6', false, 'maker', null, false);
  applyPerpFill('HYPE', ms(2026, 8, 8, 17, 0, 0), 'B', '15', '32.8', true, 'taker', null, false);
  applyPerpFill('HYPE', ms(2026, 8, 9, 9, 0, 0), 'B', '10', '33.0', true, 'taker', null, false);
  applyPerpFill('HYPE', ms(2026, 8, 10, 13, 0, 0), 'A', '30', '29.5', true, 'taker', null, true);
  applyPerpFill('HYPE', ms(2026, 8, 10, 13, 2, 0), 'A', '20', '29.0', true, 'taker', null, true);

  // --- SOL : accumulation en 25 tranches, encore ouverte à l'instantané -----------------------
  const solStart = ms(2026, 8, 14, 9, 17, 0);
  let lastSolTime = solStart;
  for (let i = 0; i < 25; i++) {
    const t = solStart + i * 5 * 3_600_000;
    const sizeStr = (0.4 + rnd() * 0.4).toFixed(3);
    const priceStr = (95 + i * 0.5 + (rnd() - 0.5) * 2).toFixed(2);
    const crossed = i % 2 === 0;
    applyPerpFill(
      'SOL',
      t,
      'B',
      sizeStr,
      priceStr,
      crossed,
      crossed ? 'taker' : 'maker',
      null,
      false,
    );
    lastSolTime = t;
  }

  // --- Funding : toutes les 8h par position perp ouverte -------------------------------------
  const fundingRecords: {
    time: number;
    hash: string;
    coin: PerpCoin;
    usdc: Big;
    szi: Big;
    fundingRate: Big;
  }[] = [];
  let totalFunding = ZERO;
  function generateFunding(coin: PerpCoin, fromMs: number, toMs: number, markPrice: string): Big {
    let sum = ZERO;
    for (const t of fundingCheckpoints(fromMs, toMs)) {
      const szi = positionAt(coin, t);
      if (szi.eq(ZERO)) continue;
      const rate = new Big((0.00008 + rnd() * 0.00006).toFixed(8));
      const usdc = round(new Big(markPrice).times(szi).times(rate).neg(), 6);
      sum = sum.plus(usdc);
      totalFunding = totalFunding.plus(usdc);
      fundingRecords.push({
        time: t,
        hash: `0x${hex(rnd, 64)}`,
        coin,
        usdc,
        szi,
        fundingRate: rate,
      });
    }
    return sum;
  }
  generateFunding('BTC', ms(2026, 8, 1, 9, 0, 0), ms(2026, 8, 4, 8, 15, 0), '64000');
  generateFunding('ETH', ms(2026, 8, 5, 9, 0, 0), ms(2026, 8, 7, 10, 0, 0), '2350');
  generateFunding('HYPE', ms(2026, 8, 8, 9, 0, 0), ms(2026, 8, 10, 13, 2, 0), '32.6');
  const solFundingSum = generateFunding('SOL', solStart, SNAPSHOT_TIME, '102');
  const solSinceChange = fundingRecords
    .filter((r) => r.coin === 'SOL' && r.time > lastSolTime)
    .reduce((acc, r) => acc.plus(r.usdc), ZERO);

  // --- Grand livre + spot : dépôts, transferts, retrait, 14 fills PURR/HYPE ------------------
  const spotBalances = { usdc: ZERO, purr: ZERO, hype: ZERO };
  const spotEntryNtl = { purr: ZERO, hype: ZERO };
  const spotFills: FillRecord[] = [];
  let netFlows = ZERO;
  const ledger: { time: number; hash: string; delta: Record<string, unknown> }[] = [];
  const pushLedger = (
    time: number,
    type: string,
    fields: Record<string, string | number | boolean | null>,
  ): void => {
    ledger.push({ time, hash: `0x${hex(rnd, 64)}`, delta: { type, ...fields } });
  };

  function spotPrice(asset: 'purr' | 'hype', t: number): Big {
    const frac = (t - CURVE_START) / (CURVE_END - CURVE_START);
    if (asset === 'purr') {
      const base = 0.15 + (0.2 - 0.15) * frac;
      return new Big((base * (1 + (rnd() - 0.5) * 0.1)).toFixed(4));
    }
    const base = 25 + (33 - 25) * frac;
    return new Big((base * (1 + (rnd() - 0.5) * 0.08)).toFixed(3));
  }

  function spotBuy(asset: 'purr' | 'hype', time: number, qty: string, crossed: boolean): void {
    const pair = asset === 'purr' ? 'PURR/USDC' : '@107';
    const sz = new Big(qty);
    const px = spotPrice(asset, time);
    const notional = px.times(sz);
    const fee = round(sz.times(SPOT_FEE_RATE), 8);
    spotBalances[asset] = spotBalances[asset].plus(sz.minus(fee));
    spotBalances.usdc = spotBalances.usdc.minus(notional);
    spotEntryNtl[asset] = spotEntryNtl[asset].plus(notional);
    spotFills.push({
      coin: pair,
      px,
      sz,
      side: 'B',
      time,
      startPosition: ZERO,
      dir: 'Buy',
      closedPnl: ZERO,
      hash: `0x${hex(rnd, 64)}`,
      oid: 0,
      crossed,
      fee,
      tid: 0,
      feeToken: asset === 'purr' ? 'PURR' : 'HYPE',
      builderFee: null,
      liquidation: null,
    });
  }

  function spotSell(
    asset: 'purr' | 'hype',
    time: number,
    fraction: string,
    crossed: boolean,
  ): void {
    const pair = asset === 'purr' ? 'PURR/USDC' : '@107';
    const before = spotBalances[asset];
    const sz = round(before.times(fraction), 8);
    if (sz.gt(before))
      throw new Error(`Vente ${asset} > solde disponible à ${new Date(time).toISOString()}`);
    const px = spotPrice(asset, time);
    const notional = px.times(sz);
    const fee = round(notional.times(SPOT_FEE_RATE), 6);
    if (before.gt(ZERO))
      spotEntryNtl[asset] = spotEntryNtl[asset].minus(spotEntryNtl[asset].times(sz).div(before));
    spotBalances[asset] = before.minus(sz);
    spotBalances.usdc = spotBalances.usdc.plus(notional.minus(fee));
    spotFills.push({
      coin: pair,
      px,
      sz,
      side: 'A',
      time,
      startPosition: ZERO,
      dir: 'Sell',
      closedPnl: ZERO,
      hash: `0x${hex(rnd, 64)}`,
      oid: 0,
      crossed,
      fee,
      tid: 0,
      feeToken: 'USDC',
      builderFee: null,
      liquidation: null,
    });
  }

  // Chronologique : grand livre et fills spot partagent le même solde USDC / HYPE.
  pushLedger(ms(2026, 3, 2, 10, 0, 0), 'deposit', { usdc: '5000.0' });
  netFlows = netFlows.plus('5000.0');

  pushLedger(ms(2026, 3, 5, 9, 0, 0), 'accountClassTransfer', { usdc: '800.0', toPerp: false });
  netFlows = netFlows.minus('800.0');
  spotBalances.usdc = spotBalances.usdc.plus('800.0');

  spotBuy('purr', ms(2026, 3, 8, 10, 0, 0), '1000', true);
  spotBuy('purr', ms(2026, 3, 22, 11, 30, 0), '800', false);

  const hypeTransferTime = ms(2026, 4, 1, 12, 0, 0);
  const hypeTransferPrice = spotPrice('hype', hypeTransferTime);
  pushLedger(hypeTransferTime, 'spotTransfer', {
    token: 'HYPE',
    amount: '20.0',
    usdcValue: fmt(hypeTransferPrice.times('20')),
    user: FOREIGN_ADDRESS,
    destination: HL_DEMO_ADDRESS,
    fee: '0.0',
    nativeTokenFee: '0.0',
    nonce: nextNonce(),
    feeToken: 'HYPE',
  });
  spotBalances.hype = spotBalances.hype.plus('20.0');
  spotEntryNtl.hype = spotEntryNtl.hype.plus(hypeTransferPrice.times('20'));

  spotSell('hype', ms(2026, 4, 10, 10, 0, 0), '0.25', true);
  spotSell('purr', ms(2026, 4, 15, 9, 0, 0), '0.4', false);
  spotBuy('hype', ms(2026, 4, 28, 15, 0, 0), '3.5', true);
  spotBuy('purr', ms(2026, 5, 5, 14, 0, 0), '550', false);

  pushLedger(ms(2026, 5, 10, 14, 0, 0), 'deposit', { usdc: '3000.0' });
  netFlows = netFlows.plus('3000.0');

  spotSell('hype', ms(2026, 5, 20, 11, 0, 0), '0.5', true);
  spotSell('purr', ms(2026, 6, 1, 10, 0, 0), '0.5', false);
  spotBuy('hype', ms(2026, 6, 10, 14, 30, 0), '3', true);

  pushLedger(ms(2026, 6, 15, 8, 0, 0), 'accountClassTransfer', { usdc: '200.0', toPerp: true });
  netFlows = netFlows.plus('200.0');
  spotBalances.usdc = spotBalances.usdc.minus('200.0');

  spotBuy('purr', ms(2026, 6, 25, 16, 0, 0), '600', true);

  pushLedger(ms(2026, 7, 1, 16, 0, 0), 'withdraw', {
    usdc: '1500.0',
    nonce: nextNonce(),
    fee: '1.0',
  });
  netFlows = netFlows.minus('1500.0');

  spotSell('hype', ms(2026, 7, 5, 10, 0, 0), '0.4', false);
  spotSell('purr', ms(2026, 7, 20, 13, 0, 0), '0.3', true);
  spotBuy('hype', ms(2026, 8, 5, 16, 0, 0), '2.2', false);
  spotBuy('purr', ms(2026, 8, 10, 9, 30, 0), '400', true);

  // --- Assemblage des fills : tri par instant, tid croissants, oid (partagé pour l'ouverture BTC) --
  const combined = [...perpFills, ...spotFills].sort((a, b) => a.time - b.time);
  for (let i = 0; i < combined.length; i++) {
    const f = combined[i]!;
    f.tid = tidCounter++;
    if (f.oid === 0) f.oid = oidCounter++;
  }
  const userFillsByTime = combined.map((f) => ({
    coin: f.coin,
    px: fmt(f.px),
    sz: fmt(f.sz),
    side: f.side,
    time: f.time,
    startPosition: fmt(f.startPosition),
    dir: f.dir,
    closedPnl: fmt(f.closedPnl),
    hash: f.hash,
    oid: f.oid,
    crossed: f.crossed,
    fee: fmt(f.fee),
    tid: f.tid,
    feeToken: f.feeToken,
    builderFee: f.builderFee ? fmt(f.builderFee) : null,
    liquidation: f.liquidation
      ? { liquidatedUser: HL_DEMO_ADDRESS, markPx: fmt(f.liquidation.markPx), method: 'market' }
      : null,
    cloid: null,
  }));

  const userFunding = [...fundingRecords]
    .sort((a, b) => a.time - b.time)
    .map((r) => ({
      time: r.time,
      hash: r.hash,
      delta: {
        type: 'funding',
        coin: r.coin,
        usdc: fmt(r.usdc),
        szi: fmt(r.szi),
        fundingRate: fmt(r.fundingRate),
        nSamples: 1,
      },
    }));

  const userNonFundingLedgerUpdates = [...ledger].sort((a, b) => a.time - b.time);

  // --- Instantané final : SOL seul reste ouvert -----------------------------------------------
  const solState = perpState.get('SOL')!;
  const solSize = solState.position;
  const solEntryPx = round(solState.avgEntry, 4);
  const solMark = new Big('110');
  const solPositionValue = solSize.times(solMark);
  const solUnrealized = solMark.minus(solEntryPx).times(solSize);
  const solMarginUsed = round(solPositionValue.div('5'), 6);
  const solLiquidationPx = round(solEntryPx.times('0.82'), 3);
  const solRoe = solMarginUsed.gt(ZERO) ? round(solUnrealized.div(solMarginUsed), 6) : ZERO;

  const accountValue = netFlows
    .plus(totalRealized)
    .minus(totalPerpFees)
    .plus(totalFunding)
    .plus(solUnrealized);
  const totalMarginUsed = solMarginUsed;
  const withdrawable = accountValue.minus(totalMarginUsed);

  const marginSummary = {
    accountValue: fmt(accountValue),
    totalNtlPos: fmt(solPositionValue),
    totalRawUsd: fmt(accountValue),
    totalMarginUsed: fmt(totalMarginUsed),
  };

  const clearinghouseState = {
    marginSummary,
    crossMarginSummary: marginSummary,
    crossMaintenanceMarginUsed: fmt(round(totalMarginUsed.times('0.4'), 6)),
    withdrawable: fmt(withdrawable),
    assetPositions: [
      {
        type: 'oneWay',
        position: {
          coin: 'SOL',
          szi: fmt(solSize),
          leverage: { type: 'cross', value: 5 },
          entryPx: fmt(solEntryPx),
          positionValue: fmt(solPositionValue),
          unrealizedPnl: fmt(solUnrealized),
          returnOnEquity: fmt(solRoe),
          liquidationPx: fmt(solLiquidationPx),
          marginUsed: fmt(solMarginUsed),
          maxLeverage: 50,
          cumFunding: {
            allTime: fmt(solFundingSum),
            sinceOpen: fmt(solFundingSum),
            sinceChange: fmt(solSinceChange),
          },
        },
      },
    ],
    time: SNAPSHOT_TIME,
  };

  const spotClearinghouseState = {
    balances: [
      { coin: 'USDC', token: 0, total: fmt(spotBalances.usdc), hold: '0.0', entryNtl: '0.0' },
      {
        coin: 'PURR',
        token: 1,
        total: fmt(spotBalances.purr),
        hold: '0.0',
        entryNtl: fmt(spotEntryNtl.purr),
      },
      {
        coin: 'HYPE',
        token: 150,
        total: fmt(spotBalances.hype),
        hold: '0.0',
        entryNtl: fmt(spotEntryNtl.hype),
      },
    ],
  };

  const spotMeta = {
    tokens: [
      {
        name: 'USDC',
        index: 0,
        szDecimals: 8,
        weiDecimals: 8,
        tokenId: `0x${'0'.repeat(31)}1`,
        isCanonical: true,
      },
      {
        name: 'PURR',
        index: 1,
        szDecimals: 0,
        weiDecimals: 5,
        tokenId: `0x${'0'.repeat(31)}2`,
        isCanonical: true,
      },
      {
        name: 'HYPE',
        index: 150,
        szDecimals: 2,
        weiDecimals: 8,
        tokenId: `0x${'0'.repeat(31)}3`,
        isCanonical: true,
      },
    ],
    universe: [
      { tokens: [1, 0], name: 'PURR/USDC', index: 0, isCanonical: true },
      { tokens: [150, 0], name: '@107', index: 107, isCanonical: false },
    ],
  };

  const allMids: Record<string, string> = {
    BTC: '66000',
    ETH: '2200',
    SOL: '110',
    HYPE: '33',
    'PURR/USDC': '0.2',
    '@107': '33',
  };

  // `portfolio` : courbes de valeur de compte et de P&L par période, terminant exactement sur
  // l'équité de l'instantané (mêmes formes que la vraie API : tuples [label, data], chaînes).
  const finalValue = accountValue;
  const portfolioPeriod = (
    label: string,
    from: number,
    points: number,
    wobble: string,
  ): [
    string,
    { accountValueHistory: [number, string][]; pnlHistory: [number, string][]; vlm: string },
  ] => {
    const accountValueHistory: [number, string][] = [];
    const pnlHistory: [number, string][] = [];
    const step = (SNAPSHOT_TIME - from) / points;
    for (let i = 0; i <= points; i++) {
      const t = Math.round(from + i * step);
      const progress = i / points;
      // Trajet déterministe : départ à 92 % de l'équité finale, oscillation amortie, arrivée exacte.
      const osc = Math.sin(i * 2.399963) * (1 - progress);
      const value = finalValue
        .times(new Big('0.92').plus(new Big(String(progress)).times('0.08')))
        .plus(finalValue.times(wobble).times(String(osc)));
      accountValueHistory.push([t, value.round(6, HALF_UP).toString()]);
      pnlHistory.push([t, value.minus(finalValue.times('0.92')).round(6, HALF_UP).toString()]);
    }
    accountValueHistory[points] = [SNAPSHOT_TIME, finalValue.toString()];
    return [label, { accountValueHistory, pnlHistory, vlm: '123456.7' }];
  };
  const portfolio = [
    portfolioPeriod('day', SNAPSHOT_TIME - 24 * 3_600_000, 24, '0.004'),
    portfolioPeriod('week', SNAPSHOT_TIME - 7 * 86_400_000, 28, '0.01'),
    portfolioPeriod('month', SNAPSHOT_TIME - 30 * 86_400_000, 30, '0.02'),
    portfolioPeriod('allTime', CURVE_START, 40, '0.03'),
    portfolioPeriod('perpDay', SNAPSHOT_TIME - 24 * 3_600_000, 24, '0.004'),
    portfolioPeriod('perpWeek', SNAPSHOT_TIME - 7 * 86_400_000, 28, '0.01'),
    portfolioPeriod('perpMonth', SNAPSHOT_TIME - 30 * 86_400_000, 30, '0.02'),
    portfolioPeriod('perpAllTime', CURVE_START, 40, '0.03'),
  ];

  return {
    address: HL_DEMO_ADDRESS,
    userFillsByTime,
    userFunding,
    userNonFundingLedgerUpdates,
    clearinghouseState,
    spotClearinghouseState,
    spotMeta,
    allMids,
    portfolio,
  };
}

const isMain = Boolean(process.argv[1]) && pathToFileURL(process.argv[1]!).href === import.meta.url;
if (isMain) {
  const output = process.argv[2] ?? HL_FIXTURE_PATH;
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(generateHlFixture(), null, 1) + '\n', 'utf8');
  const fixture = generateHlFixture();
  console.log(
    `${fixture.userFillsByTime.length} fills, ${fixture.userFunding.length} funding, ${fixture.userNonFundingLedgerUpdates.length} ledger → ${output}`,
  );
}
