import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { D, ZERO } from '../domain/money';
import {
  hasUnavailable,
  latestNetWorth,
  netWorthSeries,
  tradingEquityContribution,
  valueSeriesContribution,
  type Contribution,
  type Liability,
} from './net-worth';
import type { ValuePoint } from './series';
import type { DayString } from './types';

const days = (...list: string[]): DayString[] => list as DayString[];

/** Jour civil d'un instant, en UTC : suffisant et déterministe pour les tests. */
const dayOfMs = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const at = (iso: string): number => Date.parse(iso);

function vp(day: string, value: string, cost: string, missing: string[] = []): ValuePoint {
  return { day: day as DayString, value: D(value), cost: D(cost), missing: missing as never[] };
}

/** Contribution constante, sans dépendance externe : sert de témoin. */
function flat(
  id: string,
  value: string,
  contributed = '0',
  firstDay: string | null = null,
): Contribution {
  return {
    id,
    label: id,
    firstDay: firstDay as DayString | null,
    valueAt: () => ({ value: D(value), contributed: D(contributed), estimated: false }),
  };
}

describe('valeur nette = Σ contributions − Σ passifs', () => {
  it('somme les contributions et retranche les passifs', () => {
    const liability: Liability = { id: 'pret', label: 'Prêt', amountAt: () => D('300') };
    const points = netWorthSeries({
      contributions: [flat('a', '1000', '800'), flat('b', '500', '500')],
      liabilities: [liability],
      days: days('2026-08-01'),
    });
    expect(points[0]?.gross.toString()).toBe('1500');
    expect(points[0]?.liabilities.toString()).toBe('300');
    expect(points[0]?.net.toString()).toBe('1200');
    expect(points[0]?.contributed.toString()).toBe('1300');
  });

  it('sans passif déclaré, la valeur nette égale le brut — le terme P37 est neutre, pas absent', () => {
    const points = netWorthSeries({ contributions: [flat('a', '42')], days: days('2026-08-01') });
    expect(points[0]?.liabilities.toString()).toBe('0');
    expect(points[0]?.net.toString()).toBe(points[0]?.gross.toString());
  });

  it('avant son premier jour, une contribution est ABSENTE et non nulle par accident', () => {
    const points = netWorthSeries({
      contributions: [flat('tard', '900', '900', '2026-08-05')],
      days: days('2026-08-04', '2026-08-05'),
    });
    expect(points[0]?.gross.toString()).toBe('0');
    // Le compte n'existait pas : ce n'est ni une valeur manquante, ni une contribution indisponible.
    expect(points[0]?.unavailable).toEqual([]);
    expect(points[0]?.estimated).toEqual([]);
    expect(points[1]?.gross.toString()).toBe('900');
  });
});

describe('approché ou incomplet : la distinction qui sépare un chiffre juste d’un chiffre faux', () => {
  it('marque « estimated » une contribution portée à son coût, et la COMPTE quand même', () => {
    const points = netWorthSeries({
      contributions: [
        valueSeriesContribution('invest', 'Investissement', [
          vp('2026-08-01', '700', '700', ['zzz']),
        ]),
      ],
      days: days('2026-08-01'),
    });
    expect(points[0]?.estimated).toEqual(['invest']);
    expect(points[0]?.gross.toString()).toBe('700');
    expect(hasUnavailable(points)).toBe(false);
  });

  it('marque « unavailable » une contribution non valorisable, et l’EXCLUT du total', () => {
    const broken: Contribution = {
      id: 'hl',
      label: 'Trading',
      firstDay: null,
      valueAt: () => null,
    };
    const points = netWorthSeries({
      contributions: [flat('invest', '1000'), broken],
      days: days('2026-08-01'),
    });
    expect(points[0]?.unavailable).toEqual(['hl']);
    // Le total est INCOMPLET, donc trop bas — pas approché. C'est pourquoi il doit se signaler.
    expect(points[0]?.gross.toString()).toBe('1000');
    expect(hasUnavailable(points)).toBe(true);
  });
});

