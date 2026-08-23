import { describe, expect, it } from 'vitest';
import { computePortfolio } from '../domain/engine';
import { D } from '../domain/money';
import { DEFAULT_ENGINE_SETTINGS, type TradeEvent } from '../domain/types';
import { lotsToCsv, operationsToCsv, positionsToCsv, seriesToCsv } from './csv-export';

const base = (id: string) => ({
  id,
  source: 'manual' as const,
  scope: 'coinhouse' as const,
  rowKeys: [],
  warnings: [],
});
const buy = (id: string, at: string, asset: string, qty: string, eur: string): TradeEvent => ({
  ...base(id),
  kind: 'trade',
  at,
  out: { asset: 'eur', qty: eur },
  in: { asset, qty },
  valueEur: eur,
  valueEurSource: 'manual',
  fee: null,
  quotePrice: null,
});
const sell = (id: string, at: string, asset: string, qty: string, eur: string): TradeEvent => ({
  ...base(id),
  kind: 'trade',
  at,
  out: { asset, qty },
  in: { asset: 'eur', qty: eur },
  valueEur: eur,
  valueEurSource: 'manual',
  fee: null,
  quotePrice: null,
});

const report = computePortfolio({
  events: [
    buy('man:a', '2026-01-01T10:00:00', 'btc', '1', '100'),
    buy('man:b', '2026-01-02T10:00:00', 'btc', '1', '200'),
    sell('man:c', '2026-01-03T10:00:00', 'btc', '1', '300'),
  ],
  prices: {
    btc: {
      asset: 'btc',
      priceEur: '250',
      at: '2026-08-22T10:00:00Z',
      source: 'test',
      stale: false,
    },
  },
  settings: DEFAULT_ENGINE_SETTINGS,
});

const lines = (csv: string): string[] =>
  csv
    .replace(/^\uFEFF/, '')
    .trimEnd()
    .split('\r\n');

describe('exports CSV', () => {
  it('positions : BOM, point-virgule, virgule décimale, devise', () => {
    const csv = positionsToCsv(report, 'USD');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const [header, row] = lines(csv);
    expect(header).toContain('PRU ($)');
    expect(row).toBe('"BTC";"ok";1;150;150;250;250;100;66,67;150;250;83,33;0;0;0');
  });

  it('opérations : chronologiques avec PRU après chaque ligne', () => {
    const rows = lines(operationsToCsv(report, 'EUR'));
    expect(rows).toHaveLength(4);
    expect(rows[0]).toContain('PRU après (€)');
    expect(rows[1]).toMatch(
      /^01\/01\/2026;10:00;"BTC";"Achat";1;100;100;"EUR";;"";0;0;;100;1;"Manuel";"a";""$/,
    );
    expect(rows[3]).toMatch(
      /^03\/01\/2026;10:00;"BTC";"Vente";-1;300;300;"EUR";;"";0;0;150;150;1;"Manuel";"c";""$/,
    );
    expect(lines(operationsToCsv(report, 'EUR', 'eth'))).toHaveLength(1);
  });

  it('lots et série', () => {
    const lots = lines(lotsToCsv(report));
    expect(lots).toHaveLength(3);
    expect(lots[1]).toMatch(
      /^"BTC";01\/01\/2026 10:00;"purchase";"EUR";1;0,5;100;50;100;125;75;150$/,
    );
    const series = lines(
      seriesToCsv(
        [
          {
            day: '2026-01-03',
            value: D('250'),
            cost: D('150'),
            qty: D('1'),
            price: D('250'),
            estimated: false,
          },
        ],
        'EUR',
      ),
    );
    expect(series[0]).toMatch(/^Jour;/);
    expect(series[1]).toBe('03/01/2026;250;150;100;66,67;1;250;150');
  });

  it('série intraday : en-tête « Instant », horodatage ISO conservé, prix vide si estimé', () => {
    const rows = lines(
      seriesToCsv([
        {
          day: '2026-08-22T12:30:00.000Z',
          value: D('250'),
          cost: D('150'),
          qty: D('1'),
          price: D('250'),
          estimated: false,
        },
        {
          day: '2026-08-22T12:45:00.000Z',
          value: D('150'),
          cost: D('150'),
          qty: D('1'),
          price: null,
          estimated: true,
        },
      ]),
    );
    expect(rows[0]).toMatch(/^Instant;/);
    expect(rows[1]).toBe('"2026-08-22T12:30:00.000Z";250;150;100;66,67;1;250;150');
    expect(rows[2]).toBe('"2026-08-22T12:45:00.000Z";150;150;0;0;1;;150');
  });
});
