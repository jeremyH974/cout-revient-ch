import { describe, expect, it } from 'vitest';
import type { DeclarationReport } from './declarations-fr';
import type { IntegrityResult, PortfolioReport, PositionReport } from './engine/report';
import { D, ZERO } from './money';
import {
  buildReconciliation,
  duplicatePairKey,
  summarizeReconciliation,
  type ReconciliationCode,
  type ReconciliationContext,
} from './reconciliation';
import type { TaxLedger } from './tax-fr';
import type { TransferPairing } from './transfers';
import type { DepositEvent, TradeEvent, UnqualifiedEvent, WithdrawalEvent } from './types';

// --- Fabriques minimales : des rapports DÉJÀ CALCULÉS, jamais recalculés par le moteur ici -------

const EMPTY_TOTALS: PortfolioReport['totals'] = {
  value: ZERO,
  costBasis: ZERO,
  unpricedCostBasis: ZERO,
  investedTotal: ZERO,
  proceedsTotal: ZERO,
  netInvested: ZERO,
  realized: ZERO,
  unrealized: ZERO,
  otherIncome: ZERO,
  total: ZERO,
  roiBase: ZERO,
  roi: null,
  cashIn: ZERO,
  cashOut: ZERO,
  netCash: ZERO,
  feesEur: ZERO,
  rebatesEur: ZERO,
  subscriptionsEur: ZERO,
  unpricedAssets: [],
};

function baseReport(overrides: Partial<PortfolioReport> = {}): PortfolioReport {
  return {
    positions: [],
    cashFlows: [],
    stablecoins: [],
    closed: [],
    blocked: [],
    totals: EMPTY_TOTALS,
    allocation: [],
    unqualified: [],
    pricedAt: null,
    warnings: [],
    ...overrides,
  };
}

function integrityOf(status: IntegrityResult['status'], asset = 'btc'): IntegrityResult {
  return {
    asset,
    status,
    message: 'test',
    impliedOpening: null,
    expected: null,
    found: null,
    at: null,
    reorderedDays: [],
  };
}

function basePosition(asset: string, overrides: Partial<PositionReport> = {}): PositionReport {
  return {
    asset,
    assetClass: 'crypto',
    status: 'ok',
    qty: ZERO,
    costBasis: ZERO,
    pru: null,
    investedTotal: ZERO,
    proceedsTotal: ZERO,
    netInvested: ZERO,
    capitalRecovered: false,
    price: null,
    value: null,
    unrealized: null,
    unrealizedPct: null,
    realized: ZERO,
    otherIncome: ZERO,
    total: null,
    roiBase: ZERO,
    roi: null,
    lots: [],
    history: [],
    feesEur: ZERO,
    rebatesEur: ZERO,
    zeroCostQty: ZERO,
    closed: false,
    dust: false,
    blocked: null,
    unqualifiedCount: 0,
    warnings: [],
    integrity: null,
    ...overrides,
  };
}

function baseTransfers(overrides: Partial<TransferPairing> = {}): TransferPairing {
  return { events: [], pairs: [], unpairedWithdrawals: [], unpairedDeposits: [], ...overrides };
}

function baseDeclarations(overrides: Partial<DeclarationReport> = {}): DeclarationReport {
  return { year: 2026, accounts: [], includedCount: 0, uncertainCount: 0, ...overrides };
}

function baseCtx(overrides: Partial<ReconciliationContext> = {}): ReconciliationContext {
  return {
    report: baseReport(),
    events: [],
    transfers: baseTransfers(),
    declarations: baseDeclarations(),
    tax: null,
    trading: [],
    duplicateOverrides: {},
    ...overrides,
  };
}

let seq = 0;
const eventBase = () => ({
  id: `e${++seq}`,
  source: 'coinhouse-csv' as const,
  scope: 'coinhouse' as const,
  accountId: 'ch:main',
  rowKeys: [`row:${seq}`],
  warnings: [],
});

