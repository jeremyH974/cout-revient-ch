import { describe, expect, it } from 'vitest';
import { computePortfolio } from '../domain/engine/aggregate';
import { DEFAULT_ENGINE_SETTINGS, type TradeEvent } from '../domain/types';
import { positionsToCsv } from './csv-export';

const buy = (id: string, asset: string, qty: string, eur: string): TradeEvent => ({
  id,
  at: '2026-01-01T10:00:00',
  source: 'manual',
  scope: 'coinhouse',
  accountId: 'ch:main',
  rowKeys: [],
  warnings: [],
  kind: 'trade',
  out: { asset: 'eur', qty: eur },
  in: { asset, qty },
  valueEur: eur,
  valueEurSource: 'manual',
  fee: null,
  quotePrice: null,
});

describe('CSV : arrondis identiques à l’écran', () => {
  const csv = positionsToCsv(
    computePortfolio({
      events: [
        buy('a', 'aaa', '1', '12.345'),
        buy('b', 'bbb', '7.999999667', '10'),
        buy('c', 'pepe', '1000000', '3.886'),
      ],
      prices: {},
      settings: DEFAULT_ENGINE_SETTINGS,
    }),
    'EUR',
  );
  const line = (asset: string): string[] =>
    csv
      .split('\r\n')
      .find((l) => l.startsWith(`"${asset.toUpperCase()}"`))!
      .split(';');

  it('montants arrondis au plus proche, demi vers le haut (12,345 → 12,35)', () => {
    expect(line('aaa')).toContain('12,35');
    expect(line('aaa')).not.toContain('12,34');
  });

  it('quantités à 9 décimales, jamais tronquées', () => {
    expect(line('bbb')).toContain('7,999999667');
  });

  it('PRU sous le millionième conservé (PEPE)', () => {
    expect(line('pepe')).toContain('0,000003886');
  });
});
