/**
 * Flux de trésorerie du moteur : miroir daté exact des opérations comptées.
 * Oracle : Σ flux négatifs = −(Σ investedTotal + abonnements) et Σ flux positifs = Σ proceedsTotal
 * (positions bloquées comprises), quel que soit le mélange d'événements.
 */
import { describe, expect, it } from 'vitest';
import { D, ZERO } from '../money';
import { DEFAULT_ENGINE_SETTINGS, type LedgerEvent } from '../types';
import { runLedger, type LedgerRun } from './compute';

const base = {
  source: 'manual' as const,
  scope: 'external' as const,
  accountId: 'man:test',
  rowKeys: [],
  warnings: [],
};

const trade = (
  id: string,
  at: string,
  out: [string, string],
  input: [string, string],
  valueEur: string,
): LedgerEvent => ({
  ...base,
  id,
  kind: 'trade',
  at,
  out: { asset: out[0], qty: out[1] },
  in: { asset: input[0], qty: input[1] },
  valueEur,
  valueEurSource: 'counter-leg',
  fee: null,
  quotePrice: null,
});

function oracle(run: LedgerRun): void {
  let invested = run.subscriptionsEur;
  let proceeds = ZERO;
  for (const state of run.positions.values()) {
    invested = invested.plus(state.investedTotal);
    proceeds = proceeds.plus(state.proceedsTotal);
  }
  let negative = ZERO;
  let positive = ZERO;
  for (const flow of run.cashFlows) {
    if (flow.amountEur.lt(ZERO)) negative = negative.plus(flow.amountEur);
    else positive = positive.plus(flow.amountEur);
  }
  expect(negative.neg().toString()).toBe(invested.toString());
  expect(positive.toString()).toBe(proceeds.toString());
}

describe('runLedger — cashFlows', () => {
  it('reflète achats, swaps, ventes, dépôts, retraits au coût, frais — et respecte l’oracle', () => {
    const events: LedgerEvent[] = [
      {
        ...base,
        id: 'e0',
        kind: 'opening-balance',
        at: '2025-01-01T08:00:00',
        in: { asset: 'btc', qty: '0.5' },
        costEur: '5000',
      },
      trade('e1', '2025-02-01T10:00:00', ['eur', '1000'], ['btc', '0.02'], '1000'),
      trade('e2', '2025-03-01T10:00:00', ['btc', '0.01'], ['eth', '0.4'], '450'),
      {
        ...base,
        id: 'e3',
        kind: 'reward',
        at: '2025-03-15T09:00:00',
        in: { asset: 'sol', qty: '2' },
        fairValueEur: '60',
      },
      {
        ...base,
        id: 'e4',
        kind: 'deposit',
        at: '2025-04-01T09:00:00',
        in: { asset: 'eth', qty: '0.1' },
        costEur: '200',
      },
      {
        ...base,
        id: 'e5',
        kind: 'withdrawal',
        at: '2025-05-01T09:00:00',
        out: { asset: 'btc', qty: '0.05' },
        proceedsEur: null,
      },
      { ...base, id: 'e6', kind: 'fee', at: '2025-05-02T09:00:00', amountEur: '9.9', label: 'abo' },
      trade('e7', '2025-06-01T10:00:00', ['eth', '0.2'], ['eur', '520'], '520'),
    ];
    const run = runLedger(events, DEFAULT_ENGINE_SETTINGS);
    oracle(run);
    // Le swap crypto↔crypto produit deux flux qui se neutralisent le même jour.
    const swapFlows = run.cashFlows.filter((f) => f.at === '2025-03-01T10:00:00');
    expect(swapFlows.map((f) => f.amountEur.toString()).sort()).toEqual(['-450', '450']);
    // La récompense n'émet aucun flux (revenu interne).
    expect(run.cashFlows.some((f) => f.at === '2025-03-15T09:00:00')).toBe(false);
    // Le retrait au coût sort au coût moyen : 0.05 × (6000 / 0.52) = 576.923…
    const withdrawal = run.cashFlows.find((f) => f.at === '2025-05-01T09:00:00');
    expect(withdrawal).toBeDefined();
    expect(withdrawal!.amountEur.round(6).toString()).toBe(
      D('6000').div('0.52').times('0.05').round(6).toString(),
    );
  });

  it('virement interne apparié : deux flux qui se compensent, oracle intact', () => {
    const events: LedgerEvent[] = [
      trade('t1', '2025-01-10T10:00:00', ['eur', '10000'], ['btc', '1'], '10000'),
      {
        ...base,
        id: 'w1',
        kind: 'withdrawal',
        at: '2025-02-01T10:00:00',
        out: { asset: 'btc', qty: '0.5' },
        proceedsEur: null,
        transferTo: 'd1',
      },
      {
        ...base,
        id: 'd1',
        kind: 'deposit',
        at: '2025-02-01T11:00:00',
        accountId: 'man:other',
        in: { asset: 'btc', qty: '0.4995' },
        costEur: null,
        transferFrom: 'w1',
      },
    ];
    const run = runLedger(events, DEFAULT_ENGINE_SETTINGS);
    oracle(run);
    const transferFlows = run.cashFlows.filter((f) => f.at.startsWith('2025-02-01'));
    expect(transferFlows.map((f) => f.amountEur.toString()).sort()).toEqual(['-5000', '5000']);
  });

  it('cession sur actif bloqué : aucun flux fantôme, oracle intact', () => {
    const events: LedgerEvent[] = [
      {
        ...base,
        id: 'w9',
        kind: 'withdrawal',
        at: '2025-01-05T10:00:00',
        out: { asset: 'ada', qty: '100' },
        proceedsEur: '50',
      },
      trade('t9', '2025-01-06T10:00:00', ['eur', '20'], ['ada', '10'], '20'),
    ];
    const run = runLedger(events, DEFAULT_ENGINE_SETTINGS);
    expect(run.positions.get('ada')?.blocked).not.toBeNull();
    expect(run.cashFlows).toHaveLength(0);
    oracle(run);
  });

  it('migration : aucun flux en report de coût, deux flux neutres en réalisation', () => {
    const migration = (id: string): LedgerEvent => ({
      ...base,
      id,
      kind: 'migration',
      at: '2025-03-01T10:00:00',
      out: { asset: 'lunc', qty: '100' },
      in: { asset: 'luna', qty: '1' },
      fairValueOutEur: '80',
      fairValueInEur: null,
    });
    const buy = trade('m1', '2025-01-10T10:00:00', ['eur', '100'], ['lunc', '100'], '100');
    const carry = runLedger([buy, migration('m2')], DEFAULT_ENGINE_SETTINGS);
    expect(carry.cashFlows.map((f) => f.amountEur.toString())).toEqual(['-100']);
    oracle(carry);
    const realize = runLedger([buy, migration('m2')], {
      ...DEFAULT_ENGINE_SETTINGS,
      migrationMode: 'realize',
    });
    expect(
      realize.cashFlows
        .filter((f) => f.at === '2025-03-01T10:00:00')
        .map((f) => f.amountEur.toString())
        .sort(),
    ).toEqual(['-80', '80']);
    oracle(realize);
  });
});
