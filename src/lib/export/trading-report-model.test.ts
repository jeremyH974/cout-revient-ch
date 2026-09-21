/**
 * Le rapport de trading (décision n° 178). Ce module ne calcule rien : les tests ne vérifient pas
 * des chiffres du moteur, mais ce que le document **dit** — l'identité de sa synthèse, les deux
 * populations qu'il ne doit pas confondre, et les refus : un solde non mesuré qui ne vaut pas
 * zéro, un petit échantillon qui ne conclut rien, des frais en jeton qui ne sont comptés nulle part.
 */
import { describe, expect, it } from 'vitest';
import { D } from '../domain/money';
import type { TradingStats } from '../domain/trading/stats';
import { fmtMoney, MASK } from '../format/fr';
import { section, tableOf, type ReportKpi, type ReportModel } from './report-model';
import {
  buildTradingReportModel,
  type TradingReportAccount,
  type TradingReportInput,
} from './trading-report-model';

const eur = (amount: string, sign = false): string => fmtMoney(D(amount), 'EUR', { sign });

const stats = (over: Partial<TradingStats> = {}): TradingStats => ({
  total: 40,
  closed: 38,
  open: 2,
  incomplete: 0,
  excluded: 0,
  wins: 22,
  losses: 15,
  breakeven: 1,
  winRate: D('0.5946'),
  profitFactor: D('1.8'),
  expectancy: D('12.5'),
  expectancyR: D('0.42'),
  nR: 20,
  avgWin: D('60'),
  avgLoss: D('-40'),
  payoff: D('1.5'),
  best: D('310'),
  worst: D('-150'),
  netTotal: D('475'),
  grossTotal: D('520'),
  feesTotal: D('40'),
  fundingTotal: D('-5'),
  maxDrawdown: D('220'),
  longestWinStreak: 6,
  longestLossStreak: 4,
  avgHoldSeconds: 7200,
  smallSample: false,
  ...over,
});

const account = (over: Partial<TradingReportAccount> = {}): TradingReportAccount => ({
  label: 'Compte principal',
  equity: D('5200'),
  net: D('600'),
  realized: D('700'),
  fees: D('90'),
  funding: D('-10'),
  netFlows: D('4000'),
  fills: 120,
  ...over,
});

const input = (over: Partial<TradingReportInput> = {}): TradingReportInput => ({
  net: D('600'),
  realized: D('700'),
  fees: D('90'),
  funding: D('-10'),
  unrealized: D('150'),
  equity: D('5200'),
  netFlows: D('4000'),
  accounts: [account()],
  unvalued: [],
  nativeFeeTokens: [],
  stats: stats(),
  statsPeriod: 'depuis l’origine',
  ...over,
});

const build = (i: TradingReportInput, discreet = false): ReportModel =>
  buildTradingReportModel(i, {
    discreet,
    generatedAt: '2026-09-21T08:00:00.000Z',
    version: '0.1.0',
    timeZone: 'Europe/Paris',
  });

const kpis = (m: ReportModel, id: string): ReportKpi[] => {
  const block = section(m, id)?.block;
  return block?.kind === 'kpis' ? [...block.kpis, ...block.details] : [];
};
const kpi = (m: ReportModel, id: string, label: string): ReportKpi | undefined =>
  kpis(m, id).find((k) => k.label === label);
const bullets = (m: ReportModel): string[] => {
  const block = section(m, 'coverage')?.block;
  return block?.kind === 'bullets' ? block.items : [];
};

describe('rapport de trading', () => {
  it('suit l’ordre du squelette commun', () => {
    expect(build(input()).sections.map((s) => s.id)).toEqual([
      'summary',
      'stats',
      'accounts',
      'coverage',
      'methodology',
    ]);
  });

  it('imprime une identité qui se refait : réalisé net + latent = résultat', () => {
    const m = build(input());
    expect(kpi(m, 'summary', 'Réalisé net')?.value).toBe(eur('600', true));
    expect(kpi(m, 'summary', 'Latent')?.value).toBe(eur('150', true));
    expect(kpi(m, 'summary', 'Résultat')?.value).toBe(eur('750', true));
  });

  it('n’additionne pas un inconnu : sans latent, pas de résultat', () => {
    expect(kpi(build(input({ unrealized: null })), 'summary', 'Résultat')?.value).toBe('—');
  });

  it('écrit les frais en négatif, là où ils coûtent', () => {
    expect(kpi(build(input()), 'summary', 'Frais')?.value).toBe(eur('-90', true));
  });

  it('dit sur combien de trades clos portent ses statistiques', () => {
    const lead = section(build(input()), 'stats')?.lead ?? '';
    expect(lead).toContain('38 allers-retours clos depuis l’origine');
  });

  it('prévient sous 30 trades clos, et se tait au-delà', () => {
    const small = section(
      build(input({ stats: stats({ closed: 12, smallSample: true }) })),
      'stats',
    );
    expect(small?.warnings.join(' ')).toContain('sous 30');
    expect(section(build(input()), 'stats')?.warnings).toEqual([]);
  });

  it('nie le drawdown maximal, que le moteur tient en magnitude', () => {
    expect(kpi(build(input()), 'stats', 'Drawdown maximal')?.value).toBe(eur('-220', true));
  });

  it('n’ouvre aucune section de statistiques sans trade', () => {
    const none = build(input({ stats: stats({ closed: 0, open: 0, total: 0 }) }));
    expect(section(none, 'stats')).toBeNull();
  });

  it('ne compte pas pour zéro un compte sans instantané, et le nomme', () => {
    const m = build(
      input({
        equity: null,
        unvalued: ['Compte B'],
        accounts: [account(), account({ label: 'Compte B', equity: null })],
      }),
    );
    expect(kpi(m, 'summary', 'Valeur des comptes')?.value).toBe('—');
    expect(m.cover.notes.join(' ')).toContain('NON MESURÉE');
    expect(bullets(m).join(' ')).toContain('Compte B');
    const table = tableOf(m, 'accounts');
    expect(table?.rows[1]?.[0]?.sub).toBe('sans instantané');
  });

  it('ne totalise le tableau des comptes qu’à partir de deux comptes', () => {
    expect(tableOf(build(input()), 'accounts')?.total).toBeNull();
    const two = build(input({ accounts: [account(), account({ label: 'B' })] }));
    expect(tableOf(two, 'accounts')?.total?.[0]?.text).toBe('Total');
  });

  it('dit les frais payés en jeton, qu’aucun total ne compte', () => {
    expect(bullets(build(input({ nativeFeeTokens: ['HYPE'] }))).join(' ')).toContain('HYPE');
  });

  it('rappelle toujours que le régime fiscal des perpétuels n’est pas chiffré', () => {
    expect(bullets(build(input())).join(' ')).toContain('contrats perpétuels');
  });

  it('masque les montants en mode discret, pas les ratios ni les effectifs', () => {
    const m = build(input(), true);
    expect(kpi(m, 'summary', 'Réalisé net')?.value).toBe(MASK);
    expect(kpi(m, 'stats', 'Profit factor')?.value).toBe('1,80');
    expect(kpi(m, 'stats', 'Trades clos')?.value).toBe('38');
  });

  it('nomme son fichier et son titre', () => {
    const m = build(input());
    expect(m.meta.fileSlug).toBe('trading');
    expect(m.cover.title).toBe('Rapport de trading');
  });
});
