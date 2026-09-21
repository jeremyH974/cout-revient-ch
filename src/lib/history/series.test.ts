import { describe, expect, it } from 'vitest';
import { D, ZERO } from '../domain/money';
import { eachDay } from './days';
import {
  assetMetricPoints,
  holdingOpsOf,
  holdingStep,
  holdingsByDay,
  lastPointAtOrBefore,
  mergeLivePoint,
  periodPerformance,
  openingDay,
  periodWindow,
  resolveWindow,
  sliceSeries,
  windowSeries,
  valueSeries,
  type FlowPoint,
  type ValuePoint,
} from './series';

const op = (at: string, qtyAfter: string, pruAfter: string | null) => ({
  at,
  qtyAfter: D(qtyAfter),
  pruAfter: pruAfter === null ? null : D(pruAfter),
});
const point = (day: string, value: string): ValuePoint => ({
  day,
  value: D(value),
  cost: ZERO,
  missing: [],
  estimatedValue: ZERO,
});

describe('holdingOpsOf — virements internes appariés', () => {
  // Retrait le 10 à 23 h 30, dépôt le 12 à 1 h 00 : sans filtre, l'actif quitte le portefeuille
  // consolidé pendant deux jours et la courbe de valeur tombe à zéro puis remonte.
  const history = [
    { eventId: 'buy', ...op('2026-03-01T10:00:00', '1', '1000') },
    { eventId: 'w', ...op('2026-03-10T23:30:00', '0', null) },
    { eventId: 'd', ...op('2026-03-12T01:00:00', '0.999', '1001') },
  ];
  const days = eachDay('2026-03-09', '2026-03-13');
  const prices = { btc: { points: days.map((day) => ({ day, priceEur: '2000' })) } };

  it('sans le filtre, la valeur consolidée s’effondre pendant le transit', () => {
    const series = valueSeries({ holdings: holdingsByDay({ btc: history }), prices, days });
    expect(series.map((p) => p.value.toString())).toEqual(['2000', '0', '0', '1998', '1998']);
  });

  it('avec le filtre, la position reste détenue pendant le transit', () => {
    const ops = holdingOpsOf(history, { w: 'out', d: 'in' });
    const series = valueSeries({ holdings: holdingsByDay({ btc: ops }), prices, days });
    expect(series.map((p) => p.value.toString())).toEqual(['2000', '2000', '2000', '1998', '1998']);
  });

  it('garde la jambe entrante : les frais de réseau sont bien retenus au solde final', () => {
    const ops = holdingOpsOf(history, { w: 'out', d: 'in' });
    expect(holdingStep(ops)('2026-03-20').qty.toString()).toBe('0.999');
  });

  it('ne touche pas aux mouvements ordinaires ni aux virements non appariés', () => {
    expect(holdingOpsOf(history, {})).toHaveLength(3);
    expect(holdingOpsOf(history, { autre: 'out' })).toHaveLength(3);
  });
});

describe('holdingsByDay', () => {
  it('fonction en escalier : dernière opération du jour, zéro avant la première', () => {
    const step = holdingStep([
      op('2026-08-20T10:00:00', '2', '100'),
      op('2026-08-18T09:00:00', '1', '100'),
      op('2026-08-20T18:00:00', '1.5', '100'),
      op('2026-08-22T08:00:00', '0', null),
    ]);
    expect(step('2026-08-17').qty.toString()).toBe('0');
    expect(step('2026-08-18').qty.toString()).toBe('1');
    expect(step('2026-08-19').cost.toString()).toBe('100');
    expect(step('2026-08-20').qty.toString()).toBe('1.5');
    expect(step('2026-08-20').cost.toString()).toBe('150');
    expect(step('2026-08-21').qty.toString()).toBe('1.5');
    expect(step('2026-08-22').cost.toString()).toBe('0');
    expect(step('2030-01-01').qty.toString()).toBe('0');
    const steps = holdingsByDay({ btc: [op('2026-08-18T00:00:00', '1', '50')], eth: [] });
    expect(steps['btc']!('2026-08-18').cost.toString()).toBe('50');
    expect(steps['eth']!('2026-08-18').qty.toString()).toBe('0');
  });
});