function unqualifiedEvent(over: Partial<UnqualifiedEvent> = {}): UnqualifiedEvent {
  return {
    ...eventBase(),
    kind: 'unqualified',
    at: '2026-01-05T10:00:00',
    rawType: 'Type inconnu',
    legs: [{ asset: 'btc', signedQty: '1', valueEur: null }],
    reason: 'type inconnu',
    ...over,
  };
}

function withdrawalEvent(over: Partial<WithdrawalEvent> = {}): WithdrawalEvent {
  return {
    ...eventBase(),
    kind: 'withdrawal',
    at: '2026-01-05T10:00:00',
    out: { asset: 'btc', qty: '1' },
    proceedsEur: null,
    ...over,
  };
}

function depositEvent(over: Partial<DepositEvent> = {}): DepositEvent {
  return {
    ...eventBase(),
    kind: 'deposit',
    at: '2026-01-05T10:00:00',
    in: { asset: 'btc', qty: '1' },
    costEur: null,
    ...over,
  };
}

function buyEvent(over: Partial<TradeEvent> = {}): TradeEvent {
  return {
    ...eventBase(),
    kind: 'trade',
    at: '2026-01-05T10:00:00',
    out: { asset: 'eur', qty: '100' },
    in: { asset: 'btc', qty: '1' },
    valueEur: '100',
    valueEurSource: 'counter-leg',
    fee: null,
    quotePrice: null,
    ...over,
  };
}

const codesOf = (report: ReturnType<typeof buildReconciliation>): ReconciliationCode[] =>
  report.items.map((i) => i.code);
const find = (report: ReturnType<typeof buildReconciliation>, code: ReconciliationCode) =>
  report.items.find((i) => i.code === code);

