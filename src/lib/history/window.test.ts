/**
 * Le cœur de la fenêtre d'analyse (P118), sur des exemples qui se vérifient de tête.
 *
 * Le cas canonique est celui qui démasque les deux fautes classiques d'une fenêtre : il COMMENCE
 * avec un portefeuille non vide (couper les flux ferait disparaître ce capital) et reçoit en cours
 * de route un apport **onze fois** plus gros que lui (un rendement simple le confondrait avec un
 * gain). Dix unités achetées 100 € le 1er janvier, cent de plus à 120 € le 15 février :
 *
 *   cours    100 (01/01) · 105 (16/01) · 110 (01/02) · 120 (08/02) · 130 (01/03)
 *   valeur   1 000 → 1 050 (31/01, veille de la fenêtre) → 1 100 → 1 200 → 13 200 → 14 300 (02/03)
 *
 * Fenêtre du 1er février au 2 mars : ouverture 1 050 €, apport 12 000 €, clôture 14 300 €.
 */
import { describe, expect, it } from 'vitest';
import { computePortfolio, holdings, type CashFlow, type PortfolioReport } from '../domain/engine';
import { D, ONE, ZERO, type Big } from '../domain/money';
import type { TwrDay, TwrFlow } from '../domain/twr';
import {
  DEFAULT_ENGINE_SETTINGS,
  type EngineSettings,
  type FeeEvent,
  type IncomeEvent,
  type LedgerEvent,
  type RewardEvent,
  type TradeEvent,
} from '../domain/types';
import { xirrEur } from '../domain/xirr';
import { presentMoneyWeighted, presentTimeWeighted } from '../derive/presented-return';
import { eachDay } from './days';
import { computePerformance, externalFlows } from './performance';
import type { MetricPoint } from './metrics';
import type { DayWindow } from './series';
import {
  inWindow,
  openingDay,
  valueAt,
  windowFlows,
  windowGain,
  windowMwr,
  windowTwr,
  type WindowInput,
} from './window';

const near = (value: Big | null, expected: number, tolerance = 1e-12): void => {
  expect(value).not.toBeNull();
  expect(Math.abs(Number(value!.toString()) - expected)).toBeLessThan(tolerance);
};

// --- Le cas canonique -------------------------------------------------------------------------

const PRICES: readonly [since: string, price: string][] = [
  ['2026-01-01', '100'],
  ['2026-01-16', '105'],
  ['2026-02-01', '110'],
  ['2026-02-08', '120'],
  ['2026-03-01', '130'],
];
const priceOn = (day: string): Big =>
  D(PRICES.filter(([since]) => since <= day).at(-1)?.[1] ?? '0');
const qtyOn = (day: string): Big =>
  day < '2026-01-01' ? ZERO : day < '2026-02-15' ? D('10') : D('110');

/** De la veille du premier achat (valeur nulle) au 2 mars : la forme de `history.metricPoints`. */
const SERIES: TwrDay[] = eachDay('2025-12-31', '2026-03-02').map((day) => ({
  day,
  value: qtyOn(day).times(priceOn(day)),
}));
/** Les flux du moteur (signe de l'investisseur) : deux achats à minuit, au cours de la veille. */
const CASH_FLOWS: CashFlow[] = [
  { at: '2026-01-01T00:00:00', amountEur: D('-1000'), eventId: 'achat-1' },
  { at: '2026-02-15T00:00:00', amountEur: D('-12000'), eventId: 'achat-2' },
];
const FLOWS: TwrFlow[] = externalFlows(CASH_FLOWS, {});
const INPUT: WindowInput = { series: SERIES, flows: FLOWS };
const WINDOW: DayWindow = { from: '2026-02-01', to: '2026-03-02' };

