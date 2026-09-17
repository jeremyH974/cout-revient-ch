import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { D, ZERO, min, type Big } from '../money';
import type { CurvePoint } from './curve';
import {
  detailedCurve,
  marketsHeld,
  perpMarket,
  priceNear,
  replayAt,
  tokenMarket,
  valuationOf,
  type AccountMove,
  type Candle,
  type DetailInput,
  type FlowMove,
  type PerpFillMove,
  type PriceBook,
  withoutZeroSeed,
} from './equity-path';

const M = 60_000;
const T0 = Date.UTC(2026, 8, 16, 14, 0);

const perp = (over: Partial<PerpFillMove>): PerpFillMove => ({
  kind: 'perp',
  time: T0,
  coin: 'BTC',
  side: 'buy',
  qty: '1',
  price: '100',
  startPosition: '0',
  closedPnl: '0',
  fee: '0',
  ...over,
});
const flow = (time: number, qty: string, token = 'USDC', value = qty): FlowMove => ({
  kind: 'flow',
  time,
  token,
  qty,
  value,
});

/** Bougies d'une minute à partir de `T0` : ouverture = clôture précédente, amplitude ± 1. */
function minuteCandles(closes: readonly number[], first = 100): Candle[] {
  return closes.map((close, k) => {
    const open = k === 0 ? first : closes[k - 1]!;
    return {
      t: T0 + k * M,
      o: String(open),
      h: String(Math.max(open, close) + 1),
      l: String(Math.min(open, close) - 1),
      c: String(close),
    };
  });
}
const BTC_CLOSES = [100, 100, 100, 102, 104, 103, 105, 107, 106, 110];
const btcBook = (closes = BTC_CLOSES): PriceBook => ({
  [perpMarket('BTC')]: { intervalMs: M, candles: minuteCandles(closes) },
});

const values = (points: readonly { value: Big }[]): string[] =>
  points.map((p) => p.value.toString());

const base = (over: Partial<DetailInput>): DetailInput => ({
  moves: [],
  spot: null,
  prices: {},
  from: T0,
  to: T0 + 10 * M,
  intervalMs: M,
  equity: [],
  ...over,
});