describe('équité de trading rééchantillonnée au jour', () => {
  const usdPerDisplay = () => '1.25' as const;

  it('retient la CLÔTURE du jour quand la plateforme en donne plusieurs', () => {
    const c = tradingEquityContribution({
      id: 'hl',
      label: 'Compte',
      history: [
        [at('2026-08-01T06:00:00Z'), '1000'],
        [at('2026-08-01T18:00:00Z'), '1500'],
      ],
      dayOfMs,
      usdPerDisplay,
    });
    // 1500 $ / 1,25 = 1200 € — et non le point de 6 h.
    expect(c.valueAt('2026-08-01' as DayString)?.value.toString()).toBe('1200');
  });

  it('reporte le dernier point connu à travers les trous de l’échantillonnage', () => {
    const c = tradingEquityContribution({
      id: 'hl',
      label: 'Compte',
      history: [
        [at('2026-08-01T12:00:00Z'), '1000'],
        [at('2026-08-10T12:00:00Z'), '2000'],
      ],
      dayOfMs,
      usdPerDisplay,
    });
    expect(c.valueAt('2026-08-05' as DayString)?.value.toString()).toBe('800');
    expect(c.valueAt('2026-08-31' as DayString)?.value.toString()).toBe('1600');
  });

  it('n’existe pas avant son premier point : firstDay le dit', () => {
    const c = tradingEquityContribution({
      id: 'hl',
      label: 'Compte',
      history: [[at('2026-08-10T12:00:00Z'), '2000']],
      dayOfMs,
      usdPerDisplay,
    });
    expect(c.firstDay).toBe('2026-08-10');
    const points = netWorthSeries({ contributions: [c], days: days('2026-08-09', '2026-08-10') });
    expect(points[0]?.gross.toString()).toBe('0');
    expect(points[1]?.gross.toString()).toBe('1600');
  });

  it('se déclare non valorisable plutôt que de convertir au hasard sans taux', () => {
    const c = tradingEquityContribution({
      id: 'hl',
      label: 'Compte',
      history: [[at('2026-08-01T12:00:00Z'), '1000']],
      dayOfMs,
      usdPerDisplay: () => null,
    });
    expect(c.valueAt('2026-08-01' as DayString)).toBeNull();
  });

  it('refuse un taux nul ou négatif au lieu de diviser par zéro', () => {
    const c = tradingEquityContribution({
      id: 'hl',
      label: 'Compte',
      history: [[at('2026-08-01T12:00:00Z'), '1000']],
      dayOfMs,
      usdPerDisplay: () => '0',
    });
    expect(c.valueAt('2026-08-01' as DayString)).toBeNull();
  });

  it('laisse l’instantané « live » remplacer la dernière clôture servie par la plateforme', () => {
    // `portfolio` et l'instantané viennent de points d'entrée DIFFÉRENTS, non synchronisés. Sans
    // ce remplacement, le dernier point de la courbe ne pourrait pas égaler le total du bandeau
    // de la Vue d'ensemble — et deux chiffres qui devraient être le même divergeraient à l'écran.
    const c = tradingEquityContribution({
      id: 'hl',
      label: 'C',
      history: [[at('2026-08-01T12:00:00Z'), '1000']],
      dayOfMs,
      usdPerDisplay: () => '1',
      live: { day: '2026-08-01' as DayString, usd: '1337' },
    });
    expect(c.valueAt('2026-08-01' as DayString)?.value.toString()).toBe('1337');
  });

  it('accepte un « live » postérieur au dernier point servi, et avance le dernier jour', () => {
    const c = tradingEquityContribution({
      id: 'hl',
      label: 'C',
      history: [[at('2026-08-01T12:00:00Z'), '1000']],
      dayOfMs,
      usdPerDisplay: () => '1',
      live: { day: '2026-08-03' as DayString, usd: '1500' },
    });
    expect(c.valueAt('2026-08-03' as DayString)?.value.toString()).toBe('1500');
  });

  it('suit la devise d’AFFICHAGE, pas l’euro par principe', () => {
    // Piège réel : `pricesFor` convertit déjà les cours du côté Investissement dans la devise
    // d'affichage. En dollars, la contribution du trading ne doit donc PAS être divisée — sans
    // quoi les deux moitiés de la courbe ne sont plus dans la même unité et on additionne des
    // pommes et des poires, sans qu'aucun total ne paraisse aberrant.
    const history: [number, string][] = [[at('2026-08-01T12:00:00Z'), '1000']];
    const inEur = tradingEquityContribution({
      id: 'hl',
      label: 'C',
      history,
      dayOfMs,
      usdPerDisplay: () => '1.25',
    });
    const inUsd = tradingEquityContribution({
      id: 'hl',
      label: 'C',
      history,
      dayOfMs,
      usdPerDisplay: () => '1',
    });
    expect(inEur.valueAt('2026-08-01' as DayString)?.value.toString()).toBe('800');
    expect(inUsd.valueAt('2026-08-01' as DayString)?.value.toString()).toBe('1000');
  });

  it('consolide DEUX comptes aux horodatages disjoints — ce que la plateforme ne sait pas faire', () => {
    // C'est la raison pour laquelle `Trading.svelte` ne trace sa courbe que s'il n'y a qu'un
    // compte : les séries de la plateforme n'ont pas les mêmes instants. Ramenées au jour, elles
    // s'additionnent.
    const a = tradingEquityContribution({
      id: 'a',
      label: 'A',
      history: [
        [at('2026-08-01T03:17:00Z'), '1000'],
        [at('2026-08-04T21:43:00Z'), '1250'],
      ],
      dayOfMs,
      usdPerDisplay,
    });
    const b = tradingEquityContribution({
      id: 'b',
      label: 'B',
      history: [
        [at('2026-08-02T11:02:00Z'), '500'],
        [at('2026-08-05T07:29:00Z'), '750'],
      ],
      dayOfMs,
      usdPerDisplay,
    });
    const points = netWorthSeries({
      contributions: [a, b],
      days: days('2026-08-01', '2026-08-02', '2026-08-04', '2026-08-05'),
    });
    expect(points.map((p) => p.gross.toString())).toEqual([
      '800', // A seul (1000 $), B n'existe pas encore
      '1200', // A reporté (800) + B (400)
      '1400', // A à 1250 $ (1000) + B reporté (400)
      '1600', // A reporté (1000) + B à 750 $ (600)
    ]);
    expect(points.every((p) => p.unavailable.length === 0)).toBe(true);
  });
});

