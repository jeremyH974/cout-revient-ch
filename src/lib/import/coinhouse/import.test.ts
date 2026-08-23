import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COINHOUSE_HEADER_2026_08 } from './detect';
import { importCoinhouseCsv } from './index';
import { normalizeCoinhouseRows } from './normalize';

const FIXTURE = 'tests/fixtures/coinhouse/export-demo.csv';
const REAL = 'historique des transactions (4).csv';
const H = COINHOUSE_HEADER_2026_08.join(',');

const csv = (...lines: string[]): string => [H, ...lines].join('\n') + '\n';
const buyEur = (
  id: string,
  at: string,
  asset: string,
  qty: string,
  price: string,
  eur: string,
  fee: string,
) => [
  `${id},${at},Echange,${qty},${asset},${price},${eur},,,,${qty},Portefeuille`,
  `${id},${at},Echange,-${eur},eur,1,-${eur},${fee},${fee},0.0,,""`,
];

interface ExpectedCounts {
  rows: number;
  trades: number;
  assets: number;
}

function expectFullExport(text: string, expected: ExpectedCounts): void {
  const result = importCoinhouseCsv(text, {}, 'imp:test');
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.report.format).toBe('coinhouse-2026-08');
  expect(result.report.header).toEqual([...COINHOUSE_HEADER_2026_08]);
  expect(result.report.unknownColumns).toEqual([]);
  expect(result.report.parsedRows).toBe(expected.rows);
  expect(result.report.issues).toEqual([]);
  expect(result.report.counts).toEqual({
    trades: expected.trades,
    migrations: 1,
    fees: 2,
    unqualified: 0,
    orphanLegs: 0,
  });
  expect(result.report.assets).toHaveLength(expected.assets);
  // Ré-import du même fichier : rien de nouveau.
  const again = importCoinhouseCsv(text, result.rows, 'imp:again');
  expect(again.ok && again.report.newRows).toBe(0);
  expect(again.ok && again.report.duplicateRows).toBe(expected.rows);
}

describe('import Coinhouse — jeu de démonstration synthétique', () => {
  it('lit 205 lignes : 100 échanges, 1 migration, 2 abonnements, 0 à qualifier', () => {
    expectFullExport(readFileSync(FIXTURE, 'utf8'), { rows: 205, trades: 100, assets: 22 });
  });

  it('valorise un achat payé en USDC avec la contre-valeur EUR de la jambe USDC', () => {
    const result = importCoinhouseCsv(readFileSync(FIXTURE, 'utf8'), {}, 'imp');
    if (!result.ok) throw new Error(result.error);
    const rows = Object.values(result.rows);
    const { events } = normalizeCoinhouseRows(rows);
    const sol = events.find((e) => e.kind === 'trade' && e.in.asset === 'sol');
    expect(sol?.kind).toBe('trade');
    if (sol?.kind !== 'trade') return;
    expect(sol.out.asset).toBe('usdc');
    // Valeur EUR = |Contre-valeur (EUR)| de la jambe USDC, jamais celle de la jambe SOL (en USDC).
    const legs = rows.filter((r) => r.id === sol.id.replace('ch:', ''));
    const usdcLeg = legs.find((r) => r.asset === 'usdc')!;
    const solLeg = legs.find((r) => r.asset === 'sol')!;
    expect(sol.valueEur).toBe(usdcLeg.valueEur!.replace('-', ''));
    expect(sol.valueEur).not.toBe(solLeg.valueEur!.replace('-', ''));
    expect(sol.quotePrice).toEqual({ asset: 'usdc', price: solLeg.marketPrice });
    expect(sol.fee?.asset).toBe('usdc');
    expect(Number(sol.fee?.gross)).toBeGreaterThan(0);
    expect(sol.warnings).toEqual([]);
  });
});

describe('import Coinhouse — export réel (local, ignoré par git)', () => {
  it.skipIf(!existsSync(REAL))('donne les mêmes garanties que la fixture', () => {
    expectFullExport(readFileSync(REAL, 'utf8'), { rows: 201, trades: 98, assets: 28 });
  });
});