describe('valueSeries', () => {
  const holdings = holdingsByDay({
    btc: [op('2026-08-18T10:00:00', '1', '50000'), op('2026-08-20T10:00:00', '2', '55000')],
    eth: [op('2026-08-19T10:00:00', '10', '2000')],
    gmx: [op('2026-08-18T10:00:00', '5', '10')],
  });
  const prices = {
    btc: {
      points: [
        { day: '2026-08-18', priceEur: '60000' },
        { day: '2026-08-19', priceEur: '61000' },
      ],
    },
    eth: {
      points: [
        { day: '2026-08-20', priceEur: '3000' },
        { day: '2026-08-21', priceEur: '3100' },
      ],
    },
  };

  it('Σ qté × prix du jour, dernier prix connu ; actifs sans prix comptés à leur coût et listés', () => {
    const series = valueSeries({ holdings, prices, days: eachDay('2026-08-17', '2026-08-21') });
    expect(series.map((p) => `${p.day} ${p.value} ${p.cost} [${p.missing.join(',')}]`)).toEqual([
      '2026-08-17 0 0 []',
      '2026-08-18 60050 50050 [gmx]',
      '2026-08-19 81050 70050 [eth,gmx]',
      '2026-08-20 152050 130050 [gmx]',
      '2026-08-21 153050 130050 [gmx]',
    ]);
  });

  it('lastPointAtOrBefore : recherche binaire sur points triés', () => {
    const points = prices.btc.points;
    expect(lastPointAtOrBefore(points, '2026-08-17')).toBeNull();
    expect(lastPointAtOrBefore(points, '2026-08-18')!.priceEur).toBe('60000');
    expect(lastPointAtOrBefore(points, '2026-12-31')!.priceEur).toBe('61000');
    expect(lastPointAtOrBefore([], '2026-08-18')).toBeNull();
  });

  it('mergeLivePoint remplace ou ajoute le point du jour sans casser le tri', () => {
    const points = prices.btc.points;
    expect(
      mergeLivePoint(points, '2026-08-19', '62000').map((p) => `${p.day}:${p.priceEur}`),
    ).toEqual(['2026-08-18:60000', '2026-08-19:62000']);
    expect(mergeLivePoint(points, '2026-08-20', '63000').map((p) => p.day)).toEqual([
      '2026-08-18',
      '2026-08-19',
      '2026-08-20',
    ]);
    expect(mergeLivePoint([], '2026-08-20', '1')).toEqual([{ day: '2026-08-20', priceEur: '1' }]);
  });
});

describe('scénario de référence J0..J3 (2 actifs, 3 jours)', () => {
  // J1 achat 0,1 BTC 5 050 € (PRU 50 500) ; J2 achat 1 ETH 1 910 € ; J3 vente 0,05 BTC 2 560 €.
  const holdings = holdingsByDay({
    btc: [op('2026-08-20T10:00:00', '0.1', '50500'), op('2026-08-22T09:00:00', '0.05', '50500')],
    eth: [op('2026-08-21T11:00:00', '1', '1910')],
  });
  const prices = {
    btc: {
      points: [
        { day: '2026-08-20', priceEur: '50000' },
        { day: '2026-08-21', priceEur: '52000' },
        { day: '2026-08-22', priceEur: '51000' },
      ],
    },
    eth: {
      points: [
        { day: '2026-08-20', priceEur: '2000' },
        { day: '2026-08-21', priceEur: '1900' },
        { day: '2026-08-22', priceEur: '2100' },
      ],
    },
  };
  const series = valueSeries({ holdings, prices, days: eachDay('2026-08-19', '2026-08-22') });
  const flows: FlowPoint[] = [
    { day: '2026-08-20', amountEur: D('5050') },
    { day: '2026-08-21', amountEur: D('1910') },
    { day: '2026-08-22', amountEur: D('-2560') },
  ];

  it('valeurs et coûts en fin de jour', () => {
    expect(series.map((p) => `${p.day} ${p.value} ${p.cost}`)).toEqual([
      '2026-08-19 0 0',
      '2026-08-20 5000 5050',
      '2026-08-21 7100 6960',
      '2026-08-22 4650 4435',
    ]);
  });

  it('« Tout » : gain 250 € (= réalisé 35 + latent 215), Dietz modifié pondéré par le temps restant', () => {
    const perf = periodPerformance(series, flows)!;
    expect(perf.netFlows.toString()).toBe('4400');
    expect(perf.gain.toString()).toBe('250');
    // 5 050 × 2/3 + 1 910 × 1/3 + (−2 560) × 0 = 4 003,33…
    expect(perf.weightedFlows.toFixed(2)).toBe('4003.33');
    expect(perf.pct!.toFixed(4)).toBe('0.0624');
  });

  it('fenêtre J2..J3 : le retrait du dernier jour ne pèse rien dans la base', () => {
    const perf = periodPerformance(series.slice(2), flows)!;
    expect(perf.startValue.toString()).toBe('7100');
    expect(perf.netFlows.toString()).toBe('-2560');
    expect(perf.weightedFlows.toString()).toBe('0');
    expect(perf.gain.toString()).toBe('110');
    expect(perf.pct!.toFixed(4)).toBe('0.0155');
  });
});