describe('replayAt — l’état du compte à chaque instant', () => {
  it('la position suit `startPosition`, la trésorerie reçoit closedPnl − frais, le funding et les apports', () => {
    const moves: AccountMove[] = [
      flow(T0 - M, '1000'),
      perp({ time: T0, side: 'buy', qty: '2', price: '100', fee: '0.1' }),
      { kind: 'funding', time: T0 + M, amount: '-0.5' },
      perp({
        time: T0 + 2 * M,
        side: 'sell',
        qty: '2',
        price: '110',
        startPosition: '2',
        closedPnl: '20',
        fee: '0.11',
      }),
    ];
    const [before, open, funded, closed] = replayAt(moves, null, [T0 - M, T0, T0 + M, T0 + 2 * M]);
    expect([before!.cash.toString(), before!.flows.toString(), before!.positions]).toEqual([
      '1000',
      '1000',
      [],
    ]);
    expect(open!.cash.toString()).toBe('999.9');
    expect(open!.positions.map((p) => [p.coin, p.size.toString(), p.entry?.toString()])).toEqual([
      ['BTC', '2', '100'],
    ]);
    expect(funded!.cash.toString()).toBe('999.4');
    expect(closed!.cash.toString()).toBe('1019.29');
    expect(closed!.positions).toEqual([]);
    // Le cours exécuté à l'instant est retenu, pas celui d'un autre instant.
    expect(closed!.traded[perpMarket('BTC')]?.toString()).toBe('110');
    expect(funded!.traded).toEqual({});
  });

  it('l’entrée se relit sur le closedPnl des réductions : l’arrondi de la plateforme ne dérive pas', () => {
    // Moyenne exacte 100,075 ; la plateforme a retenu 100,1 et crédite donc 0,9 sur la réduction.
    const long: AccountMove[] = [
      perp({ time: T0, qty: '1', price: '100' }),
      perp({ time: T0 + M, qty: '1', price: '100.15', startPosition: '1' }),
      perp({
        time: T0 + 2 * M,
        side: 'sell',
        qty: '1',
        price: '101',
        startPosition: '2',
        closedPnl: '0.9',
      }),
    ];
    const [averaged, reduced] = replayAt(long, null, [T0 + M, T0 + 2 * M]);
    expect(averaged!.positions[0]!.entry!.toString()).toBe('100.075');
    expect(reduced!.positions[0]!.entry!.toString()).toBe('100.1');

    const short: AccountMove[] = [
      perp({ time: T0, side: 'sell', qty: '2', price: '100.1' }),
      perp({
        time: T0 + M,
        side: 'buy',
        qty: '1',
        price: '99',
        startPosition: '-2',
        closedPnl: '1.1',
      }),
    ];
    const [covered] = replayAt(short, null, [T0 + M]);
    expect(covered!.positions.map((p) => [p.size.toString(), p.entry!.toString()])).toEqual([
      ['-1', '100.1'],
    ]);
  });

  it('un retournement repart du cours du fill ; une chaîne rompue rend l’entrée inconnue jusqu’à la réduction suivante', () => {
    const moves: AccountMove[] = [
      perp({ time: T0, qty: '1', price: '100' }),
      perp({
        time: T0 + M,
        side: 'sell',
        qty: '3',
        price: '105',
        startPosition: '1',
        closedPnl: '5',
      }),
      // Un fill manque : la plateforme annonce −4 au départ, on suivait −2.
      perp({ time: T0 + 2 * M, side: 'sell', qty: '1', price: '106', startPosition: '-4' }),
      perp({
        time: T0 + 3 * M,
        side: 'buy',
        qty: '1',
        price: '104',
        startPosition: '-5',
        closedPnl: '1.5',
      }),
    ];
    const [flipped, broken, recovered] = replayAt(moves, null, [T0 + M, T0 + 2 * M, T0 + 3 * M]);
    expect([
      flipped!.positions[0]!.size.toString(),
      flipped!.positions[0]!.entry!.toString(),
    ]).toEqual(['-2', '105']);
    expect(broken!.positions[0]!.entry).toBeNull();
    expect(recovered!.positions[0]!.entry!.toString()).toBe('105.5');
  });

  it('spot : jeton reçu net de ses frais, trésorerie des ventes, transferts de jetons, cotation hors USDC', () => {
    const moves: AccountMove[] = [
      {
        kind: 'spot',
        time: T0,
        base: 'HYPE',
        quote: 'USDC',
        side: 'buy',
        qty: '10',
        price: '30',
        fee: '0.007',
        feeToken: 'HYPE',
      },
      {
        kind: 'spot',
        time: T0 + M,
        base: 'HYPE',
        quote: 'USDC',
        side: 'sell',
        qty: '5',
        price: '32',
        fee: '0.112',
        feeToken: 'USDC',
      },
      flow(T0 + 2 * M, '2', 'HYPE', '62'),
      {
        kind: 'spot',
        time: T0 + 3 * M,
        base: 'PURR',
        quote: 'USDH',
        side: 'buy',
        qty: '100',
        price: '0.2',
        fee: '0',
        feeToken: 'USDH',
      },
    ];
    const tokensOf = (i: number, list: ReturnType<typeof replayAt>) =>
      list[i]!.tokens.map((t) => [t.token, t.qty.toString()]);
    const states = replayAt(moves, null, [T0, T0 + M, T0 + 2 * M, T0 + 3 * M]);
    expect([states[0]!.cash.toString(), tokensOf(0, states)]).toEqual([
      '-300',
      [['HYPE', '9.993']],
    ]);
    expect([states[1]!.cash.toString(), tokensOf(1, states)]).toEqual([
      '-140.112',
      [['HYPE', '4.993']],
    ]);
    expect([states[2]!.flows.toString(), tokensOf(2, states)]).toEqual(['62', [['HYPE', '6.993']]]);
    expect(tokensOf(3, states)).toEqual([
      ['HYPE', '6.993'],
      ['PURR', '100'],
      ['USDH', '-20'],
    ]);
    // Seul un cours coté en trésorerie vaut cours exécuté du jeton.
    expect(states[0]!.traded).toEqual({ [tokenMarket('HYPE')]: D('30') });
    expect(states[3]!.traded).toEqual({});
  });

  it('les soldes spot lus recalent les jetons à TOUS les instants ; une poussière ne compte pas', () => {
    const moves: AccountMove[] = [flow(T0, '5', 'HYPE', '150')];
    const spot = { time: T0 + 5 * M, balances: { HYPE: '7', USDC: '999', PURR: '0.0000001' } };
    const [early, late] = replayAt(moves, spot, [T0 - M, T0 + M]);
    expect(early!.tokens.map((t) => [t.token, t.qty.toString()])).toEqual([['HYPE', '2']]);
    expect(late!.tokens.map((t) => [t.token, t.qty.toString()])).toEqual([['HYPE', '7']]);
    // La trésorerie n'est jamais recalée par l'instantané : c'est le rôle du calage.
    expect(late!.cash.toString()).toBe('0');
  });
});