describe('import Coinhouse — cas limites', () => {
  it('tolère BOM, CRLF, ordre chronologique inversé et guillemets', () => {
    const text =
      '﻿' +
      csv(
        ...buyEur('aaaa0001', '01/02/2026 10:00:00', 'btc', '0.01', '50000', '500.0', '4.5'),
      ).replace(/\n/g, '\r\n');
    const result = importCoinhouseCsv(text, {}, 'imp');
    expect(result.ok && result.report.counts.trades).toBe(1);
    expect(result.ok && result.report.warnings).toEqual([]);
  });

  it('refuse un fichier sans les colonnes attendues', () => {
    const result = importCoinhouseCsv('Date,Montant\n01/01/2026,12\n', {}, 'imp');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.details[0]).toMatch(/Colonnes manquantes/);
  });

  it('signale un fichier ré-enregistré par un tableur', () => {
    const text = [
      H.replace(/,/g, ';'),
      'aaaa0001;01/02/2026 10:00;Echange;0,01;btc;50000;500,0;;;;0,01;Portefeuille',
    ].join('\n');
    const result = importCoinhouseCsv(text, {}, 'imp');
    expect(result.ok && result.report.warnings.join(' ')).toMatch(/tableur/);
  });

  it('isole une jambe orpheline et un type inconnu', () => {
    const text = csv(
      'bbbb0002,01/02/2026 10:00:00,Echange,0.5,eth,2000,1000.0,,,,0.5,Portefeuille',
      'cccc0003,02/02/2026 10:00:00,Cadeau,10.0,sol,80,800.0,,,,10.0,Portefeuille',
    );
    const result = importCoinhouseCsv(text, {}, 'imp');
    expect(result.ok && result.report.counts).toEqual({
      trades: 0,
      migrations: 0,
      fees: 0,
      unqualified: 2,
      orphanLegs: 1,
    });
    if (!result.ok) return;
    const { events } = normalizeCoinhouseRows(Object.values(result.rows), {
      'ch:cccc0003': { kind: 'reward', fairValueEur: null },
    });
    expect(events.map((e) => e.kind).sort()).toEqual(['reward', 'unqualified']);
  });

  it('apparie delisting et migration, ignore un abonnement à 0', () => {
    const text = csv(
      ...buyEur('dddd0004', '01/01/2026 09:00:00', 'mkr', '1.0', '1700', '1710.0', '10.0'),
      '7202524,22/09/2026 14:22:51,Echange Delisting,-1.0,mkr,1489.18,-1489.1807,0.0,0.0,0.0,0.0,Portefeuille',
      '7235641,22/09/2026 23:02:42,Migration,24000.0,sky,0.06,1356.47504,0.0,0.0,0.0,24000.0,Portefeuille',
      ',11/03/2026 17:46:16,Abonnement,0.0,eur,,0.0,,,,,""',
      ',14/03/2026 15:25:49,Abonnement,629.0,eur,,629.0,,,,,""',
    );
    const result = importCoinhouseCsv(text, {}, 'imp');
    expect(result.ok && result.report.counts).toEqual({
      trades: 1,
      migrations: 1,
      fees: 1,
      unqualified: 0,
      orphanLegs: 0,
    });
    if (!result.ok) return;
    const { events } = normalizeCoinhouseRows(Object.values(result.rows));
    const migration = events.find((e) => e.kind === 'migration');
    expect(migration?.kind === 'migration' && migration.in).toEqual({ asset: 'sky', qty: '24000' });
  });

  it('conserve la première version en cas de conflit sur un même ID', () => {
    const first = csv(
      ...buyEur('eeee0005', '01/02/2026 10:00:00', 'btc', '0.01', '50000', '500.0', '4.5'),
    );
    const second = csv(
      ...buyEur('eeee0005', '01/02/2026 10:00:00', 'btc', '0.02', '50000', '1000.0', '9.0'),
    );
    const a = importCoinhouseCsv(first, {}, 'imp1');
    if (!a.ok) throw new Error(a.error);
    const b = importCoinhouseCsv(second, a.rows, 'imp2');
    expect(b.ok && b.report.conflictingRows).toBe(2);
    expect(b.ok && b.rows['ch:eeee0005:btc']?.qty).toBe('0.01');
  });
});
