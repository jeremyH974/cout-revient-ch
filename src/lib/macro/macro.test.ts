import { describe, expect, it } from 'vitest';
import { MACRO, ageInDays, isStale, normalGap, orderedIndicators, sparkGeometry } from './index';
import type { MacroIndicator } from './types';

/**
 * Deux choses distinctes : les invariants de l'instantané committé — qui peut être modifié à la
 * main par accident, et que le cron ne régénère qu'une fois par semaine — et la lecture, testée
 * sur des séries synthétiques puisque le fichier engendré change à chaque exécution.
 */

const UNITS = new Set(['percent', 'percentPoints', 'usd', 'usdBillions']);
const TRANSFORMS = new Set(['level', 'yoy', 'change3m', 'volatility']);

describe('instantané engendré', () => {
  it('porte les indicateurs attendus, une fois chacun', () => {
    const ids = MACRO.indicators.map((indicator) => indicator.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const required of ['real-10y', 'spread-2s10s', 'nominal-10y', 'bank-reserves']) {
      expect(ids, required).toContain(required);
    }
  });

  it('ne déclare que des unités, transformations et sources connues', () => {
    for (const indicator of MACRO.indicators) {
      expect(UNITS.has(indicator.unit), `${indicator.id} → ${indicator.unit}`).toBe(true);
      expect(TRANSFORMS.has(indicator.transform), indicator.id).toBe(true);
      expect(['treasury', 'fed', 'eia', 'ecb']).toContain(indicator.source);
      expect(indicator.url.startsWith('https://'), indicator.id).toBe(true);
    }
  });

  it('accompagne chaque valeur d’au moins deux rangs, avec leur fenêtre et leur effectif', () => {
    for (const indicator of MACRO.indicators) {
      expect(indicator.ranks.length, indicator.id).toBeGreaterThanOrEqual(2);
      for (const rank of indicator.ranks) {
        expect(rank.percentile, `${indicator.id} ${rank.window}`).toBeGreaterThanOrEqual(0);
        expect(rank.percentile, `${indicator.id} ${rank.window}`).toBeLessThanOrEqual(100);
        expect(rank.observations, `${indicator.id} ${rank.window}`).toBeGreaterThanOrEqual(20);
        expect(rank.window.length).toBeGreaterThan(1);
      }
    }
  });

  it('ne classe jamais le niveau brut d’une série qui dérive', () => {
    // La règle qui fonde tout le module : un percentile de niveau n'est licite que sur une série
    // stationnaire ou bornée. Les stocks et les prix passent par une variation.
    const byId = new Map(MACRO.indicators.map((indicator) => [indicator.id, indicator]));
    expect(byId.get('bank-reserves')?.transform).toBe('change3m');
    expect(byId.get('wti')?.transform ?? 'yoy').toBe('yoy');
    expect(byId.get('real-10y')?.transform).toBe('level');
    expect(byId.get('spread-2s10s')?.transform).toBe('level');
  });

  it('porte des séries datées, sans tableau à trou', () => {
    for (const indicator of MACRO.indicators) {
      expect(indicator.series.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(indicator.series.values.length).toBeGreaterThan(200);
      for (const [index, value] of indicator.series.values.entries()) {
        // Un trou de tableau vaudrait `undefined` : seuls `null` et un nombre fini sont admis.
        expect(value === null || Number.isFinite(value), `${indicator.id}[${index}]`).toBe(true);
      }
    }
  });

  it('compte juste, source par source, et dit ce qui manque', () => {
    for (const stamp of MACRO.sources) {
      const actual = MACRO.indicators.filter((i) => i.source === stamp.source).length;
      expect(actual, stamp.source).toBe(stamp.count);
      if (stamp.count === 0) expect(stamp.missing, stamp.source).toBeTruthy();
    }
  });

  it('assortit d’une réserve la seule mesure dont la portée est discutée', () => {
    const reserves = MACRO.indicators.find((i) => i.id === 'bank-reserves');
    expect(reserves?.caveat).toMatch(/liquidité nette/i);
  });
});

// ─── Lecture ─────────────────────────────────────────────────────────────────

const fake = (id: string, over: Partial<MacroIndicator> = {}): MacroIndicator => ({
  id,
  label: id,
  detail: '',
  unit: 'percent',
  transform: 'level',
  value: 1,
  asOf: '2026-08-28',
  staleAfterDays: 5,
  ranks: [],
  series: { from: '2026-01-01', values: [1, 2] },
  source: 'treasury',
  url: 'https://example.invalid',
  ...over,
});

describe('fraîcheur', () => {
  it('compte les jours écoulés, jamais négativement', () => {
    expect(ageInDays(fake('a'), '2026-09-02')).toBe(5);
    expect(ageInDays(fake('a'), '2026-08-01')).toBe(0);
  });

  it('applique la tolérance propre à chaque indicateur', () => {
    const daily = fake('a', { staleAfterDays: 5 });
    const weekly = fake('b', { staleAfterDays: 12 });
    expect(isStale(daily, '2026-09-05')).toBe(true);
    expect(isStale(weekly, '2026-09-05')).toBe(false);
  });
});

describe('ordre de lecture', () => {
  it('met la liquidité en tête et laisse l’inconnu en queue', () => {
    const snapshot = {
      generatedAt: '',
      sources: [],
      indicators: [fake('inconnu'), fake('real-10y'), fake('bank-reserves')],
    };
    expect(orderedIndicators(snapshot).map((i) => i.id)).toEqual([
      'bank-reserves',
      'real-10y',
      'inconnu',
    ]);
  });
});

describe('sparkline', () => {
  it('relie une série hebdomadaire, dont les trous sont la cadence normale', () => {
    // Six jours vides entre chaque point : couper à chaque fois ne dessinerait rien du tout.
    const weekly = Array.from({ length: 60 }, (_, i) => (i % 7 === 0 ? i : null));
    const geometry = sparkGeometry({ from: '2026-01-01', values: weekly }, 100, 20);
    expect(geometry.path.match(/M/g)).toHaveLength(1);
    expect((geometry.path.match(/L/g) ?? []).length).toBeGreaterThan(5);
  });

  it('ne se hache pas sur un jour férié au milieu d’une série quotidienne', () => {
    // Vendredi → mardi après un férié : quatre jours d'écart, la cadence normale reste 1.
    const values: (number | null)[] = Array.from({ length: 40 }, (_, i) => i);
    values[20] = null;
    values[21] = null;
    values[22] = null;
    const geometry = sparkGeometry({ from: '2026-01-01', values }, 100, 20);
    expect(geometry.path.match(/M/g)).toHaveLength(1);
  });

  it('coupe le trait sur un trou anormal pour cette série-là', () => {
    // Série quotidienne, puis un mois sans rien : le trait doit se rompre.
    const values: (number | null)[] = [
      ...Array.from({ length: 10 }, (_, i) => i),
      ...Array.from({ length: 30 }, () => null),
      ...Array.from({ length: 10 }, (_, i) => 40 + i),
    ];
    const geometry = sparkGeometry({ from: '2026-01-01', values }, 100, 20);
    expect(geometry.path.match(/M/g)).toHaveLength(2);
  });

  it('mesure la cadence par la médiane, qu’un trou isolé ne doit pas fausser', () => {
    expect(normalGap([0, 1, 2, 3, 40])).toBe(1);
    expect(normalGap([0, 7, 14, 21])).toBe(7);
    expect(normalGap([5])).toBe(1);
    expect(normalGap([])).toBe(1);
  });

  it('projette l’abscisse sur l’index, donc proportionnellement au temps', () => {
    const geometry = sparkGeometry({ from: '2026-01-01', values: [0, 1, 2, 3, 4] }, 100, 20);
    expect(geometry.path.startsWith('M0.0 ')).toBe(true);
    expect(geometry.last?.x).toBeCloseTo(100, 6);
  });

  it('place l’ordonnée du zéro seulement si la série change de signe', () => {
    expect(sparkGeometry({ from: '2026-01-01', values: [-1, 1] }, 100, 20).zeroY).toBeCloseTo(
      10,
      6,
    );
    expect(sparkGeometry({ from: '2026-01-01', values: [1, 2] }, 100, 20).zeroY).toBeNull();
  });

  it('ne s’effondre pas sur une série plate', () => {
    const geometry = sparkGeometry({ from: '2026-01-01', values: [5, 5, 5] }, 100, 20);
    expect(geometry.path).toContain('M');
    expect(Number.isFinite(geometry.last?.y ?? Number.NaN)).toBe(true);
  });

  it('ne trace rien quand il n’y a pas de quoi', () => {
    expect(sparkGeometry({ from: '2026-01-01', values: [] }, 100, 20).path).toBe('');
    expect(sparkGeometry({ from: '2026-01-01', values: [1] }, 100, 20).path).toBe('');
    expect(sparkGeometry({ from: '2026-01-01', values: [null, null] }, 100, 20).path).toBe('');
  });
});
