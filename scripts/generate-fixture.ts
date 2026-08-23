/**
 * Jeu de démonstration Coinhouse **entièrement synthétique** (« Export avancé », été 2026).
 *   node scripts/generate-fixture.ts   →   tests/fixtures/coinhouse/export-demo.csv
 *
 * Déterministe : générateur pseudo-aléatoire à graine fixe, aucune horloge, aucune dépendance à la
 * plateforme → le fichier commis doit être identique à la sortie du script (test dédié). Aucune
 * ligne ne provient d'un export réel : le portefeuille, ses montants, ses dates et ses proportions
 * sont inventés ; seuls des niveaux de cours publics approximatifs (points d'ancrage mensuels)
 * rendent les prix d'achat plausibles par rapport aux cours réels que la démo affiche.
 *
 * Le scénario couvre tout ce que l'importeur et le moteur savent traiter : achats en euros, achats
 * d'USDC, achats payés en USDC, ventes vers euros et vers USDC, DCA, vente puis rachat (PRU
 * invariant), positions clôturées en gain et en perte, actif à prix minuscule (PEPE), abonnements
 * (dont un à 0), delisting + migration (MKR → SKY), remises de frais partielles ou totales, et un
 * jour où deux opérations USDC sont réglées dans l'ordre inverse de leurs horodatages (cas réel).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import Big from 'big.js';

// Même configuration que `src/lib/domain/money.ts` (instance partagée sous Vitest).
Big.DP = 30;
Big.RM = Big.roundHalfEven;
Big.NE = -30;
Big.PE = 40;
Big.strict = true;

export const FIXTURE_PATH = 'tests/fixtures/coinhouse/export-demo.csv';
export const HEADER =
  'ID Coinhouse,Date,Type,Quantité,Devise,Prix du marché,Contre-valeur (EUR),Frais (devise),Frais Contre-valeur (EUR),Remise frais,Solde,Compte';

const SEED = 20260823;
const HALF_UP = Big.roundHalfUp;
const SUBSCRIPTION_START = Date.UTC(2025, 0, 20);
/** Grille Coinhouse (août 2026) : taux + 0,12 € fixes, frais bruts avant remise d'abonnement. */
const FEE_RATE: Record<Counter, string> = { eur: '0.0099', usdc: '0.0079' };
const FEE_FIXED = '0.12';
const SKY_PER_MKR = '24000';

type Counter = 'eur' | 'usdc';
type Day = string; // AAAA-MM-JJ

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