describe('priceNear et valuationOf — le cours d’un instant et ce qu’il laisse d’incertain', () => {
  const series = { intervalMs: M, candles: minuteCandles(BTC_CLOSES) };

  it('dans une bougie : interpolation ouverture → clôture et son amplitude ; après : la clôture ; avant : rien', () => {
    expect(priceNear(series, T0 - 1)).toBeNull();
    expect(priceNear(undefined, T0)).toBeNull();
    const inside = priceNear(series, T0 + 5 * M + 30_000)!;
    expect([inside.price.toString(), inside.range.toString()]).toEqual(['103.5', '3']);
    const after = priceNear(series, T0 + 12 * M)!;
    expect([after.price.toString(), after.range.toString()]).toEqual(['110', '0']);
  });

  it('valeur = trésorerie + taille × (cours − entrée) + jetons × cours, exposition et incertitude incluses', () => {
    const [state] = replayAt(
      [
        flow(T0 - M, '1000'),
        perp({ time: T0 - M, side: 'sell', qty: '2', price: '105' }),
        flow(T0 - M, '3', 'HYPE', '90'),
      ],
      null,
      [T0 + 5 * M + 30_000],
    );
    const book: PriceBook = {
      ...btcBook(),
      [tokenMarket('HYPE')]: {
        intervalMs: M,
        candles: [{ t: T0 + 5 * M, o: '30', h: '31', l: '29', c: '30' }],
      },
    };
    const v = valuationOf(state!, book, false);
    // 1 000 + (−2) × (103,5 − 105) + 3 × 30
    expect(v.value.toString()).toBe('1093');
    expect(v.exposure.toString()).toBe('297');
    expect(v.slack.toString()).toBe('12');
    expect(v.missing).toEqual([]);
    const blind = valuationOf(state!, {}, false);
    expect(blind.missing).toEqual([perpMarket('BTC'), tokenMarket('HYPE')]);
  });
});

describe('marketsHeld — les cours à charger', () => {
  it('ce qui est tenu au départ, plus ce que la fenêtre touche, sans la trésorerie', () => {
    const moves: AccountMove[] = [
      perp({ time: T0 - M, coin: 'ETH' }),
      perp({ time: T0 + M, coin: 'BTC' }),
      perp({ time: T0 + 20 * M, coin: 'SOL' }),
      {
        kind: 'spot',
        time: T0 + 2 * M,
        base: 'PURR',
        quote: 'USDC',
        side: 'buy',
        qty: '1',
        price: '1',
        fee: '0',
        feeToken: 'PURR',
      },
      flow(T0 + 3 * M, '1', 'HYPE', '30'),
    ];
    expect(marketsHeld(moves, { time: T0, balances: { UBTC: '0.1' } }, T0, T0 + 10 * M)).toEqual({
      perps: ['BTC', 'ETH'],
      tokens: ['HYPE', 'PURR', 'UBTC'],
    });
  });
});

