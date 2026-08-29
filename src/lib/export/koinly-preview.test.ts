/** Décompte de portabilité Koinly : un code par perte connue, jamais de texte ici. */
import { describe, expect, it } from 'vitest';
import type {
  DepositEvent,
  MigrationEvent,
  OpeningBalanceEvent,
  TradeEvent,
  UnqualifiedEvent,
  WithdrawalEvent,
} from '../domain/types';
import { koinlyPortabilityPreview } from './koinly-preview';

const base = {
  id: 'e1',
  at: '2026-01-01T10:00:00',
  source: 'manual' as const,
  scope: 'coinhouse' as const,
  rowKeys: [],
  warnings: [],
};

const trade = (accountId: string): TradeEvent => ({
  ...base,
  id: `trade-${accountId}`,
  accountId,
  kind: 'trade',
  out: { asset: 'eur', qty: '1000' },
  in: { asset: 'btc', qty: '0.02' },
  valueEur: '1000',
  valueEurSource: 'manual',
  fee: null,
  quotePrice: null,
});

describe('koinlyPortabilityPreview', () => {
  it('rien à signaler pour de simples échanges dans un seul compte', () => {
    expect(koinlyPortabilityPreview([trade('ch:main')])).toEqual([]);
  });

  it('accounts-merged seulement à partir de deux comptes distincts', () => {
    expect(koinlyPortabilityPreview([trade('ch:main')])).toEqual([]);
    expect(koinlyPortabilityPreview([trade('ch:main'), trade('csv:a')])).toEqual([
      { code: 'accounts-merged', count: 2 },
    ]);
    expect(koinlyPortabilityPreview([trade('ch:main'), trade('csv:a'), trade('hl:0xabc')])).toEqual(
      [{ code: 'accounts-merged', count: 3 }],
    );
  });

  it('migration-as-trade compte chaque migration', () => {
    const migration: MigrationEvent = {
      ...base,
      accountId: 'ch:main',
      kind: 'migration',
      out: { asset: 'mkr', qty: '1' },
      in: { asset: 'sky', qty: '24000' },
      fairValueOutEur: '1500',
      fairValueInEur: null,
    };
    expect(koinlyPortabilityPreview([migration, { ...migration, id: 'm2' }])).toEqual([
      { code: 'migration-as-trade', count: 2 },
    ]);
  });

  it('opening-balance-cost-lost seulement pour un actif crypto non cash', () => {
    const openingCrypto: OpeningBalanceEvent = {
      ...base,
      accountId: 'ch:main',
      kind: 'opening-balance',
      in: { asset: 'btc', qty: '1' },
      costEur: '30000',
    };
    const openingCash: OpeningBalanceEvent = {
      ...openingCrypto,
      id: 'e2',
      in: { asset: 'usdc', qty: '100' },
      costEur: '100',
    };
    expect(koinlyPortabilityPreview([openingCrypto])).toEqual([
      { code: 'opening-balance-cost-lost', count: 1 },
    ]);
    // Un solde d'ouverture « cash » (stablecoin) n'est pas dans ce compte : recalculé au taux BCE,
    // ce n'est pas la même perte (docs/backup-format.md).
    expect(koinlyPortabilityPreview([openingCash])).toEqual([]);
  });

  it('paired-transfers-lost seulement côté retrait, jamais compté deux fois', () => {
    const withdrawal: WithdrawalEvent = {
      ...base,
      accountId: 'ch:main',
      kind: 'withdrawal',
      out: { asset: 'btc', qty: '0.1' },
      proceedsEur: null,
      transferTo: 'pv:x',
    };
    const deposit: DepositEvent = {
      ...base,
      id: 'e2',
      accountId: 'csv:a',
      kind: 'deposit',
      in: { asset: 'btc', qty: '0.1' },
      costEur: null,
      transferFrom: 'e1',
    };
    // Les deux jambes d'UNE SEULE paire : un seul compté (celui du retrait), pas deux.
    expect(koinlyPortabilityPreview([withdrawal, deposit])).toEqual([
      { code: 'accounts-merged', count: 2 },
      { code: 'paired-transfers-lost', count: 1 },
    ]);
  });

  it('les lignes « à qualifier » ne comptent nulle part (jamais exportées)', () => {
    const unqualified: UnqualifiedEvent = {
      ...base,
      accountId: 'csv:other',
      kind: 'unqualified',
      rawType: 'mystère',
      legs: [],
      reason: 'test',
    };
    expect(koinlyPortabilityPreview([trade('ch:main'), unqualified])).toEqual([]);
  });

  it('plusieurs codes peuvent coexister, chacun avec son propre compte', () => {
    const migration: MigrationEvent = {
      ...base,
      id: 'mig',
      accountId: 'ch:main',
      kind: 'migration',
      out: { asset: 'mkr', qty: '1' },
      in: { asset: 'sky', qty: '24000' },
      fairValueOutEur: '1500',
      fairValueInEur: null,
    };
    const opening: OpeningBalanceEvent = {
      ...base,
      id: 'open',
      accountId: 'csv:a',
      kind: 'opening-balance',
      in: { asset: 'eth', qty: '2' },
      costEur: '4000',
    };
    const result = koinlyPortabilityPreview([migration, opening]);
    expect(result).toEqual([
      { code: 'migration-as-trade', count: 1 },
      { code: 'accounts-merged', count: 2 },
      { code: 'opening-balance-cost-lost', count: 1 },
    ]);
  });
});
