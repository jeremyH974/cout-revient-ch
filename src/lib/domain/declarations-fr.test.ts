import { describe, expect, it } from 'vitest';
import { computeDeclarations, concernedDeclarations } from './declarations-fr';
import type { Account, DepositEvent, LedgerEvent, TradeEvent, WithdrawalEvent } from './types';

let seq = 0;
const base = (accountId: string) => ({
  id: `e${++seq}`,
  source: 'manual' as const,
  scope: 'coinhouse' as const,
  accountId,
  rowKeys: [],
  warnings: [],
});

const account = (over: Partial<Account> & Pick<Account, 'id' | 'kind'>): Account => ({
  label: over.id,
  space: 'invest',
  createdAt: '2026-01-01T00:00:00Z',
  ...over,
});

const deposit = (accountId: string, at: string, asset: string, qty: string): DepositEvent => ({
  ...base(accountId),
  kind: 'deposit',
  at,
  in: { asset, qty },
  costEur: null,
});

const withdrawal = (
  accountId: string,
  at: string,
  asset: string,
  qty: string,
): WithdrawalEvent => ({
  ...base(accountId),
  kind: 'withdrawal',
  at,
  out: { asset, qty },
  proceedsEur: null,
});

const trade = (accountId: string, at: string, out: string, into: string): TradeEvent => ({
  ...base(accountId),
  kind: 'trade',
  at,
  out: { asset: out, qty: '1' },
  in: { asset: into, qty: '1' },
  valueEur: '100',
  valueEurSource: 'manual',
  fee: null,
  quotePrice: null,
});

describe('computeDeclarations — statut légal d’un compte (art. 1649 bis C du CGI)', () => {
  it('Coinhouse est hors périmètre : PSCA français, quel que soit son activité', () => {
    const a = account({ id: 'ch:main', kind: 'coinhouse' });
    const events: LedgerEvent[] = [deposit('ch:main', '2026-03-01T10:00:00', 'btc', '5')];
    const report = computeDeclarations({ accounts: [a], events, year: 2026 });
    expect(report.accounts[0]?.status).toBe('excluded-domestic');
    expect(report.includedCount).toBe(0);
  });

  it('un compte au pays FR explicite est hors périmètre, comme Coinhouse', () => {
    const a = account({ id: 'csv:fr', kind: 'csv', country: 'FR' });
    const report = computeDeclarations({ accounts: [a], events: [], year: 2026 });
    expect(report.accounts[0]?.status).toBe('excluded-domestic');
  });

  it('un compte CSV étranger utilisé dans l’année est à déclarer, et le dit', () => {
    const a = account({ id: 'csv:nl', kind: 'csv', country: 'NL' });
    const events: LedgerEvent[] = [deposit('csv:nl', '2026-03-01T10:00:00', 'btc', '1')];
    const report = computeDeclarations({ accounts: [a], events, year: 2026 });
    const d = report.accounts[0]!;
    expect(d.status).toBe('included');
    expect(d.usedInYear).toBe(true);
    expect(d.country).toBe('NL');
    expect(report.includedCount).toBe(1);
  });

  it('on-chain et Hyperliquid restent incertains, jamais promus, même actifs', () => {
    const oc = account({ id: 'oc:btc-1', kind: 'onchain', chain: 'btc', address: 'bc1q…' });
    const hl = account({ id: 'hl:0xabc', kind: 'hyperliquid', address: '0xabc' });
    const events: LedgerEvent[] = [
      deposit('oc:btc-1', '2026-01-05T10:00:00', 'btc', '5'),
      trade('hl:0xabc', '2026-02-01T10:00:00', 'usdc', 'btc'),
    ];
    const report = computeDeclarations({ accounts: [oc, hl], events, year: 2026 });
    expect(report.accounts.map((d) => d.status)).toEqual([
      'uncertain-self-hosted',
      'uncertain-self-hosted',
    ]);
    expect(report.uncertainCount).toBe(2);
    expect(report.includedCount).toBe(0);
  });

  it('un compte manuel sans pays est signalé « inconnu », jamais deviné', () => {
    const a = account({ id: 'man:x', kind: 'manual' });
    const report = computeDeclarations({ accounts: [a], events: [], year: 2026 });
    expect(report.accounts[0]?.status).toBe('unknown');
    expect(report.accounts[0]?.country).toBeNull();
  });

  it('un compte étranger VIDE compte quand même dans includedCount (obligation sans seuil)', () => {
    const a = account({ id: 'csv:empty', kind: 'csv', country: 'AT' });
    const report = computeDeclarations({ accounts: [a], events: [], year: 2026 });
    const d = report.accounts[0]!;
    expect(d.status).toBe('included');
    expect(d.currentlyHolds).toBe(false);
    expect(d.usedInYear).toBe(false);
    expect(report.includedCount).toBe(1);
  });

  it('signale un compte peut-être clos dans l’année : détenu puis vidé avant son terme', () => {
    const a = account({ id: 'csv:closed', kind: 'csv', country: 'NL' });
    const events: LedgerEvent[] = [
      deposit('csv:closed', '2026-01-10T10:00:00', 'btc', '1'),
      withdrawal('csv:closed', '2026-06-10T10:00:00', 'btc', '1'),
    ];
    const report = computeDeclarations({ accounts: [a], events, year: 2026 });
    const d = report.accounts[0]!;
    expect(d.currentlyHolds).toBe(false);
    expect(d.possiblyClosedInYear).toBe(true);
  });

  it('ne signale pas de clôture pour un compte toujours détenu à la fin de l’année', () => {
    const a = account({ id: 'csv:held', kind: 'csv', country: 'NL' });
    const events: LedgerEvent[] = [deposit('csv:held', '2026-01-10T10:00:00', 'btc', '1')];
    const report = computeDeclarations({ accounts: [a], events, year: 2026 });
    const d = report.accounts[0]!;
    expect(d.currentlyHolds).toBe(true);
    expect(d.possiblyClosedInYear).toBe(false);
  });

  it('une réouverture APRÈS l’année visée ne change rien à l’année visée elle-même', () => {
    const a = account({ id: 'csv:reopened', kind: 'csv', country: 'NL' });
    const events: LedgerEvent[] = [
      deposit('csv:reopened', '2026-01-10T10:00:00', 'btc', '1'),
      withdrawal('csv:reopened', '2026-06-10T10:00:00', 'btc', '1'),
      deposit('csv:reopened', '2027-02-01T10:00:00', 'btc', '2'),
    ];
    const report2026 = computeDeclarations({ accounts: [a], events, year: 2026 });
    expect(report2026.accounts[0]?.possiblyClosedInYear).toBe(true);
    // « Maintenant » (grand livre entier) le compte est de nouveau approvisionné.
    expect(report2026.accounts[0]?.currentlyHolds).toBe(true);
  });

  it('concernedDeclarations écarte les comptes hors périmètre France', () => {
    const accounts = [
      account({ id: 'ch:main', kind: 'coinhouse' }),
      account({ id: 'csv:nl', kind: 'csv', country: 'NL' }),
    ];
    const report = computeDeclarations({ accounts, events: [], year: 2026 });
    expect(concernedDeclarations(report).map((d) => d.accountId)).toEqual(['csv:nl']);
  });
});