function dayMs(day: Day): number {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

function at(day: Day, time: string): number {
  const [h, mi, s] = time.split(':').map(Number) as [number, number, number];
  return dayMs(day) + ((h * 60 + mi) * 60 + s) * 1000;
}

const p2 = (n: number): string => String(n).padStart(2, '0');

/** Horodatage Coinhouse `jj/MM/aaaa HH:mm:ss` (naïf : aucune conversion de fuseau). */
function fmtDate(ms: number): string {
  const d = new Date(ms);
  return `${p2(d.getUTCDate())}/${p2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`;
}

const round = (value: Big, dp: number): Big => value.round(dp, HALF_UP);

/** `toFixed` sans zéros de fin inutiles, mais toujours une décimale (style de l'export : « 0.0 »). */
function num(value: Big, dp: number): string {
  return value
    .toFixed(dp)
    .replace(/(\.\d*?[1-9])0+$/, '$1')
    .replace(/\.0+$/, '.0');
}

/**
 * Points d'ancrage de cours (EUR), approximations de niveaux publics 2025–2026 : ils servent
 * uniquement à rendre les prix d'achat vraisemblables. Interpolation linéaire entre deux points.
 */
const ANCHORS: Record<string, [Day, number][]> = {
  btc: [
    ['2025-01-01', 92000],
    ['2025-03-01', 78000],
    ['2025-04-10', 71000],
    ['2025-05-20', 92000],
    ['2025-07-15', 100000],
    ['2025-09-01', 97000],
    ['2025-11-01', 88000],
    ['2026-01-05', 75000],
    ['2026-02-15', 58000],
    ['2026-04-10', 61000],
    ['2026-06-10', 53000],
    ['2026-08-20', 66000],
  ],
  eth: [
    ['2025-01-01', 3200],
    ['2025-04-10', 1350],
    ['2025-05-20', 2300],
    ['2025-07-15', 3100],
    ['2025-08-20', 3700],
    ['2025-10-15', 3300],
    ['2025-12-10', 2450],
    ['2026-01-20', 2850],
    ['2026-02-20', 1700],
    ['2026-06-10', 1400],
    ['2026-08-20', 2070],
  ],
  sol: [
    ['2025-01-01', 200],
    ['2025-04-10', 96],
    ['2025-08-15', 156],
    ['2025-12-10', 104],
    ['2026-06-10', 61],
    ['2026-08-20', 81],
  ],
  ada: [
    ['2025-01-01', 0.95],
    ['2025-04-10', 0.55],
    ['2025-08-15', 0.7],
    ['2025-12-10', 0.31],
    ['2026-08-20', 0.2],
  ],
  xrp: [
    ['2025-01-01', 2.3],
    ['2025-04-10', 1.8],
    ['2025-08-15', 2.68],
    ['2025-12-10', 1.57],
    ['2026-08-20', 1.3],
  ],
  link: [
    ['2025-01-01', 21],
    ['2025-04-10', 11],
    ['2025-07-15', 15],
    ['2025-08-15', 20.9],
    ['2025-12-10', 10.2],
    ['2026-08-20', 9.8],
  ],
  avax: [
    ['2025-01-01', 36],
    ['2025-04-10', 17],
    ['2025-08-15', 20.9],
    ['2025-12-10', 10.2],
    ['2026-08-20', 6.5],
  ],
  dot: [
    ['2025-01-01', 6.5],
    ['2025-04-10', 3.4],
    ['2025-08-15', 3.6],
    ['2025-12-10', 2.1],
    ['2026-08-20', 2.5],
  ],
  doge: [
    ['2025-01-01', 0.32],
    ['2025-04-10', 0.15],
    ['2025-08-15', 0.197],
    ['2025-12-10', 0.108],
    ['2026-08-20', 0.08],
  ],
  near: [
    ['2025-01-01', 5],
    ['2025-04-10', 2],
    ['2025-08-15', 2.4],
    ['2025-12-10', 1.6],
    ['2026-08-20', 1.67],
  ],
  pepe: [
    ['2025-01-01', 0.000017],
    ['2025-04-10', 0.0000065],
    ['2025-08-15', 0.00001],
    ['2025-12-10', 0.000003],
    ['2026-08-20', 0.0000035],
  ],
  sky: [
    ['2025-09-22', 0.06],
    ['2025-12-10', 0.053],
    ['2026-08-20', 0.056],
  ],
  mkr: [
    ['2025-07-01', 1900],
    ['2025-08-15', 1745],
    ['2025-09-22', 1500],
  ],
  ltc: [
    ['2025-01-01', 100],
    ['2025-03-18', 85],
    ['2025-12-10', 75],
  ],
  atom: [
    ['2025-01-01', 6],
    ['2025-04-22', 4.2],
    ['2025-09-29', 4],
    ['2025-12-10', 2.5],
  ],
  uni: [
    ['2025-01-01', 12],
    ['2025-02-11', 9.5],
    ['2025-05-27', 5.8],
    ['2025-12-10', 5],
  ],
  xlm: [
    ['2025-01-01', 0.4],
    ['2025-07-02', 0.38],
    ['2025-12-10', 0.22],
  ],
  algo: [
    ['2025-01-01', 0.4],
    ['2025-08-15', 0.23],
    ['2025-12-22', 0.092],
    ['2026-02-05', 0.1],
  ],
  ens: [
    ['2025-08-26', 25],
    ['2025-11-04', 17],
    ['2025-12-10', 8],
  ],
  aave: [
    ['2025-08-14', 267],
    ['2025-12-10', 127],
    ['2026-01-13', 110],
    ['2026-06-10', 76],
    ['2026-08-20', 106],
  ],
  /** Taux EUR d'un USDC. */
  usdc: [
    ['2025-01-01', 0.96],
    ['2025-05-01', 0.893],
    ['2025-07-01', 0.851],
    ['2025-12-01', 0.848],
    ['2026-01-15', 0.863],
    ['2026-02-15', 0.848],
    ['2026-06-15', 0.877],
    ['2026-07-15', 0.874],
    ['2026-08-20', 0.856],
  ],
};

function interpolate(asset: string, ms: number): number {
  const anchors = ANCHORS[asset];
  if (!anchors || anchors.length === 0) throw new Error(`Pas de cours pour ${asset}`);
  const first = anchors[0]!;
  const last = anchors[anchors.length - 1]!;
  if (ms <= dayMs(first[0])) return first[1];
  if (ms >= dayMs(last[0])) return last[1];
  for (let i = 1; i < anchors.length; i++) {
    const [dayB, priceB] = anchors[i]!;
    const [dayA, priceA] = anchors[i - 1]!;
    const a = dayMs(dayA);
    const b = dayMs(dayB);
    if (ms <= b) return priceA + ((priceB - priceA) * (ms - a)) / (b - a);
  }
  return last[1];
}

/** Décimales affichées par Coinhouse selon l'ordre de grandeur du prix. */
function priceDecimals(price: number): number {
  if (price >= 10) return 2;
  if (price >= 1) return 3;
  if (price >= 0.01) return 4;
  return 10;
}

interface Leg {
  qty: Big;
  asset: string;
  price: string;
  value: Big;
  feeAsset: string;
  feeEur: string;
  rebate: string;
}

interface Op {
  ms: number;
  type: 'Echange' | 'Abonnement' | 'Echange Delisting' | 'Migration';
  id: string;
  legs: Leg[];
  /** Rang de règlement : ordre chronologique, sauf permutation volontaire (voir `swap`). */
  settle: number;
  tag?: string;
}

interface Plan {
  day: Day;
  time: string;
  kind: 'fund' | 'buy' | 'sell' | 'sub' | 'migration';
  asset?: string;
  /** Budget en euros (achat / approvisionnement), montant (abonnement). */
  amount?: string;
  /** Fraction de la position vendue (« 1 » = tout). */
  fraction?: string;
  counter?: Counter;
  tag?: string;
}

const plan = (
  day: Day,
  time: string,
  kind: Plan['kind'],
  rest: Omit<Plan, 'day' | 'time' | 'kind'> = {},
): Plan => ({ day, time, kind, ...rest });

/** Scénario manuel (chronologique) ; les DCA BTC et ETH sont ajoutés par programme. */
const SCENARIO: Plan[] = [
  plan('2025-01-08', '10:15:00', 'fund', { amount: '2500' }),
  plan('2025-01-08', '10:32:10', 'buy', { asset: 'btc', amount: '1500', counter: 'eur' }),
  plan('2025-01-08', '10:40:05', 'buy', { asset: 'eth', amount: '800', counter: 'eur' }),
  plan('2025-01-09', '18:02:44', 'buy', { asset: 'ltc', amount: '400', counter: 'eur' }),
  plan('2025-01-09', '18:05:30', 'buy', { asset: 'atom', amount: '300', counter: 'eur' }),
  plan('2025-01-10', '09:11:07', 'buy', { asset: 'xlm', amount: '250', counter: 'eur' }),
  plan('2025-01-20', '08:24:24', 'sub', { amount: '9.9' }),
  plan('2025-02-03', '12:30:00', 'buy', { asset: 'sol', amount: '500', counter: 'usdc' }),
  plan('2025-02-11', '21:15:33', 'buy', { asset: 'uni', amount: '350', counter: 'usdc' }),
  plan('2025-02-20', '08:24:31', 'sub', { amount: '0.0' }),
  plan('2025-03-06', '19:44:12', 'buy', { asset: 'ada', amount: '300', counter: 'eur' }),
  plan('2025-03-06', '19:46:50', 'buy', { asset: 'xrp', amount: '400', counter: 'eur' }),
  plan('2025-03-18', '14:10:02', 'sell', { asset: 'ltc', fraction: '1', counter: 'eur' }),
  plan('2025-04-07', '08:58:41', 'buy', { asset: 'eth', amount: '600', counter: 'usdc' }),
  plan('2025-04-22', '17:33:19', 'sell', { asset: 'atom', fraction: '0.5', counter: 'usdc' }),
  plan('2025-05-12', '11:05:55', 'buy', { asset: 'link', amount: '400', counter: 'eur' }),
  plan('2025-05-27', '20:20:20', 'sell', { asset: 'uni', fraction: '1', counter: 'eur' }),
  plan('2025-06-09', '13:13:13', 'buy', { asset: 'avax', amount: '350', counter: 'usdc' }),
  plan('2025-06-16', '09:30:00', 'buy', { asset: 'dot', amount: '250', counter: 'eur' }),
  plan('2025-07-02', '16:41:08', 'sell', { asset: 'xlm', fraction: '1', counter: 'eur' }),
  plan('2025-07-15', '10:02:30', 'buy', { asset: 'mkr', amount: '900', counter: 'eur' }),
  plan('2025-07-23', '22:10:45', 'buy', { asset: 'doge', amount: '300', counter: 'eur' }),
  // Même journée, réglée dans l'ordre inverse : l'achat AAVE est débité avant la vente SOL.
  plan('2025-08-14', '10:05:12', 'sell', {
    asset: 'sol',
    fraction: '0.3',
    counter: 'usdc',
    tag: 'a',
  }),
  plan('2025-08-14', '10:07:48', 'buy', {
    asset: 'aave',
    amount: '500',
    counter: 'usdc',
    tag: 'b',
  }),
  plan('2025-08-26', '07:45:00', 'buy', { asset: 'ens', amount: '300', counter: 'eur' }),
  plan('2025-09-22', '14:22:51', 'migration', { asset: 'mkr' }),
  plan('2025-09-29', '18:18:18', 'sell', { asset: 'atom', fraction: '1', counter: 'eur' }),
  plan('2025-10-08', '12:00:00', 'buy', { asset: 'near', amount: '300', counter: 'eur' }),
  plan('2025-10-21', '19:27:36', 'buy', { asset: 'pepe', amount: '150', counter: 'usdc' }),
  plan('2025-11-04', '08:08:08', 'sell', { asset: 'ens', fraction: '1', counter: 'eur' }),
  plan('2025-11-19', '15:45:01', 'sell', { asset: 'eth', fraction: '0.25', counter: 'usdc' }),
  plan('2025-12-02', '10:10:10', 'buy', { asset: 'eth', amount: '400', counter: 'eur' }),
  plan('2025-12-15', '09:00:00', 'sub', { amount: '118.8' }),
  plan('2025-12-22', '17:05:05', 'buy', { asset: 'algo', amount: '200', counter: 'usdc' }),
  plan('2026-01-13', '11:11:11', 'sell', { asset: 'aave', fraction: '1', counter: 'usdc' }),
  plan('2026-01-27', '20:30:40', 'buy', { asset: 'sol', amount: '300', counter: 'usdc' }),
  plan('2026-02-05', '09:09:09', 'sell', { asset: 'algo', fraction: '1', counter: 'eur' }),
  plan('2026-02-24', '13:37:00', 'buy', { asset: 'ada', amount: '200', counter: 'usdc' }),
  plan('2026-03-10', '10:45:32', 'buy', { asset: 'xrp', amount: '200', counter: 'eur' }),
  plan('2026-03-25', '18:52:14', 'sell', { asset: 'doge', fraction: '0.4', counter: 'eur' }),
  plan('2026-04-06', '08:30:00', 'fund', { amount: '2000' }),
  plan('2026-04-16', '12:12:12', 'buy', { asset: 'eth', amount: '500', counter: 'usdc' }),
  plan('2026-05-07', '07:07:07', 'buy', { asset: 'link', amount: '200', counter: 'usdc' }),
  plan('2026-05-21', '21:21:21', 'sell', { asset: 'pepe', fraction: '0.5', counter: 'usdc' }),
  plan('2026-06-11', '10:00:00', 'buy', { asset: 'sol', amount: '250', counter: 'usdc' }),
  plan('2026-06-25', '16:16:16', 'buy', { asset: 'avax', amount: '150', counter: 'eur' }),
  plan('2026-07-09', '09:45:00', 'sell', { asset: 'xrp', fraction: '0.3', counter: 'eur' }),
  plan('2026-07-28', '19:19:19', 'buy', { asset: 'near', amount: '150', counter: 'usdc' }),
  plan('2026-08-04', '11:30:00', 'buy', { asset: 'eth', amount: '300', counter: 'eur' }),
  plan('2026-08-11', '14:14:14', 'sell', { asset: 'dot', fraction: '1', counter: 'usdc' }),
];

function withDca(scenario: Plan[]): Plan[] {
  const all = [...scenario];
  // BTC : 200 € en euros les 5 et 20 de chaque mois, de février 2025 à août 2026.
  for (let month = 1; month <= 19; month++) {
    const y = 2025 + Math.floor(month / 12);
    const m = (month % 12) + 1;
    for (const d of [5, 20]) {
      all.push(
        plan(`${y}-${p2(m)}-${p2(d)}`, '07:30:00', 'buy', {
          asset: 'btc',
          amount: '200',
          counter: 'eur',
        }),
      );
    }
  }
  // ETH : 100 € payés en USDC le 12 de chaque mois, de juin 2025 à août 2026.
  for (let month = 5; month <= 19; month++) {
    const y = 2025 + Math.floor(month / 12);
    const m = (month % 12) + 1;
    all.push(
      plan(`${y}-${p2(m)}-12`, '07:35:00', 'buy', { asset: 'eth', amount: '100', counter: 'usdc' }),
    );
  }
  return all.sort((a, b) => at(a.day, a.time) - at(b.day, b.time));
}

export function generateFixture(): string {
  const rnd = mulberry32(SEED);
  const ids = new Set<string>();
  const newId = (): string => {
    for (;;) {
      const id = Math.floor(rnd() * 0xffffffff)
        .toString(16)
        .padStart(8, '0');
      if (!ids.has(id)) {
        ids.add(id);
        return id;
      }
    }
  };
  /** Cours EUR bruité (±4 %) puis arrondi aux décimales d'affichage. */
  const priceEur = (asset: string, ms: number): Big => {
    const base = interpolate(asset, ms) * (1 + (rnd() - 0.5) * 0.08);
    return new Big(base.toFixed(priceDecimals(base)));
  };
  const rateAt = (ms: number): Big =>
    new Big((interpolate('usdc', ms) * (1 + (rnd() - 0.5) * 0.006)).toFixed(6));
  let opCount = 0;
  const rebateFor = (ms: number, fee: Big): Big => {
    opCount++;
    if (ms < SUBSCRIPTION_START) return new Big('0');
    if (opCount % 7 === 0) return fee; // remise totale
    if (opCount % 11 === 0) return new Big('0'); // aucune remise
    return round(fee.times('0.7'), 6); // remise d'abonnement
  };
  const grossFee = (amount: Big, counter: Counter): Big =>
    round(amount.times(FEE_RATE[counter]).plus(FEE_FIXED), 6);

  const balances = new Map<string, Big>();
  const bal = (asset: string): Big => balances.get(asset) ?? new Big('0');
  const move = (asset: string, delta: Big): void => {
    balances.set(asset, bal(asset).plus(delta));
  };
  const ops: Op[] = [];
  const push = (op: Omit<Op, 'settle'>): void => {
    ops.push({ ...op, settle: ops.length });
  };
  const leg = (partial: Partial<Leg> & Pick<Leg, 'qty' | 'asset' | 'price' | 'value'>): Leg => ({
    feeAsset: '',
    feeEur: '',
    rebate: '',
    ...partial,
  });

  /** EUR → USDC : la jambe actif est l'USDC, la contrepartie l'euro. */
  const fund = (ms: number, eur: string): void => {
    const gross = new Big(eur);
    const rate = rateAt(ms);
    const fee = grossFee(gross, 'eur');
    const rebate = rebateFor(ms, fee);
    const net = gross.minus(fee).plus(rebate);
    const qty = round(net.div(rate), 6);
    move('usdc', qty);
    push({
      ms,
      type: 'Echange',
      id: newId(),
      legs: [
        leg({ qty, asset: 'usdc', price: num(rate, 6), value: qty.times(rate) }),
        leg({
          qty: gross.neg(),
          asset: 'eur',
          price: '1',
          value: gross.neg(),
          feeAsset: num(fee, 6),
          feeEur: num(fee, 6),
          rebate: num(rebate, 6),
        }),
      ],
    });
  };

  /** Cours de la jambe actif dans la devise de contrepartie (en USDC quand on paie en USDC). */
  const priceIn = (eurPrice: Big, rate: Big): Big => {
    const raw = eurPrice.div(rate);
    return round(raw, priceDecimals(Number(raw.toFixed(12))));
  };

  const buy = (
    ms: number,
    asset: string,
    eurBudget: string,
    counter: Counter,
    tag?: string,
  ): void => {
    const rate = counter === 'eur' ? new Big('1') : rateAt(ms);
    const price = priceIn(priceEur(asset, ms), rate);
    const gross = counter === 'eur' ? new Big(eurBudget) : round(new Big(eurBudget).div(rate), 2);
    if (counter === 'usdc' && bal('usdc').lt(gross)) {
      // Approvisionnement automatique, réglé 90 s plus tôt, par tranches de 500 € (+ 500 € de marge).
      const shortfall = gross.minus(bal('usdc')).times(rate);
      const tranche = shortfall.div('500').round(0, Big.roundDown).plus('2').times('500');
      fund(ms - 90_000, num(tranche, 1));
    }
    const fee = grossFee(gross, counter);
    const rebate = rebateFor(ms, fee);
    const net = gross.minus(fee).plus(rebate);
    const qty = round(net.div(price), 8);
    move(asset, qty);
    move(counter, gross.neg());
    push({
      ms,
      type: 'Echange',
      id: newId(),
      ...(tag ? { tag } : {}),
      legs: [
        leg({ qty, asset, price: price.toString(), value: qty.times(price) }),
        leg({
          qty: gross.neg(),
          asset: counter,
          price: counter === 'eur' ? '1' : num(rate, 6),
          value: gross.neg().times(rate),
          feeAsset: num(fee, 6),
          feeEur: num(round(fee.times(rate), 6), 6),
          rebate: num(rebate, 6),
        }),
      ],
    });
  };

  const sell = (
    ms: number,
    asset: string,
    fraction: string,
    counter: Counter,
    tag?: string,
  ): void => {
    const rate = counter === 'eur' ? new Big('1') : rateAt(ms);
    const price = priceIn(priceEur(asset, ms), rate);
    const held = bal(asset);
    const qty = fraction === '1' ? held : round(held.times(fraction), 8);
    const proceeds = qty.times(price);
    const fee = grossFee(proceeds, counter);
    const rebate = rebateFor(ms, fee);
    const net = round(proceeds.minus(fee).plus(rebate), counter === 'eur' ? 2 : 6);
    move(asset, qty.neg());
    move(counter, net);
    push({
      ms,
      type: 'Echange',
      id: newId(),
      ...(tag ? { tag } : {}),
      legs: [
        leg({ qty: qty.neg(), asset, price: price.toString(), value: proceeds.neg() }),
        leg({
          qty: net,
          asset: counter,
          price: counter === 'eur' ? '1' : num(rate, 6),
          value: net.times(rate),
          feeAsset: num(fee, 6),
          feeEur: num(round(fee.times(rate), 6), 6),
          rebate: num(rebate, 6),
        }),
      ],
    });
  };

  const subscription = (ms: number, amount: string): void => {
    const value = new Big(amount);
    push({
      ms,
      type: 'Abonnement',
      id: '',
      legs: [leg({ qty: value, asset: 'eur', price: '', value })],
    });
  };

  /** Delisting MKR (solde à 0) puis, le soir même, réception des SKY de remplacement. */
  const migration = (ms: number, asset: string): void => {
    const held = bal(asset);
    const price = priceEur(asset, ms);
    move(asset, held.neg());
    push({
      ms,
      type: 'Echange Delisting',
      id: newId(),
      legs: [
        leg({
          qty: held.neg(),
          asset,
          price: price.toString(),
          value: held.times(price).neg(),
          feeAsset: '0.0',
          feeEur: '0.0',
          rebate: '0.0',
        }),
      ],
    });
    const skyQty = round(held.times(SKY_PER_MKR), 8);
    const skyPrice = priceEur('sky', ms);
    move('sky', skyQty);
    push({
      ms: ms + 8 * 3_600_000 + 39 * 60_000 + 51_000,
      type: 'Migration',
      id: newId(),
      legs: [
        leg({
          qty: skyQty,
          asset: 'sky',
          price: skyPrice.toString(),
          value: skyQty.times(skyPrice),
          feeAsset: '0.0',
          feeEur: '0.0',
          rebate: '0.0',
        }),
      ],
    });
  };

  for (const step of withDca(SCENARIO)) {
    const ms = at(step.day, step.time);
    switch (step.kind) {
      case 'fund':
        fund(ms, step.amount!);
        break;
      case 'buy':
        buy(ms, step.asset!, step.amount!, step.counter!, step.tag);
        break;
      case 'sell':
        sell(ms, step.asset!, step.fraction!, step.counter!, step.tag);
        break;
      case 'sub':
        subscription(ms, step.amount!);
        break;
      case 'migration':
        migration(ms, step.asset!);
        break;
    }
  }

  // Permutation de règlement : l'opération « b » est réglée avant « a » le même jour.
  const a = ops.find((op) => op.tag === 'a');
  const b = ops.find((op) => op.tag === 'b');
  if (!a || !b) throw new Error('Scénario incomplet : opérations à permuter absentes');
  [a.settle, b.settle] = [b.settle, a.settle];

  // Colonne `Solde` : solde de l'actif après l'opération, dans l'ordre de règlement.
  const settled = new Map<string, Big>();
  const soldes = new Map<Leg, string>();
  for (const op of [...ops].sort((x, y) => x.settle - y.settle)) {
    for (const l of op.legs) {
      if (l.asset === 'eur') continue;
      const next = (settled.get(l.asset) ?? new Big('0')).plus(l.qty);
      settled.set(l.asset, next);
      soldes.set(l, num(next, l.asset === 'usdc' ? 6 : 8));
    }
  }

  // Export trié du plus récent au plus ancien, jambe actif avant jambe contrepartie.
  const lines: string[] = [HEADER];
  for (const op of [...ops].sort((x, y) => y.ms - x.ms || y.settle - x.settle)) {
    for (const l of op.legs) {
      const qtyDp = l.asset === 'eur' ? 2 : l.asset === 'usdc' ? 6 : 8;
      lines.push(
        [
          op.id,
          fmtDate(op.ms),
          op.type,
          num(l.qty, qtyDp),
          l.asset,
          l.price,
          l.value.toString().includes('.') ? l.value.toString() : `${l.value.toString()}.0`,
          l.feeAsset,
          l.feeEur,
          l.rebate,
          l.asset === 'eur' ? '' : (soldes.get(l) ?? ''),
          l.asset === 'eur' ? '""' : 'Portefeuille',
        ].join(','),
      );
    }
  }
  return lines.join('\n') + '\n';
}

const isMain = Boolean(process.argv[1]) && pathToFileURL(process.argv[1]!).href === import.meta.url;
if (isMain) {
  const output = process.argv[2] ?? FIXTURE_PATH;
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, generateFixture(), 'utf8');
  console.log(`${generateFixture().split('\n').length - 2} lignes → ${output}`);
}