describe('le cas canonique : départ non vide, gros apport en cours de fenêtre', () => {
  it('la série est bien celle de l’en-tête', () => {
    expect(valueAt(SERIES, '2026-01-31').toString()).toBe('1050');
    expect(valueAt(SERIES, '2026-02-14').toString()).toBe('1200');
    expect(valueAt(SERIES, '2026-02-15').toString()).toBe('13200');
    expect(valueAt(SERIES, '2026-03-02').toString()).toBe('14300');
  });

  it('gain : 14 300 − 1 050 − 12 000 = 1 250 €', () => {
    expect(windowGain(INPUT, WINDOW)).toEqual({
      startDay: '2026-01-31',
      startValue: D('1050'),
      endValue: D('14300'),
      netFlows: D('12000'),
      gain: D('1250'),
    });
  });

  it('TWR : le rapport des cours 130/105 − 1 = 5/21, l’apport n’y pèse rien', () => {
    // L'apport entre à minuit au cours de la veille : le jour de l'apport n'a pas de rendement, et
    // le chaînage géométrique (GIPS 2.A.24.f) télescope en rapport des cours.
    const twr = windowTwr(INPUT, WINDOW);
    if (!twr.ok) throw new Error(`TWR attendu : ${twr.reason}`);
    near(twr.cumulative, 5 / 21);
    expect(twr.since).toBe('2026-01-31');
    expect(twr.until).toBe('2026-03-02');
    expect(twr.days).toBe(30);
  });

  it('TWR : les deux sous-fenêtres coupées à l’apport se chaînent en la fenêtre entière', () => {
    const before = windowTwr(INPUT, { from: '2026-02-01', to: '2026-02-14' });
    const after = windowTwr(INPUT, { from: '2026-02-15', to: '2026-03-02' });
    if (!before.ok || !after.ok) throw new Error('TWR attendus');
    near(before.cumulative, 1200 / 1050 - 1); // 8/7 − 1
    near(after.cumulative, 14300 / 13200 - 1); // 13/12 − 1
    const linked = ONE.plus(before.cumulative).times(ONE.plus(after.cumulative)).minus(ONE);
    near(linked, 5 / 21);
  });

  it('MWR : la racine de 21x² + 240x − 286 = 0, élevée au carré — 18,39 % sur la période', () => {
    // Flux de l'investisseur : −1 050 (31/01), −12 000 quinze jours plus tard, +14 300 trente jours
    // après l'ouverture. Avec x = (1 + r)^(15/365) : −1 050x² − 12 000x + 14 300 = 0, soit, divisé
    // par −50, 21x² + 240x − 286 = 0. Le rendement de la période est x² − 1.
    const x = (-240 + Math.sqrt(240 * 240 + 4 * 21 * 286)) / 42;
    const mwr = windowMwr(INPUT, WINDOW);
    if (!mwr.ok) throw new Error(`MWR attendu : ${mwr.reason}`);
    expect(mwr.since).toBe('2026-01-31'); // la valeur d'ouverture, datée de la veille de `from`
    expect(mwr.until).toBe('2026-03-02');
    expect(mwr.flowCount).toBe(3);
    near(D(String(Math.pow(1 + Number(mwr.rate.toString()), 15 / 365))), x, 1e-9);
    const presented = presentMoneyWeighted(mwr);
    if (presented.kind === 'none') throw new Error(presented.reason);
    near(presented.value, x * x - 1, 1e-9);
  });

  it('présentation : trente jours ne s’annualisent pas — ni 5/21 ni 18,39 % ne deviennent un taux annuel', () => {
    const twr = presentTimeWeighted(windowTwr(INPUT, WINDOW));
    const mwr = presentMoneyWeighted(windowMwr(INPUT, WINDOW));
    if (twr.kind === 'none' || mwr.kind === 'none') throw new Error('chiffres attendus');
    expect(twr.kind, 'TWR de 30 jours annualisé : GIPS 2.A.12 l’interdit').toBe('cumulative');
    expect(mwr.kind, 'MWR de 30 jours annualisé : GIPS 5.A.1.b l’interdit').toBe('cumulative');
    expect([twr.spanDays, mwr.spanDays]).toEqual([30, 30]);
    near(twr.value, 5 / 21);
    // Annualisé, le même MWR dépasserait 600 % : le taux annuel que le moteur rend, et que le
    // rapport ne doit jamais montrer pour trente jours.
    const annual = windowMwr(INPUT, WINDOW);
    if (!annual.ok) throw new Error('MWR attendu');
    expect(Number(annual.rate.toString())).toBeGreaterThan(6);
    expect(Number(mwr.value.toString())).toBeLessThan(0.2);
  });
});

