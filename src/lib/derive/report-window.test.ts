/**
 * Ce que la synthèse du Rapport lit sur une plage (décision n° 179). Le cœur (`history/window.ts`)
 * a ses propres tests ; ceux-ci surveillent les deux choix qui appartiennent à l'assemblage — d'où
 * vient la valeur finale, et quel coût de revient ferme la plage — et que rien n'y est perdu.
 */
import { describe, expect, it } from 'vitest';
import { D, type Big } from '../domain/money';
import type { AssetCode, NaiveDateTime } from '../domain/types';
import { costAt, reportWindowFigures, type ReportWindowInput } from './report-window';

/** Un portefeuille acheté 1 000 € le 1er janvier, renforcé de 500 € le 6, allégé le 8. */
const point = (day: string, value: string, cost: string) => ({
  day,
  value: D(value),
  cost: D(cost),
  estimated: false,
});

const SERIES: ReportWindowInput['series'] = [
  point('2025-12-31', '0', '0'),
  point('2026-01-01', '1000', '1000'),
  point('2026-01-04', '1050', '1000'),
  point('2026-01-05', '1100', '1000'),
  point('2026-01-06', '1620', '1500'),
  point('2026-01-07', '1640', '1500'),
  point('2026-01-08', '1400', '1260'),
  point('2026-01-10', '1480', '1260'),
];

const entry = (at: string, kind: 'buy' | 'sell', realized: Big | null) => ({
  at: at as NaiveDateTime,
  kind,
  realized,
  feeEur: D('0'),
  rebateEur: D('0'),
  valueEur: null,
});

const INPUT: ReportWindowInput = {
  series: SERIES,
  flows: [
    { at: '2026-01-01T10:00:00', amountEur: D('1000') },
    { at: '2026-01-06T10:00:00', amountEur: D('500') },
    // La cession du 8 rend 280 € : un retrait, au signe du portefeuille.
    { at: '2026-01-08T10:00:00', amountEur: D('-280') },
  ],
  positions: [
    {
      asset: 'btc' as AssetCode,
      history: [
        entry('2026-01-01T10:00:00', 'buy', null),
        entry('2026-01-06T10:00:00', 'buy', null),
        entry('2026-01-08T10:00:00', 'sell', D('40')),
      ],
    },
  ],
  events: [],
};

const opts = (endsToday: boolean) => ({
  label: 'du 05/01/2026 au 10/01/2026',
  endsToday,
  closingValue: D('1500'),
});

describe('costAt', () => {
  it('lit le coût du dernier point à la date ou avant, et zéro avant le premier', () => {
    expect(costAt(SERIES, '2025-12-01').toString()).toBe('0');
    expect(costAt(SERIES, '2026-01-06').toString()).toBe('1500');
    // Un jour sans point (le 9) garde le coût du dernier jour connu.
    expect(costAt(SERIES, '2026-01-09').toString()).toBe('1260');
  });
});

describe('reportWindowFigures', () => {
  const window = { from: '2026-01-05', to: '2026-01-10' };

  it('finit aujourd’hui : la valeur finale est celle du moteur, pour se recouper avec la tête', () => {
    const figures = reportWindowFigures(INPUT, window, opts(true));
    expect(figures.endValue.toString()).toBe('1500');
    // Ouverture : la clôture de la VEILLE du premier jour (le 4), 1 050 €.
    expect(figures.startValue.toString()).toBe('1050');
    // Apports nets de la plage : + 500 le 6, − 280 le 8.
    expect(figures.netFlows.toString()).toBe('220');
    expect(figures.gain.toString()).toBe('230');
  });

  it('finit dans le passé : la valeur finale est la clôture de la série à sa fin', () => {
    const past = { from: '2026-01-05', to: '2026-01-07' };
    const figures = reportWindowFigures(INPUT, past, opts(false));
    // Le moteur dirait 1 500 € : c'est la valeur d'aujourd'hui, pas celle du 7.
    expect(figures.endValue.toString()).toBe('1640');
    expect(figures.endCost.toString()).toBe('1500');
    expect(figures.gain.toString()).toBe('90');
  });

  it('prend pour coût de fin celui de la date de fin', () => {
    expect(reportWindowFigures(INPUT, window, opts(true)).endCost.toString()).toBe('1260');
  });

  it('compte le réalisé des seules cessions datées dans la plage', () => {
    expect(reportWindowFigures(INPUT, window, opts(true)).realized.toString()).toBe('40');
    const before = { from: '2026-01-02', to: '2026-01-07' };
    expect(reportWindowFigures(INPUT, before, opts(false)).realized.toString()).toBe('0');
  });

  it('sous le plancher de 30 jours du moteur, ne présente aucun XIRR, et dit pourquoi', () => {
    // Six jours : annualiser amplifierait le bruit, le moteur refuse — et le rapport l'écrit.
    expect(reportWindowFigures(INPUT, window, opts(true)).mwr).toEqual({
      kind: 'none',
      reason: 'too-recent',
    });
  });

  it('entre un mois et un an, présente le XIRR de la plage sur la période, jamais « par an »', () => {
    // Deux mois de plus, au même rythme : la plage court du 5 janvier au 1er mars.
    const longer: ReportWindowInput = {
      ...INPUT,
      series: [...SERIES, point('2026-02-01', '1520', '1260'), point('2026-03-01', '1560', '1260')],
    };
    const { mwr } = reportWindowFigures(
      longer,
      { from: '2026-01-05', to: '2026-03-01' },
      opts(false),
    );
    expect(mwr.kind).toBe('cumulative');
    if (mwr.kind !== 'none') expect([mwr.since, mwr.until]).toEqual(['2026-01-04', '2026-03-01']);
  });

  it('rend la plage telle qu’on la lui a donnée', () => {
    const figures = reportWindowFigures(INPUT, window, opts(true));
    expect([figures.from, figures.to, figures.label, figures.endsToday]).toEqual([
      '2026-01-05',
      '2026-01-10',
      'du 05/01/2026 au 10/01/2026',
      true,
    ]);
  });
});