describe('detailedCurve — la courbe détaillée, calée et recoupée', () => {
  const long = (): AccountMove[] => [
    flow(T0 - M, '10000'),
    perp({ time: T0 + 2 * M, qty: '1', price: '100', fee: '0.05' }),
  ];

  it('compte à plat : la trésorerie seule, calée au centime sur les points de la plateforme', () => {
    const outcome = detailedCurve(
      base({
        moves: [flow(T0 - M, '1000'), { kind: 'funding', time: T0 + 5 * M, amount: '-2' }],
        equity: [
          [T0, '1000'],
          [T0 + 10 * M, '998'],
        ],
      }),
    );
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    expect(values(outcome.points)).toEqual([
      ...Array<string>(5).fill('1000'),
      ...Array<string>(6).fill('998'),
    ]);
    expect([outcome.offset.toString(), outcome.checked, outcome.maxDeviation.toString()]).toEqual([
      '0',
      2,
      '0',
    ]);
  });

  it('un historique tronqué se rattrape par le calage : les dépôts antérieurs ne manquent pas', () => {
    const outcome = detailedCurve(
      base({
        moves: [{ kind: 'funding', time: T0 + 5 * M, amount: '-2' }],
        equity: [
          [T0, '1000'],
          [T0 + 10 * M, '998'],
        ],
      }),
    );
    expect(outcome.kind === 'ok' && outcome.offset.toString()).toBe('1000');
  });

  it('position ouverte : un point par clôture et un au fill (au cours exécuté), recoupés dans la marge du cours', () => {
    const outcome = detailedCurve(
      base({
        moves: long(),
        prices: btcBook(),
        equity: [
          [T0, '10000'],
          // Marque légèrement au-dessus du cours interpolé (103,5) : dans l'amplitude de la bougie.
          [T0 + 5 * M + 30_000, '10003.6'],
        ],
      }),
    );
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    expect(values(outcome.points)).toEqual([
      '10000',
      '10000',
      '9999.95',
      '9999.95',
      '10001.95',
      '10003.95',
      '10002.95',
      '10004.95',
      '10006.95',
      '10005.95',
      '10009.95',
    ]);
    expect([outcome.checked, outcome.maxDeviation.toString()]).toEqual([2, '0.15']);
    // L'écart à montrer est celui du point à plat : exact, sans cours.
    expect([outcome.flatChecked, outcome.flatDeviation?.toString()]).toEqual([1, '0']);
  });

  it('un point de la plateforme hors de ce que le cours explique écarte la reconstitution, et se nomme', () => {
    const outcome = detailedCurve(
      base({
        moves: long(),
        prices: btcBook(),
        equity: [
          [T0, '10000'],
          [T0 + 5 * M + 30_000, '10020'],
        ],
      }),
    );
    expect(outcome.kind).toBe('mismatch');
    if (outcome.kind !== 'mismatch') return;
    expect(outcome.worst.time).toBe(T0 + 5 * M + 30_000);
    expect(outcome.worst.deviation.toString()).toBe('16.55');
    // 3 d'amplitude + 0,05 % de 103,5 d'exposition + le plancher de 10 $ sur la valeur.
    expect(outcome.worst.allowed.toString()).toBe('13.05175');
    expect(outcome.checked).toBe(2);
  });

  it('le calage vient des points les moins exposés : un point à plat prime sur un point en position', () => {
    const outcome = detailedCurve(
      base({
        moves: long(),
        prices: btcBook(),
        equity: [
          // Exposé, écart de 2 dans la marge ; à plat, exact. La médiane des deux donnerait 1.
          [T0 + 5 * M + 30_000, '10005.45'],
          [T0 + M, '10000'],
        ],
      }),
    );
    expect(outcome.kind === 'ok' && outcome.offset.toString()).toBe('0');
  });

  it('un point à plat HORS de la fenêtre cale mieux qu’un point en position dedans', () => {
    const outcome = detailedCurve(
      base({
        moves: long(),
        prices: btcBook(),
        equity: [
          // À plat, juste avant la fenêtre (le dépôt est passé) : la trésorerie, exacte.
          [T0 - 30_000, '10000'],
          // En position dans la fenêtre, 2 $ au-dessus du cours interpolé : la marque.
          [T0 + 5 * M + 30_000, '10005.45'],
        ],
      }),
    );
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    expect(outcome.offset.toString()).toBe('0');
    expect([outcome.checked, outcome.maxDeviation.toString()]).toEqual([1, '2']);
    expect([outcome.flatChecked, outcome.flatDeviation]).toEqual([0, null]);
    // Sans lui, le point exposé calerait tout, écart de marque compris.
    const alone = detailedCurve(
      base({ moves: long(), prices: btcBook(), equity: [[T0 + 5 * M + 30_000, '10005.45']] }),
    );
    expect(alone.kind === 'ok' && alone.offset.toString()).toBe('2');
  });

  it('les trois points à plat les plus proches, et leur médiane : un point bruité ne décide pas seul', () => {
    const outcome = detailedCurve(
      base({
        moves: [flow(T0 - 600 * M, '1000')],
        equity: [
          [T0 - 500 * M, '1030'],
          [T0 - 3 * M, '1004'],
          [T0 + 5 * M, '1006'],
          [T0 + 20 * M, '1005'],
        ],
      }),
    );
    expect(outcome.kind === 'ok' && outcome.offset.toString()).toBe('5');
  });

  it('un dépôt manquant entre deux points à plat se voit', () => {
    const outcome = detailedCurve(
      base({
        moves: [flow(T0 - M, '1000')],
        equity: [
          [T0, '1000'],
          [T0 + 10 * M, '1500'],
        ],
      }),
    );
    expect(outcome.kind).toBe('mismatch');
  });

  it('sans point de la plateforme dans la fenêtre, rien ne cale : pas de courbe', () => {
    expect(
      detailedCurve(base({ moves: long(), prices: btcBook(), equity: [[T0 - 5 * M, '10000']] })),
    ).toEqual({ kind: 'no-anchor' });
  });

  it('une position sans cours, ou d’entrée inconnue, rend la valeur indéterminée', () => {
    const outcome = detailedCurve(
      base({
        moves: long(),
        equity: [
          [T0, '10000'],
          [T0 + 5 * M, '10003'],
        ],
      }),
    );
    expect(outcome).toEqual({ kind: 'no-price', markets: [perpMarket('BTC')] });
    // Une série de cours vide : le calage à plat passe, mais les points tracés en position manquent.
    const gap = detailedCurve(
      base({
        moves: long(),
        prices: {
          [perpMarket('BTC')]: { intervalMs: M, candles: minuteCandles([100]).slice(0, 0) },
        },
        equity: [[T0, '10000']],
      }),
    );
    expect(gap).toEqual({ kind: 'no-price', markets: [perpMarket('BTC')] });
  });

  it('P&L : un dépôt n’est pas un gain, et la constante de la série se lit sur ses propres points', () => {
    const moves: AccountMove[] = [flow(T0 - 60 * M, '1000'), flow(T0 + 5 * M, '500')];
    const equity: CurvePoint[] = [
      [T0 - 60 * M, '1000'],
      [T0, '1000'],
      [T0 + 10 * M, '1500'],
    ];
    const pnl = (last: string): CurvePoint[] => [
      [T0 - 60 * M, '0'],
      [T0, '0'],
      [T0 + 10 * M, last],
    ];
    const outcome = detailedCurve(base({ moves, equity, pnl: { equity, points: pnl('0') } }));
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    expect(new Set(values(outcome.points))).toEqual(new Set(['0']));
    // Deux points d'équité et deux de P&L dans la fenêtre.
    expect(outcome.checked).toBe(4);

    const disagreeing = detailedCurve(base({ moves, equity, pnl: { equity, points: pnl('-50') } }));
    expect(disagreeing.kind === 'mismatch' && disagreeing.worst.deviation.toString()).toBe('-50');
  });

  it('« depuis l’ouverture » : dépôts antérieurs au premier point et départ à zéro, comme la plateforme', () => {
    // Comme relevé sur un compte réel (montants fictifs) : 500 $ déposés avant le premier point, qui
    // vaut 0 ; puis 497 $ et un P&L de −3 $ — la plateforme compte TOUS les dépôts, pas ceux de la
    // fenêtre.
    const moves: AccountMove[] = [
      flow(T0 - 3 * 24 * 60 * M, '100'),
      flow(T0 - 2 * 24 * 60 * M, '400'),
      { kind: 'funding', time: T0 - 24 * 60 * M, amount: '-3' },
    ];
    const equity: CurvePoint[] = [
      [T0, '0'],
      [T0 + 5 * M, '497'],
      [T0 + 10 * M, '497'],
    ];
    const points: CurvePoint[] = [
      [T0, '0'],
      [T0 + 5 * M, '-3'],
      [T0 + 10 * M, '-3'],
    ];
    const outcome = detailedCurve(
      base({ moves, equity: withoutZeroSeed(equity), pnl: { equity, points } }),
    );
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    expect(new Set(values(outcome.points))).toEqual(new Set(['-3']));
    // Le départ à zéro n'est recoupé ni en équité ni en P&L.
    expect(outcome.checked).toBe(4);
    // Pris pour une mesure, il écarterait tout.
    expect(detailedCurve(base({ moves, equity, pnl: null })).kind).toBe('mismatch');
  });

  it('withoutZeroSeed : seul un premier point nul suivi d’autres points s’écarte', () => {
    expect(
      withoutZeroSeed([
        [1, '0.0'],
        [2, '5'],
      ] as CurvePoint[]),
    ).toEqual([[2, '5']]);
    const alone: CurvePoint[] = [[1, '0']];
    expect(withoutZeroSeed(alone)).toBe(alone);
    const later: CurvePoint[] = [
      [1, '3'],
      [2, '0'],
    ];
    expect(withoutZeroSeed(later)).toBe(later);
    expect(withoutZeroSeed([])).toEqual([]);
  });
});