describe('actif sans cotation en tête de série (XYZ)', () => {
  // Achat 1 XYZ à 100 € le J1 ; première clôture connue J3 = 120 €.
  const step = holdingStep([op('2026-08-20T10:00:00', '1', '100')]);
  const points = [{ day: '2026-08-22', priceEur: '120' }];
  const days = eachDay('2026-08-19', '2026-08-22');
  const flows: FlowPoint[] = [{ day: '2026-08-20', amountEur: D('100') }];

  it('portefeuille : compté au coût tant que le prix manque ; performance +20 € sur J2..J3 comme sur « Tout »', () => {
    const series = valueSeries({ holdings: { xyz: step }, prices: { xyz: { points } }, days });
    expect(series.map((p) => `${p.day} ${p.value} ${p.cost} [${p.missing.join(',')}]`)).toEqual([
      '2026-08-19 0 0 []',
      '2026-08-20 100 100 [xyz]',
      '2026-08-21 100 100 [xyz]',
      '2026-08-22 120 100 []',
    ]);
    expect(periodPerformance(series.slice(2), flows)!.gain.toString()).toBe('20');
    const all = periodPerformance(series, flows)!;
    expect(all.gain.toString()).toBe('20');
    // apport le J1 : 2/3 de la période restent → base 66,67 €
    expect(all.pct!.toFixed(4)).toBe('0.3000');
  });

  it('actif : jamais valeur 0 face à un investi plein ; points estimés marqués, prix null', () => {
    const metric = assetMetricPoints({ step, points, days });
    expect(
      metric.map((p) => `${p.day} ${p.value} ${p.cost} ${p.price ?? '-'} ${p.estimated}`),
    ).toEqual([
      '2026-08-19 0 0 - false',
      '2026-08-20 100 100 - true',
      '2026-08-21 100 100 - true',
      '2026-08-22 120 100 120 false',
    ]);
    expect(metric[3]!.qty!.toString()).toBe('1');
  });
});

describe('périodes', () => {
  it('periodWindow rend le PREMIER jour compris, en calendaire UTC (décision n° 179)', () => {
    // « 1 mois » au 31 mars couvre du 1er au 31 mars ; sa base est la clôture du 28 février.
    expect(periodWindow('1d', '2026-08-22')).toEqual({ from: '2026-08-22', to: '2026-08-22' });
    expect(periodWindow('1w', '2026-08-22')).toEqual({ from: '2026-08-16', to: '2026-08-22' });
    expect(periodWindow('1m', '2026-03-31')).toEqual({ from: '2026-03-01', to: '2026-03-31' });
    expect(periodWindow('3m', '2026-08-22')).toEqual({ from: '2026-05-23', to: '2026-08-22' });
    expect(periodWindow('1y', '2024-02-29')).toEqual({ from: '2023-03-01', to: '2024-02-29' });
    expect(periodWindow('all', '2026-08-22')).toEqual({ from: null, to: '2026-08-22' });
  });

  it('une semaine compte sept jours de flux, pas huit', () => {
    // Le défaut corrigé : le jour de BASE était rangé dans `from`, et un filtre de flux « jour ≥
    // from » (les trades clos, les fills) comptait donc un jour de trop.
    const { from, to } = periodWindow('1w', '2026-08-22');
    expect(eachDay(from!, to)).toHaveLength(7);
  });

  it('windowSeries garde la clôture d’ouverture ; sliceSeries reste un simple filtre de jours', () => {
    const series = eachDay('2026-08-01', '2026-08-31').map((day) => point(day, '1'));
    // Une présélection : la même coupe qu'avant — la courbe et le bandeau n'en bougent pas.
    expect(windowSeries(series, periodWindow('1w', '2026-08-22')).map((p) => p.day)).toEqual(
      eachDay('2026-08-15', '2026-08-22'),
    );
    // Une plage libre garde la veille de son premier jour : sa première variation disparaissait.
    expect(
      windowSeries(series, { from: '2026-08-10', to: '2026-08-12' }).map((p) => p.day),
    ).toEqual(['2026-08-09', '2026-08-10', '2026-08-11', '2026-08-12']);
    expect(sliceSeries(series, { from: '2026-08-10', to: '2026-08-12' })).toHaveLength(3);
    expect(windowSeries(series, { from: null, to: '2026-08-02' })).toHaveLength(2);
    expect(openingDay({ from: '2026-03-01', to: '2026-03-31' })).toBe('2026-02-28');
    expect(openingDay({ from: null, to: '2026-03-31' })).toBeNull();
  });

  it('periodPerformance neutralise les apports (bornes exclusive/inclusive, Dietz modifié)', () => {
    const series = [
      point('2026-08-18', '1000'),
      point('2026-08-20', '1450'),
      point('2026-08-22', '1600'),
    ];
    const flows = [
      { day: '2026-08-18', amountEur: D('1000') }, // déjà dans la valeur de départ
      { day: '2026-08-20', amountEur: D('500') },
      { day: '2026-08-22', amountEur: D('-100') },
      { day: '2026-08-23', amountEur: D('999') }, // hors période
    ];
    const perf = periodPerformance(series, flows)!;
    expect(perf.from).toBe('2026-08-18');
    expect(perf.to).toBe('2026-08-22');
    expect(perf.netFlows.toString()).toBe('400');
    expect(perf.gain.toString()).toBe('200');
    // +500 à mi-période (poids 1/2), −100 le dernier jour (poids 0) : base 1 000 + 250
    expect(perf.weightedFlows.toString()).toBe('250');
    expect(perf.pct!.toFixed(4)).toBe('0.1600');
    expect(periodPerformance([], flows)).toBeNull();
    const zeroBase = periodPerformance([point('2026-08-18', '0'), point('2026-08-19', '10')], []);
    expect(zeroBase!.gain.toString()).toBe('10');
    expect(zeroBase!.pct).toBeNull();
  });
});