describe('depuis l’origine, la fenêtre redonne les chiffres du Rapport', () => {
  const ALL: DayWindow = { from: null, to: '2026-03-02' };

  it('TWR : exactement celui de `computePerformance` (rapport des cours 130/100 − 1)', () => {
    const metric: MetricPoint[] = SERIES.map((point) => ({
      day: point.day,
      value: point.value,
      cost: ZERO,
      qty: null,
      price: null,
      estimated: false,
      estimatedValue: ZERO,
    }));
    const reported = computePerformance({
      series: metric,
      cashFlows: CASH_FLOWS,
      internalTransferLegs: {},
      benchmark: null,
      partialAssets: 0,
    }).twr;
    const input: WindowInput = {
      series: metric.map((p) => ({ day: p.day, value: p.value, estimated: p.estimated })),
      flows: FLOWS,
    };
    expect(windowTwr(input, ALL)).toEqual(reported);
    if (!reported.ok) throw new Error('TWR attendu');
    near(reported.cumulative, 0.3);
  });

  it('MWR : exactement le XIRR du Rapport, sur les flux du moteur et la valeur du jour', () => {
    const legacy = xirrEur(CASH_FLOWS, { day: '2026-03-02', valueEur: D('14300') });
    expect(windowMwr(INPUT, ALL)).toEqual(legacy);
    expect(legacy.ok).toBe(true);
  });

  it('MWR : une fenêtre qui s’ouvre avant le premier achat ne change rien (ouverture nulle)', () => {
    const legacy = windowMwr(INPUT, ALL);
    expect(windowMwr(INPUT, { from: '2026-01-01', to: '2026-03-02' })).toEqual(legacy);
    expect(windowMwr(INPUT, { from: '2025-06-01', to: '2026-03-02' })).toEqual(legacy);
  });

  it('gain : la valeur, moins tous les apports (14 300 − 13 000)', () => {
    expect(windowGain(INPUT, ALL)).toEqual({
      startDay: null,
      startValue: ZERO,
      endValue: D('14300'),
      netFlows: D('13000'),
      gain: D('1300'),
    });
  });
});

describe('les bornes', () => {
  it('inWindow : jours inclus, heure ignorée, rien à gauche depuis l’origine', () => {
    const w: DayWindow = { from: '2026-02-01', to: '2026-02-10' };
    expect(inWindow('2026-02-01T00:00:00', w)).toBe(true);
    expect(inWindow('2026-01-31T23:59:59', w)).toBe(false);
    expect(inWindow('2026-02-10T23:59:59', w)).toBe(true);
    expect(inWindow('2026-02-10', w)).toBe(true);
    expect(inWindow('2026-02-11T00:00:00', w)).toBe(false);
    const all: DayWindow = { from: null, to: '2026-02-10' };
    expect(inWindow('1999-01-01T12:00:00', all)).toBe(true);
    expect(inWindow('2026-02-11T00:00:00', all)).toBe(false);
  });

  it('openingDay : la veille de `from`, à travers les fins de mois et le 29 février', () => {
    expect(openingDay({ from: '2026-03-01', to: '2026-03-31' })).toBe('2026-02-28');
    expect(openingDay({ from: '2024-03-01', to: '2024-03-31' })).toBe('2024-02-29');
    expect(openingDay({ from: '2026-01-01', to: '2026-01-31' })).toBe('2025-12-31');
    expect(openingDay({ from: null, to: '2026-01-31' })).toBeNull();
  });

  it('valueAt : zéro avant le premier point, le dernier point connu ensuite', () => {
    const series = [
      { day: '2026-01-10', value: D('5') },
      { day: '2026-01-12', value: D('7') },
    ];
    expect(valueAt(series, '2026-01-09').toString()).toBe('0');
    expect(valueAt(series, '2026-01-10').toString()).toBe('5');
    expect(valueAt(series, '2026-01-11').toString()).toBe('5');
    expect(valueAt(series, '2026-01-12').toString()).toBe('7');
    expect(valueAt(series, '2026-02-01').toString()).toBe('7');
    expect(valueAt([], '2026-02-01').toString()).toBe('0');
  });

  it('un apport du jour `from` est dans la fenêtre ; celui de la veille est dans l’ouverture', () => {
    // Même gain dans les deux lectures : 110 unités × (130 − 120) = 1 100 €.
    const onFrom = windowGain(INPUT, { from: '2026-02-15', to: '2026-03-02' });
    expect(onFrom.startValue.toString()).toBe('1200');
    expect(onFrom.netFlows.toString()).toBe('12000');
    expect(onFrom.gain.toString()).toBe('1100');
    const dayAfter = windowGain(INPUT, { from: '2026-02-16', to: '2026-03-02' });
    expect(dayAfter.startValue.toString()).toBe('13200');
    expect(dayAfter.netFlows.toString()).toBe('0');
    expect(dayAfter.gain.toString()).toBe('1100');
  });

  it('un apport du jour `to` est dans la fenêtre ; celui du lendemain n’y est pas', () => {
    // Dix unités de 105 à 120 : 150 € dans les deux cas.
    const onTo = windowGain(INPUT, { from: '2026-02-01', to: '2026-02-15' });
    expect(onTo.netFlows.toString()).toBe('12000');
    expect(onTo.gain.toString()).toBe('150');
    const dayBefore = windowGain(INPUT, { from: '2026-02-01', to: '2026-02-14' });
    expect(dayBefore.netFlows.toString()).toBe('0');
    expect(dayBefore.gain.toString()).toBe('150');
  });

  it('une valeur de clôture imposée sert au gain et au MWR, pas au découpage des flux', () => {
    const input: WindowInput = { ...INPUT, closingValue: D('14000') };
    const gain = windowGain(input, WINDOW);
    expect(gain.endValue.toString()).toBe('14000');
    expect(gain.gain.toString()).toBe('950'); // 14 000 − 1 050 − 12 000
    const expected = xirrEur(
      [
        { at: '2026-01-31', amountEur: D('-1050') },
        { at: '2026-02-15T00:00:00', amountEur: D('-12000') },
      ],
      { day: '2026-03-02', valueEur: D('14000') },
    );
    expect(windowMwr(input, WINDOW)).toEqual(expected);
  });

  it('MWR sous trente jours : le plancher de bruit du moteur tient, rien n’est rendu', () => {
    expect(windowMwr(INPUT, { from: '2026-02-10', to: '2026-02-20' })).toEqual({
      ok: false,
      reason: 'too-recent',
    });
  });

  it('TWR d’une fenêtre antérieure à toute valeur : série insuffisante, dit comme tel', () => {
    expect(windowTwr(INPUT, { from: '2025-01-01', to: '2025-01-01' })).toEqual({
      ok: false,
      reason: 'insufficient-series',
    });
  });
});