describe('propriété — échanger au cours ne crée ni ne détruit de valeur, hors frais', () => {
  it('juste après un fill, la valeur au cours exécuté = juste avant au même cours − frais', () => {
    const step = fc.record({
      delta: fc.integer({ min: -5, max: 5 }).filter((d) => d !== 0),
      price: fc.integer({ min: 50, max: 150 }),
      fee: fc.integer({ min: -3, max: 30 }),
    });
    fc.assert(
      fc.property(fc.array(step, { minLength: 1, maxLength: 25 }), (steps) => {
        const moves: AccountMove[] = [];
        let size = ZERO;
        let entry: Big | null = null;
        steps.forEach((s, i) => {
          const price = D(String(s.price));
          const delta = D(String(s.delta));
          const end = size.plus(delta);
          let closedPnl = ZERO;
          if (!size.eq(ZERO) && size.gt(ZERO) !== delta.gt(ZERO)) {
            const closed = min(delta.abs(), size.abs());
            const sign = size.gt(ZERO) ? D('1') : D('-1');
            closedPnl = price.minus(entry!).times(closed).times(sign);
          }
          if (end.eq(ZERO)) entry = null;
          else if (size.eq(ZERO) || size.gt(ZERO) !== end.gt(ZERO)) entry = price;
          else if (end.abs().gt(size.abs()))
            entry = entry!.times(size.abs()).plus(price.times(delta.abs())).div(end.abs());
          moves.push(
            perp({
              time: T0 + (i + 1) * M,
              side: delta.gt(ZERO) ? 'buy' : 'sell',
              qty: delta.abs().toString(),
              price: s.price.toString(),
              startPosition: size.toString(),
              closedPnl: closedPnl.toString(),
              fee: D(String(s.fee)).div('100').toString(),
            }),
          );
          size = end;
        });
        const times = moves.flatMap((m) => [m.time - 1, m.time]);
        const states = replayAt(moves, null, times);
        moves.forEach((move, i) => {
          const fill = move as PerpFillMove;
          const before = states[2 * i]!;
          const after = states[2 * i + 1]!;
          const price = D(fill.price);
          const valueBefore = before.positions.reduce(
            (acc, p) => acc.plus(p.size.times(price.minus(p.entry!))),
            before.cash,
          );
          const valueAfter = valuationOf(after, {}, true).value;
          const drift = valueAfter.minus(valueBefore.minus(fill.fee)).abs();
          expect(drift.lte('0.000000001')).toBe(true);
        });
      }),
      { numRuns: 200 },
    );
  });
});