describe('propriétés', () => {
  it('un apport déplace la courbe d’apports EXACTEMENT de son montant', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000 }), (cents) => {
        const deposit = D(String(cents)).div(D('100'));
        const before = netWorthSeries({
          contributions: [valueSeriesContribution('i', 'I', [vp('2026-08-01', '1000', '900')])],
          days: days('2026-08-01'),
        });
        const after = netWorthSeries({
          contributions: [
            valueSeriesContribution('i', 'I', [
              vp(
                '2026-08-01',
                D('1000').plus(deposit).toString(),
                D('900').plus(deposit).toString(),
              ),
            ]),
          ],
          days: days('2026-08-01'),
        });
        const delta = after[0]!.contributed.minus(before[0]!.contributed);
        return delta.eq(deposit) && after[0]!.net.minus(before[0]!.net).eq(deposit);
      }),
      { numRuns: 60 },
    );
  });

  it('la valeur nette ne dépend pas de l’ordre des contributions', () => {
    const a = flat('a', '123.45', '100');
    const b = flat('b', '67.89', '50');
    const c = flat('c', '0.01', '0');
    const one = netWorthSeries({ contributions: [a, b, c], days: days('2026-08-01') });
    const other = netWorthSeries({ contributions: [c, a, b], days: days('2026-08-01') });
    expect(one[0]?.net.toString()).toBe(other[0]?.net.toString());
  });

  it('sans contribution, tout vaut zéro plutôt que d’échouer', () => {
    const points = netWorthSeries({ contributions: [], days: days('2026-08-01') });
    expect(points[0]?.net.toString()).toBe('0');
    expect(points[0]?.gross.eq(ZERO)).toBe(true);
    expect(latestNetWorth([])).toBeNull();
  });

  it('latestNetWorth rend le dernier point : c’est lui que la Vue d’ensemble doit égaler', () => {
    const points = netWorthSeries({
      contributions: [
        valueSeriesContribution('i', 'I', [
          vp('2026-08-01', '10', '10'),
          vp('2026-08-02', '20', '10'),
        ]),
      ],
      days: days('2026-08-01', '2026-08-02'),
    });
    expect(latestNetWorth(points)?.day).toBe('2026-08-02');
    expect(latestNetWorth(points)?.net.toString()).toBe('20');
  });
});