// --- Les flux de résultat, sur le vrai moteur --------------------------------------------------

let seq = 0;
const base = () => ({
  id: `w${++seq}`,
  source: 'manual' as const,
  scope: 'coinhouse' as const,
  accountId: 'ch:main' as const,
  rowKeys: [],
  warnings: [],
});
const trade = (
  at: string,
  out: [string, string],
  into: [string, string],
  eur: string,
  fee?: { gross: string; rebate: string },
): TradeEvent => ({
  ...base(),
  kind: 'trade',
  at,
  out: { asset: out[0], qty: out[1] },
  in: { asset: into[0], qty: into[1] },
  valueEur: eur,
  valueEurSource: 'manual',
  fee: fee
    ? {
        asset: 'eur',
        gross: fee.gross,
        rebate: fee.rebate,
        grossEur: fee.gross,
        rebateEur: fee.rebate,
      }
    : null,
  quotePrice: null,
});
const buy = (
  at: string,
  asset: string,
  qty: string,
  eur: string,
  fee?: { gross: string; rebate: string },
) => trade(at, ['eur', eur], [asset, qty], eur, fee);
const sell = (at: string, asset: string, qty: string, eur: string) =>
  trade(at, [asset, qty], ['eur', eur], eur);
const reward = (at: string, asset: string, qty: string, fairValueEur: string): RewardEvent => ({
  ...base(),
  kind: 'reward',
  at,
  in: { asset, qty },
  fairValueEur,
});
const income = (at: string, asset: string | null, grossEur: string): IncomeEvent => ({
  ...base(),
  kind: 'income',
  at,
  asset,
  grossEur,
  withheldEur: '0',
  nature: asset === null ? 'interest' : 'dividend',
  label: 'revenu',
});
const subscription = (at: string, amountEur: string): FeeEvent => ({
  ...base(),
  kind: 'fee',
  at,
  amountEur,
  label: 'abonnement',
});

const FAIR: EngineSettings = { ...DEFAULT_ENGINE_SETTINGS, rewardValuation: 'fair-value' };
const run = (events: LedgerEvent[], settings: EngineSettings = FAIR): PortfolioReport =>
  computePortfolio({ events, prices: {}, settings });
/** Le périmètre des totaux : ouvertes et clôturées, jamais bloquées. */
const live = (report: PortfolioReport) => [...holdings(report), ...report.closed];