describe('valueSeries — part portée au coût', () => {
  /*
   * Le cas qui a motivé la mesure : un portefeuille coté à 90 %, avec un seul jeton sans cours.
   * Le booléen `missing.length > 0` disait « journée estimée » et l'écran décolorait tout ;
   * `estimatedValue` dit la vérité — 100 € sur 1 100 €, soit 9 %.
   */
  const days = ['2026-01-01'];
  const holdings = holdingsByDay({
    btc: [op('2026-01-01T00:00:00', '1', '900')],
    obscur: [op('2026-01-01T00:00:00', '10', '10')],
  });

  it('ne compte que le coût des actifs sans cotation, pas la valeur entière', () => {
    const [p] = valueSeries({
      holdings,
      prices: { btc: { points: [{ day: '2026-01-01', priceEur: '1000' }] } },
      days,
    });
    expect(p!.missing).toEqual(['obscur']);
    expect(p!.value.toString()).toBe('1100');
    expect(p!.estimatedValue.toString()).toBe('100');
  });

  it('vaut zéro quand tout est coté, et la valeur entière quand rien ne l’est', () => {
    const tout = valueSeries({
      holdings,
      prices: {
        btc: { points: [{ day: '2026-01-01', priceEur: '1000' }] },
        obscur: { points: [{ day: '2026-01-01', priceEur: '10' }] },
      },
      days,
    });
    expect(tout[0]!.estimatedValue.toString()).toBe('0');
    const rien = valueSeries({ holdings, prices: {}, days });
    expect(rien[0]!.estimatedValue.toString()).toBe(rien[0]!.value.toString());
  });

  it('ignore un actif soldé : sans quantité, il ne manque à personne', () => {
    const solde = holdingsByDay({
      obscur: [op('2025-12-01T00:00:00', '10', '10'), op('2025-12-31T00:00:00', '0', null)],
    });
    const [p] = valueSeries({ holdings: solde, prices: {}, days });
    expect(p!.missing).toEqual([]);
    expect(p!.estimatedValue.toString()).toBe('0');
  });
});

/**
 * La plage libre (décision n° 157). `DayWindow` acceptait déjà n'importe quelles bornes : ce qui se
 * vérifie ici n'est pas le calcul — il n'a rien appris — mais la **traduction** d'un choix en
 * fenêtre, seul endroit où un `custom` peut mentir.
 */
describe('résoudre un choix de plage en fenêtre', () => {
  const today = '2026-09-16';

  it('rend les bornes saisies, telles quelles', () => {
    expect(resolveWindow('custom', { from: '2026-03-03', to: '2026-04-12' }, today)).toEqual({
      from: '2026-03-03',
      to: '2026-04-12',
    });
  });

  it('lit une saisie inversée dans l’ordre, plutôt que de rendre une fenêtre vide', () => {
    // Une fenêtre vide afficherait « aucune donnée » à quelqu'un qui a simplement rempli les deux
    // champs à l'envers — un écran qui accuse l'utilisateur d'un problème qu'il n'a pas.
    expect(resolveWindow('custom', { from: '2026-04-12', to: '2026-03-03' }, today)).toEqual({
      from: '2026-03-03',
      to: '2026-04-12',
    });
  });

  it('accepte une plage d’un seul jour', () => {
    expect(resolveWindow('custom', { from: today, to: today }, today)).toEqual({
      from: today,
      to: today,
    });
  });

  it('ignore les bornes quand la plage n’est pas libre', () => {
    // Le piège serait qu'une plage libre saisie puis abandonnée continue de gouverner l'écran.
    expect(resolveWindow('1m', { from: '2020-01-01', to: '2020-02-01' }, today)).toEqual(
      periodWindow('1m', today),
    );
  });

  it('retombe sur « tout » pour un custom sans bornes, un état que la relecture normalise', () => {
    expect(resolveWindow('custom', null, today)).toEqual({ from: null, to: today });
  });
});
