import { describe, expect, it } from 'vitest';
import { accountDeclarationsToCsv, cessionsToCsv } from './csv-export';
import { computeDeclarations } from '../domain/declarations-fr';
import { computeFrenchTax } from '../domain/tax-fr';
import { computePortfolio } from '../domain/engine';
import { D } from '../domain/money';
import {
  DEFAULT_ENGINE_SETTINGS,
  type Account,
  type LedgerEvent,
  type TradeEvent,
} from '../domain/types';
import { lotsToCsv, operationsToCsv, positionsToCsv, seriesToCsv } from './csv-export';

const base = (id: string) => ({
  id,
  source: 'manual' as const,
  scope: 'coinhouse' as const,
  accountId: 'ch:main' as const,
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
      /^01\/01\/2026;10:00;"BTC";"Achat";1;100;100;"EUR";;"";0;0;;100;1;"Manuel";"Coinhouse";"a";""$/,
    );
    expect(rows[3]).toMatch(
      /^03\/01\/2026;10:00;"BTC";"Vente";-1;300;300;"EUR";;"";0;0;150;150;1;"Manuel";"Coinhouse";"c";""$/,
    );
    expect(lines(operationsToCsv(report, 'EUR', 'eth'))).toHaveLength(1);
  });

  it('« Compte » : en-tête juste après « Source », étiquette fournie ou identifiant brut à défaut', () => {
    const header = lines(operationsToCsv(report, 'EUR'))[0]!;
    expect(header).toContain('Source;Compte');

    const acctReport = computePortfolio({
      events: [{ ...buy('man:z', '2026-01-05T10:00:00', 'btc', '1', '100'), accountId: 'man:x1' }],
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
    const withLabel = lines(operationsToCsv(acctReport, 'EUR', undefined, { 'man:x1': 'Ledger' }));
    expect(withLabel[1]).toContain('"Ledger"');
    const withoutLabel = lines(operationsToCsv(acctReport, 'EUR'));
    expect(withoutLabel[1]).toContain('"man:x1"');
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

describe('cessionsToCsv — colonnes du formulaire 2086', () => {
  const events: LedgerEvent[] = [
    {
      id: 'e1',
      at: '2026-01-01T10:00:00',
      source: 'manual',
      scope: 'coinhouse',
      accountId: 'ch:main',
      rowKeys: [],
      warnings: [],
      kind: 'trade',
      out: { asset: 'eur', qty: '10000' },
      in: { asset: 'btc', qty: '1' },
      valueEur: '10000',
      valueEurSource: 'manual',
      fee: null,
      quotePrice: null,
    },
    {
      id: 'e2',
      at: '2026-06-01T10:00:00',
      source: 'manual',
      scope: 'coinhouse',
      accountId: 'ch:main',
      rowKeys: [],
      warnings: [],
      kind: 'trade',
      out: { asset: 'btc', qty: '0.5' },
      in: { asset: 'eur', qty: '5000' },
      valueEur: '5000',
      valueEurSource: 'manual',
      fee: null,
      quotePrice: null,
    },
  ];

  it('rend une ligne par cession, dans l’ordre des colonnes du formulaire', () => {
    const ledger = computeFrenchTax({
      events,
      closingValueAt: (day) => (day === '2026-06-01' ? D('15000') : null),
    });
    const lines = cessionsToCsv(ledger).trimEnd().split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('Valeur globale du portefeuille');
    expect(lines[0]).toContain("Prix total d'acquisition");
    const cells = lines[1]!.split(';');
    expect(cells[0]).toBe('"01/06/2026"');
    expect(cells[1]).toBe('5000');
    // Valeur globale reconstituée : clôture 15 000 + 5 000 encaissés.
    expect(cells[2]).toBe('20000');
    expect(cells[3]).toBe('10000');
    expect(cells[5]).toBe('2500');
    expect(cells[6]).toBe('"oui"');
  });

  it('dit ligne par ligne ce qui n’a pas pu être chiffré, au lieu d’inventer', () => {
    const blind = computeFrenchTax({ events });
    const cells = cessionsToCsv(blind).trimEnd().split('\r\n')[1]!.split(';');
    expect(cells[2]).toBe('"inconnue"');
    expect(cells[5]).toBe('"—"');
    expect(cells[6]).toContain('non');
  });

  it('peut se limiter à un millésime', () => {
    const ledger = computeFrenchTax({ events, closingValueAt: () => D('15000') });
    expect(cessionsToCsv(ledger, 2025).trimEnd().split('\r\n')).toHaveLength(1);
    expect(cessionsToCsv(ledger, 2026).trimEnd().split('\r\n')).toHaveLength(2);
  });
});

describe('accountDeclarationsToCsv — comptes à déclarer (formulaire 3916-bis, P66)', () => {
  const acc = (id: string, kind: Account['kind'], country?: string): Account => ({
    id,
    kind,
    label: id,
    space: 'invest',
    createdAt: '2026-01-01T00:00:00Z',
    ...(country === undefined ? {} : { country }),
  });

  it('ne liste que les comptes concernés : Coinhouse et le pays FR sont écartés', () => {
    const declarations = computeDeclarations({
      accounts: [
        acc('ch:main', 'coinhouse'),
        acc('csv:fr', 'csv', 'FR'),
        acc('csv:nl', 'csv', 'NL'),
      ],
      events: [],
      year: 2026,
    });
    const lines = accountDeclarationsToCsv(declarations).trimEnd().split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('Statut');
    expect(lines[1]).toContain('"csv:nl"');
    expect(lines[1]).toContain('Pays-Bas');
  });

  it('dit « inconnu » plutôt que d’inventer un pays', () => {
    const declarations = computeDeclarations({
      accounts: [acc('man:x', 'manual')],
      events: [],
      year: 2026,
    });
    const cells = accountDeclarationsToCsv(declarations).trimEnd().split('\r\n')[1]!.split(';');
    expect(cells[2]).toBe('"inconnu"');
  });

  it('un compte étranger vide reste dans l’export, marqué « non » utilisé et « non » détenu', () => {
    const declarations = computeDeclarations({
      accounts: [acc('csv:empty', 'csv', 'AT')],
      events: [],
      year: 2026,
    });
    const cells = accountDeclarationsToCsv(declarations).trimEnd().split('\r\n')[1]!.split(';');
    expect(cells[3]).toBe('"non"');
    expect(cells[4]).toBe('"non"');
  });
});