describe('windowFlows', () => {
  // L'exemple canonique du moteur (1@100, 1@200, vente 1@300 → réalisé +150, PRU 150), plus une
  // opération de chaque espèce que le rapport additionne, un jour chacune.
  const events: LedgerEvent[] = [
    buy('2026-01-01T10:00:00', 'x', '1', '100'),
    buy('2026-01-02T10:00:00', 'x', '1', '200', { gross: '2', rebate: '0.5' }),
    sell('2026-01-03T10:00:00', 'x', '1', '300'),
    reward('2026-01-05T09:00:00', 'x', '0.1', '25'),
    income('2026-01-06T09:00:00', 'x', '7'), // dividende rattaché à la ligne : revenu de la ligne
    income('2026-01-07T09:00:00', null, '3'), // intérêts de trésorerie : au compte
    income('2026-01-07T18:00:00', null, '-1'), // frais de conversion : au compte, négatif
    income('2026-01-08T09:00:00', 'y', '11'), // ligne sans historique : hors périmètre du moteur
    subscription('2026-01-09T09:00:00', '9.99'),
  ];
  const report = run(events);
  const input = { positions: live(report), events };

  it('depuis l’origine : les totaux du moteur, au centime et sans tolérance', () => {
    const flows = windowFlows(input, { from: null, to: '2026-12-31' });
    const t = report.totals;
    expect(flows.realized.eq(t.realized)).toBe(true);
    expect(flows.feesEur.eq(t.feesEur)).toBe(true);
    expect(flows.rebatesEur.eq(t.rebatesEur)).toBe(true);
    expect(flows.otherIncome.eq(t.otherIncome)).toBe(true);
    expect(flows.accountIncomeEur.eq(t.accountIncomeEur)).toBe(true);
    expect(flows.subscriptionsEur.eq(t.subscriptionsEur)).toBe(true);
    // Et ces totaux sont bien ceux qu'on attend de tête.
    expect(Object.values(flows).map(String)).toEqual(['150', '1.5', '0.5', '32', '2', '9.99']);
  });

  it('la cession datée dans la fenêtre porte tout le réalisé, et rien d’autre n’y entre', () => {
    const flows = windowFlows(input, { from: '2026-01-03', to: '2026-01-03' });
    expect(Object.values(flows).map(String)).toEqual(['150', '0', '0', '0', '0', '0']);
  });

  it('les frais et remises vont avec leur opération : l’achat du 2 janvier', () => {
    const flows = windowFlows(input, { from: '2026-01-01', to: '2026-01-02' });
    expect(Object.values(flows).map(String)).toEqual(['0', '1.5', '0.5', '0', '0', '0']);
  });

  it('récompense, dividende, trésorerie et abonnement, chacun à sa place', () => {
    expect(
      windowFlows(input, { from: '2026-01-05', to: '2026-01-05' }).otherIncome.toString(),
    ).toBe('25');
    expect(
      windowFlows(input, { from: '2026-01-06', to: '2026-01-06' }).otherIncome.toString(),
    ).toBe('7');
    const account = windowFlows(input, { from: '2026-01-07', to: '2026-01-07' });
    expect(account.accountIncomeEur.toString()).toBe('2');
    expect(account.otherIncome.toString()).toBe('0');
    const orphan = windowFlows(input, { from: '2026-01-08', to: '2026-01-08' });
    expect(orphan.otherIncome.toString(), 'revenu d’une ligne hors périmètre compté').toBe('0');
    expect(
      windowFlows(input, { from: '2026-01-09', to: '2026-01-09' }).subscriptionsEur.toString(),
    ).toBe('9.99');
  });

  it('une récompense valorisée à zéro (réglage par défaut) n’ajoute rien', () => {
    const zero = run(events, DEFAULT_ENGINE_SETTINGS);
    const flows = windowFlows(
      { positions: live(zero), events },
      { from: '2026-01-05', to: '2026-01-05' },
    );
    expect(flows.otherIncome.toString()).toBe('0');
  });

  it('une position bloquée est hors des totaux, et hors de la fenêtre avec le bon périmètre', () => {
    const blocked = run([
      buy('2026-01-01T10:00:00', 'z', '1', '10'),
      sell('2026-01-02T10:00:00', 'z', '1', '15'), // réalisé +5…
      sell('2026-01-03T10:00:00', 'z', '1', '20'), // …puis une cession sans stock : bloquée
    ]);
    expect(blocked.blocked).toHaveLength(1);
    expect(blocked.totals.realized.toString()).toBe('0');
    const flows = windowFlows(
      { positions: live(blocked), events: [] },
      { from: null, to: '2026-12-31' },
    );
    expect(flows.realized.toString()).toBe('0');
  });
});