describe('buildReconciliation', () => {
  it('portefeuille vide : aucun item', () => {
    expect(buildReconciliation(baseCtx()).items).toEqual([]);
  });

  // --- unqualified-rows ----------------------------------------------------------------------
  it('unqualified-rows : absent sans ligne à qualifier', () => {
    expect(find(buildReconciliation(baseCtx()), 'unqualified-rows')).toBeUndefined();
  });

  it('unqualified-rows : un item agrégé, en fail, quand des lignes restent à qualifier', () => {
    const e1 = unqualifiedEvent();
    const e2 = unqualifiedEvent({ rawType: 'Autre type' });
    const ctx = baseCtx({ report: baseReport({ unqualified: [e1, e2] }) });
    const item = find(buildReconciliation(ctx), 'unqualified-rows');
    expect(item).toBeDefined();
    expect(item?.severity).toBe('fail');
    expect(item?.values['count']).toEqual({ kind: 'count', value: 2 });
    expect(item?.evidence.eventIds).toEqual([e1.id, e2.id]);
    expect(item?.evidence.rowKeys).toEqual([...e1.rowKeys, ...e2.rowKeys]);
    expect(item?.action).toEqual({ code: 'qualify-rows' });
  });

  // --- unpriced-asset --------------------------------------------------------------------------
  it('unpriced-asset : absent sans actif sans cours', () => {
    expect(find(buildReconciliation(baseCtx()), 'unpriced-asset')).toBeUndefined();
  });

  it('unpriced-asset : un item par actif sans cours', () => {
    const ctx = baseCtx({
      report: baseReport({ totals: { ...EMPTY_TOTALS, unpricedAssets: ['btc', 'eth'] } }),
    });
    const items = buildReconciliation(ctx).items.filter((i) => i.code === 'unpriced-asset');
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.scope.asset).sort()).toEqual(['btc', 'eth']);
    expect(items[0]?.action.code).toBe('set-manual-price');
    expect(items.every((i) => i.severity === 'warn')).toBe(true);
  });

  // --- balance-mismatch (Coinhouse) -------------------------------------------------------------
  it('balance-mismatch : absent quand les soldes sont cohérents', () => {
    const ctx = baseCtx({
      report: baseReport({ positions: [basePosition('btc', { integrity: integrityOf('ok') })] }),
    });
    expect(find(buildReconciliation(ctx), 'balance-mismatch')).toBeUndefined();
  });

  it('balance-mismatch : un écart réel est fail, avec l’action de réimport', () => {
    const ctx = baseCtx({
      report: baseReport({
        positions: [basePosition('btc', { integrity: integrityOf('balance-mismatch') })],
      }),
    });
    const item = find(buildReconciliation(ctx), 'balance-mismatch');
    expect(item?.severity).toBe('fail');
    expect(item?.scope).toEqual({ asset: 'btc', accountId: 'ch:main' });
    expect(item?.action.code).toBe('reimport-export');
  });

  it('balance-mismatch : un solde d’ouverture manquant reste warn, avec sa propre action', () => {
    const ctx = baseCtx({
      report: baseReport({
        positions: [basePosition('eth', { integrity: integrityOf('opening-balance-missing') })],
      }),
    });
    const item = find(buildReconciliation(ctx), 'balance-mismatch');
    expect(item?.severity).toBe('warn');
    expect(item?.action.code).toBe('enter-opening-balance');
  });

  it('balance-mismatch (Hyperliquid) : absent sous la tolérance', () => {
    const ctx = baseCtx({ trading: [{ accountId: 'hl:0x1', gap: D('0.001') }] });
    expect(find(buildReconciliation(ctx), 'balance-mismatch')).toBeUndefined();
  });

  it('balance-mismatch (Hyperliquid) : présent au-delà de la tolérance, scope sur le compte', () => {
    const ctx = baseCtx({ trading: [{ accountId: 'hl:0x1', gap: D('42') }] });
    const item = find(buildReconciliation(ctx), 'balance-mismatch');
    expect(item?.severity).toBe('fail');
    expect(item?.scope).toEqual({ asset: null, accountId: 'hl:0x1' });
    expect(item?.evidence.trace).toBeNull();
  });

  // --- virements (unpaired-withdrawal / unpaired-deposit) --------------------------------------
  it('unpaired-withdrawal / unpaired-deposit : absents sans virement orphelin', () => {
    const report = buildReconciliation(baseCtx());
    expect(find(report, 'unpaired-withdrawal')).toBeUndefined();
    expect(find(report, 'unpaired-deposit')).toBeUndefined();
  });

  it('unpaired-withdrawal : un item par retrait sans contrepartie', () => {
    const w = withdrawalEvent();
    const ctx = baseCtx({ transfers: baseTransfers({ unpairedWithdrawals: [w] }) });
    const item = find(buildReconciliation(ctx), 'unpaired-withdrawal');
    expect(item?.scope).toEqual({ asset: 'btc', accountId: 'ch:main' });
    expect(item?.evidence.eventIds).toEqual([w.id]);
    expect(item?.action).toEqual({
      code: 'pair-or-value-transfer',
      accountId: 'ch:main',
      asset: 'btc',
    });
  });

  it('unpaired-deposit : un item par dépôt sans contrepartie', () => {
    const d = depositEvent();
    const ctx = baseCtx({ transfers: baseTransfers({ unpairedDeposits: [d] }) });
    const item = find(buildReconciliation(ctx), 'unpaired-deposit');
    expect(item?.scope).toEqual({ asset: 'btc', accountId: 'ch:main' });
    expect(item?.evidence.eventIds).toEqual([d.id]);
  });

  // --- risque fiscal direct --------------------------------------------------------------------
  it('external-inflow-no-cost : absent sans dépôt orphelin, présent (agrégé) sinon', () => {
    expect(find(buildReconciliation(baseCtx()), 'external-inflow-no-cost')).toBeUndefined();
    const d1 = depositEvent();
    const d2 = depositEvent();
    const ctx = baseCtx({ transfers: baseTransfers({ unpairedDeposits: [d1, d2] }) });
    const item = find(buildReconciliation(ctx), 'external-inflow-no-cost');
    expect(item?.values['count']).toEqual({ kind: 'count', value: 2 });
    expect(item?.severity).toBe('warn');
  });

  it('external-outflow-unqualified : absent sans retrait orphelin, présent (agrégé) sinon', () => {
    expect(find(buildReconciliation(baseCtx()), 'external-outflow-unqualified')).toBeUndefined();
    const w1 = withdrawalEvent();
    const ctx = baseCtx({ transfers: baseTransfers({ unpairedWithdrawals: [w1] }) });
    const item = find(buildReconciliation(ctx), 'external-outflow-unqualified');
    expect(item?.values['count']).toEqual({ kind: 'count', value: 1 });
  });

  it('price-gap-at-cession : info, action « none » (aucun écran pour l’annoter)', () => {
    expect(find(buildReconciliation(baseCtx()), 'price-gap-at-cession')).toBeUndefined();
    const tax: TaxLedger = {
      cessions: [
        {
          eventId: 'e1',
          at: '2026-01-05T10:00:00',
          year: 2026,
          proceedsEur: '100',
          globalValueEur: null,
          ptaBefore: '50',
          acquisitionShareEur: null,
          gainEur: null,
          ptaAfter: '50',
        },
      ],
      years: [],
      ptaAfter: '50',
      unknownGlobalValue: 1,
      externalInflows: 0,
      externalOutflows: 0,
      rewards: 0,
    };
    const item = find(buildReconciliation(baseCtx({ tax })), 'price-gap-at-cession');
    expect(item?.severity).toBe('info');
    expect(item?.action).toEqual({ code: 'none' });
  });

  // --- account-missing-country -------------------------------------------------------------------
  it('account-missing-country : absent sans compte au statut inconnu', () => {
    expect(find(buildReconciliation(baseCtx()), 'account-missing-country')).toBeUndefined();
  });

  it('account-missing-country : un item par compte, en info', () => {
    const declarations = baseDeclarations({
      accounts: [
        {
          accountId: 'csv:kraken',
          label: 'Kraken',
          status: 'unknown',
          country: null,
          usedInYear: true,
          currentlyHolds: true,
          possiblyClosedInYear: false,
        },
      ],
    });
    const item = find(buildReconciliation(baseCtx({ declarations })), 'account-missing-country');
    expect(item?.severity).toBe('info');
    expect(item?.scope).toEqual({ asset: null, accountId: 'csv:kraken' });
    expect(item?.action).toEqual({ code: 'set-account-country', accountId: 'csv:kraken' });
  });

  // --- onchain-balance-gap : jamais peuplé (réservé) ---------------------------------------------
  it('onchain-balance-gap : n’apparaît jamais, quel que soit le contexte', () => {
    const ctx = baseCtx({
      report: baseReport({
        unqualified: [unqualifiedEvent()],
        positions: [basePosition('btc', { integrity: integrityOf('balance-mismatch') })],
      }),
      trading: [{ accountId: 'hl:0x1', gap: D('99') }],
    });
    expect(codesOf(buildReconciliation(ctx))).not.toContain('onchain-balance-gap');
  });

  // --- duplicate-candidate ------------------------------------------------------------------------
  it('duplicate-candidate : deux achats identiques le même jour sur le même compte n’en produit aucun', () => {
    const a = buyEvent({ accountId: 'ch:main', source: 'coinhouse-csv' });
    const b = buyEvent({ accountId: 'ch:main', source: 'coinhouse-csv' });
    const ctx = baseCtx({ events: [a, b] });
    expect(find(buildReconciliation(ctx), 'duplicate-candidate')).toBeUndefined();
  });

  it('duplicate-candidate : mêmes date/actif/quantité sur deux comptes différents en produit un', () => {
    const a = buyEvent({ accountId: 'ch:main' });
    const b = buyEvent({ accountId: 'man:default', source: 'manual' });
    const ctx = baseCtx({ events: [a, b] });
    const items = buildReconciliation(ctx).items.filter((i) => i.code === 'duplicate-candidate');
    expect(items).toHaveLength(1);
    const item = items[0]!;
    expect(item.severity).toBe('warn');
    expect(item.scope).toEqual({ asset: 'btc', accountId: null });
    expect(item.evidence.eventIds.slice().sort()).toEqual([a.id, b.id].sort());
    expect(item.action.code).toBe('review-duplicate');
  });

  it('duplicate-candidate : mêmes date/actif/quantité, même compte mais sources différentes en produit un', () => {
    const a = buyEvent({ accountId: 'ch:main', source: 'coinhouse-csv' });
    const b = buyEvent({ accountId: 'ch:main', source: 'pivot-csv' });
    const ctx = baseCtx({ events: [a, b] });
    const item = find(buildReconciliation(ctx), 'duplicate-candidate');
    expect(item).toBeDefined();
    expect(item?.scope.accountId).toBe('ch:main');
  });

  it('duplicate-candidate : une quantité franchement différente n’est pas un doublon', () => {
    const a = buyEvent({ accountId: 'ch:main' });
    const b = buyEvent({ accountId: 'man:default', in: { asset: 'btc', qty: '2' } });
    const ctx = baseCtx({ events: [a, b] });
    expect(find(buildReconciliation(ctx), 'duplicate-candidate')).toBeUndefined();
  });

  it('duplicate-candidate : un doublon déjà tranché par l’utilisateur n’est plus listé', () => {
    const a = buyEvent({ accountId: 'ch:main' });
    const b = buyEvent({ accountId: 'man:default', source: 'manual' });
    const overridden = duplicatePairKey(a.id, b.id);
    const ctx = baseCtx({
      events: [a, b],
      duplicateOverrides: { [overridden]: 'dismissed' },
    });
    expect(find(buildReconciliation(ctx), 'duplicate-candidate')).toBeUndefined();
  });

  // --- ordre et résumé -----------------------------------------------------------------------------
  it('ordre déterministe : priorité décroissante, égalité départagée par id', () => {
    const ctx = baseCtx({
      report: baseReport({
        unqualified: [unqualifiedEvent()],
        totals: { ...EMPTY_TOTALS, unpricedAssets: ['eth'] },
      }),
      declarations: baseDeclarations({
        accounts: [
          {
            accountId: 'csv:x',
            label: 'X',
            status: 'unknown',
            country: null,
            usedInYear: false,
            currentlyHolds: false,
            possiblyClosedInYear: false,
          },
        ],
      }),
    });
    const items = buildReconciliation(ctx).items;
    for (let i = 1; i < items.length; i++) {
      const prev = items[i - 1]!;
      const cur = items[i]!;
      expect(prev.priority >= cur.priority).toBe(true);
      if (prev.priority === cur.priority) expect(prev.id <= cur.id).toBe(true);
    }
    // La qualité des données (fail) est bien devant l'information pure.
    expect(items[0]?.severity).toBe('fail');
    expect(items[items.length - 1]?.severity).toBe('info');
  });

  it('summarizeReconciliation : compte par sévérité et retient la pire', () => {
    const ctx = baseCtx({
      report: baseReport({ unqualified: [unqualifiedEvent()] }),
      declarations: baseDeclarations({
        accounts: [
          {
            accountId: 'csv:x',
            label: 'X',
            status: 'unknown',
            country: null,
            usedInYear: false,
            currentlyHolds: false,
            possiblyClosedInYear: false,
          },
        ],
      }),
    });
    const summary = summarizeReconciliation(buildReconciliation(ctx));
    expect(summary).toEqual({ fail: 1, warn: 0, info: 1, worst: 'fail' });
  });

  it('summarizeReconciliation : worst null sur un rapport vide', () => {
    expect(summarizeReconciliation(buildReconciliation(baseCtx()))).toEqual({
      fail: 0,
      warn: 0,
      info: 0,
      worst: null,
    });
  });
});
