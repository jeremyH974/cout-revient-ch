/** Export Koinly Universal : dates UTC, point décimal, labels, aller-retour avec l'import pivot. */
import { describe, expect, it } from 'vitest';
import type { RewardEvent, TradeEvent, WithdrawalEvent } from '../domain/types';
import { detectPivotFormat } from '../import/pivot/detect';
import { parseCsvText } from '../import/csv';
import { eventsToKoinlyCsv, KOINLY_HEADER } from './koinly-csv';

const base = {
  id: 'ch:1',
  source: 'coinhouse-csv' as const,
  scope: 'coinhouse' as const,
  accountId: 'ch:main',
  rowKeys: [],
  warnings: [],
};
const trade: TradeEvent = {
  ...base,
  kind: 'trade',
  at: '2026-01-05T11:00:00',
  out: { asset: 'eur', qty: '1000' },
  in: { asset: 'btc', qty: '0.02' },
  valueEur: '1000',
  valueEurSource: 'counter-leg',
  fee: { asset: 'eur', gross: '2.5', rebate: '0', grossEur: '2.5', rebateEur: '0' },
  quotePrice: null,
};
const swap: TradeEvent = {
  ...trade,
  id: 'ch:2',
  at: '2026-07-10T14:30:00',
  out: { asset: 'btc', qty: '0.01' },
  in: { asset: 'eth', qty: '0.4' },
  valueEur: '450',
  fee: null,
};
const reward: RewardEvent = {
  ...base,
  id: 'ch:3',
  kind: 'reward',
  at: '2026-02-01T09:00:00',
  in: { asset: 'sol', qty: '0.5' },
  fairValueEur: '60',
};
const withdrawal: WithdrawalEvent = {
  ...base,
  id: 'ch:4',
  kind: 'withdrawal',
  at: '2026-03-01T10:00:00',
  out: { asset: 'btc', qty: '0.005' },
  proceedsEur: null,
  transferTo: 'pv:x',
};

describe('eventsToKoinlyCsv', () => {
  it('écrit l’en-tête Universal, des dates UTC et les labels attendus', () => {
    const { csv, rows, skipped } = eventsToKoinlyCsv([trade, swap, reward, withdrawal]);
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe(KOINLY_HEADER.join(','));
    expect(rows).toBe(4);
    expect(skipped).toBe(0);
    // Paris hiver 11:00 → UTC 10:00 ; Paris été 14:30 → UTC 12:30.
    expect(lines[1]).toBe('2026-01-05 10:00:00,1000,EUR,0.02,BTC,2.5,EUR,1000,EUR,,,ch:1');
    expect(lines[2]).toContain('2026-02-01 08:00:00');
    expect(lines[3]).toBe('2026-03-01 09:00:00,0.005,BTC,,,,,,,,Virement interne (apparié),ch:4');
    expect(lines[4]).toBe('2026-07-10 12:30:00,0.01,BTC,0.4,ETH,,,450,EUR,swap,,ch:2');
  });

  it('produit un fichier que notre propre import pivot reconnaît (aller-retour)', () => {
    const { csv } = eventsToKoinlyCsv([trade, swap]);
    const detection = detectPivotFormat(parseCsvText(csv).header);
    expect(detection.ok && detection.format).toBe('koinly-universal');
  });

  it('laisse de côté les lignes à qualifier et les compte', () => {
    const { rows, skipped } = eventsToKoinlyCsv([
      trade,
      {
        ...base,
        id: 'ch:9',
        kind: 'unqualified',
        at: '2026-01-06T09:00:00',
        rawType: 'mystère',
        legs: [],
        reason: 'test',
      },
    ]);
    expect(rows).toBe(1);
    expect(skipped).toBe(1);
  });
});
