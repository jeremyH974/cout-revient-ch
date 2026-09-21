/**
 * Le rapport de prêts (décision n° 178). Il reprend l'écran Prêts, ni plus ni moins : les tests
 * vérifient qu'il dit la même chose que lui — le TRI « par an » ou la raison de son absence, les
 * seuils de concentration de l'écran, le recyclage présenté comme ce qu'il est — et qu'il ne dit
 * rien de ce qu'il ignore.
 */
import { describe, expect, it } from 'vitest';
import { D } from '../domain/money';
import type { XirrResult } from '../domain/xirr';
import { fmtMoney, fmtPct, MASK } from '../format/fr';
import {
  buildLendingReportModel,
  type LendingReportInput,
  type LendingRiskRow,
} from './lending-report-model';
import { section, tableOf, type ReportKpi, type ReportModel } from './report-model';

const eur = (amount: string, sign = false): string => fmtMoney(D(amount), 'EUR', { sign });
/** Le taux tel que l'écran l'écrit — espace fine insécable comprise, qu'on ne tape pas à la main. */
const perYear = (rate: string): string => `${fmtPct(D(rate), { sign: false })} par an`;

const ok = (rate: string): XirrResult => ({
  ok: true,
  rate: D(rate),
  since: '2025-01-01',
  until: '2026-09-21',
  flowCount: 12,
});

const borrower = (key: string, outstanding: string, weight: string): LendingRiskRow => ({
  key,
  outstanding: D(outstanding),
  weight: D(weight),
});

const input = (over: Partial<LendingReportInput> = {}): LendingReportInput => ({
  netContributions: D('1000'),
  result: D('14.18'),
  value: D('1014.18'),
  deposits: D('1000'),
  withdrawals: D('0'),
  bonus: D('5'),
  principalLent: D('800'),
  outstanding: D('380'),
  accrued: D('0'),
  cash: D('634.18'),
  interestGross: D('12.11'),
  withheld: D('2.93'),
  interestNet: D('9.18'),
  taxDebitedFromWallet: D('0'),
  writtenOff: D('0'),
  recycling: D('0.8'),
  returnOnContributions: D('0.01418'),
  xirrNet: ok('0.052'),
  xirrGross: ok('0.068'),
  accrualUnavailable: 0,
  concentration: {
    index: D('0.12'),
    effectiveCount: D('8.3'),
    top: [borrower('Boulangerie Martin', '120', '0.3158')],
  },
  ...over,
});

const build = (i: LendingReportInput, discreet = false): ReportModel =>
  buildLendingReportModel(i, {
    discreet,
    generatedAt: '2026-09-21T08:00:00.000Z',
    version: '0.1.0',
    timeZone: 'Europe/Paris',
  });

const all = (m: ReportModel, id: string): ReportKpi[] => {
  const block = section(m, id)?.block;
  if (block?.kind === 'kpis') return [...block.kpis, ...block.details];
  if (block?.kind === 'details') return block.details;
  return [];
};
const kpi = (m: ReportModel, id: string, label: string): string | undefined =>
  all(m, id).find((k) => k.label === label)?.value;
const bullets = (m: ReportModel): string[] => {
  const block = section(m, 'coverage')?.block;
  return block?.kind === 'bullets' ? block.items : [];
};

describe('rapport de prêts', () => {
  it('suit l’ordre du squelette commun', () => {
    expect(build(input()).sections.map((s) => s.id)).toEqual([
      'summary',
      'account',
      'income',
      'risk',
      'coverage',
      'methodology',
    ]);
  });

  it('imprime l’identité de l’écran : apports nets + résultat = valeur', () => {
    const m = build(input());
    expect(kpi(m, 'summary', 'Apports nets')).toBe(eur('1000'));
    expect(kpi(m, 'summary', 'Résultat')).toBe(eur('14.18', true));
    expect(kpi(m, 'summary', 'Valeur du portefeuille')).toBe(eur('1014.18'));
  });

  it('écrit le TRI « par an », comme l’écran, ou la raison de son absence', () => {
    expect(kpi(build(input()), 'summary', 'TRI net')).toBe(perYear('0.052'));
    const young = build(input({ xirrNet: { ok: false, reason: 'too-recent' } }));
    expect(kpi(young, 'summary', 'TRI net')).toBe('moins de 30 jours d’historique');
  });

  it('présente le recyclage pour ce qu’il est : une métrique maison', () => {
    const m = build(input());
    expect(kpi(m, 'account', 'Recyclage')).toBe('0,80 fois vos apports');
    expect(bullets(m).join(' ')).toContain('sans équivalent établi');
    expect(kpi(build(input({ recycling: null })), 'account', 'Recyclage')).toBe('—');
  });

  it('écrit les prélèvements et les pertes en négatif', () => {
    const m = build(input({ writtenOff: D('40') }));
    expect(kpi(m, 'income', 'Prélèvements retenus à la source')).toBe(eur('-2.93', true));
    expect(kpi(m, 'income', 'Capital passé en perte')).toBe(eur('-40', true));
  });

  it('reprend les seuils de concentration de l’écran, bornes comprises', () => {
    const lead = (index: string) =>
      section(
        build(input({ concentration: { ...input().concentration, index: D(index) } })),
        'risk',
      )?.lead ?? '';
    expect(lead('0.1499')).toMatch(/^Dispersé/);
    expect(lead('0.15')).toMatch(/^Modérément concentré/);
    expect(lead('0.2499')).toMatch(/^Modérément concentré/);
    expect(lead('0.25')).toMatch(/^Fortement concentré/);
    const none = build(input({ concentration: { index: null, effectiveCount: null, top: [] } }));
    expect(section(none, 'risk')?.lead).toMatch(/^Non mesurable/);
  });

  it('ne nomme que les cinq emprunteurs les plus exposés', () => {
    const top = Array.from({ length: 7 }, (_, i) => borrower(`E${i}`, '10', '0.1'));
    const m = build(input({ concentration: { ...input().concentration, top } }));
    expect(tableOf(m, 'risk')?.rows).toHaveLength(5);
  });

  it('dit les intérêts courus qu’il ne compte pas', () => {
    expect(bullets(build(input({ accrualUnavailable: 3 }))).join(' ')).toContain('3 prêts');
    expect(bullets(build(input())).join(' ')).not.toContain('intérêts courus');
  });

  it('ne parle de l’impôt débité du portefeuille que s’il y en a', () => {
    expect(bullets(build(input())).join(' ')).not.toContain('impôt débité');
    expect(bullets(build(input({ taxDebitedFromWallet: D('1.63') }))).join(' ')).toContain(
      'impôt débité',
    );
  });

  it('masque les montants en mode discret, pas les taux', () => {
    const m = build(input(), true);
    expect(kpi(m, 'summary', 'Valeur du portefeuille')).toBe(MASK);
    expect(kpi(m, 'summary', 'TRI net')).toBe(perYear('0.052'));
  });

  it('nomme son fichier et son titre', () => {
    const m = build(input());
    expect(m.meta.fileSlug).toBe('prets');
    expect(m.cover.title).toBe('Rapport de prêts');
  });
});
