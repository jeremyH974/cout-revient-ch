/**
 * Pertes CONNUES de l'aller-retour Koinly (P72, docs/backup-format.md § « ce qui ne survit pas »),
 * FIGÉES plutôt que réparées (hors périmètre de ce chantier) : deux cas écrits à la main, dont
 * l'écart exact est calculé ci-dessous et vérifié par le test — pas laissé dériver en silence dans
 * un sens comme dans l'autre. Corriger ces pertes (par exemple relire `Net Worth` pour un solde
 * d'ouverture, ou réémettre une vraie `migration`) est un chantier séparé ; ce test doit alors
 * échouer et être mis à jour en connaissance de cause, jamais élargi en douce.
 */
import { describe, expect, it } from 'vitest';
import { computePortfolio } from '../../src/lib/domain/engine/aggregate';
import type { PortfolioReport, PriceQuoteInput } from '../../src/lib/domain/engine/report';
import {
  DEFAULT_ENGINE_SETTINGS,
  type LedgerEvent,
  type MigrationEvent,
  type OpeningBalanceEvent,
  type TradeEvent,
} from '../../src/lib/domain/types';
import { eventsToKoinlyCsv } from '../../src/lib/export/koinly-csv';
import { parseCsvText } from '../../src/lib/import/csv';
import { detectPivotFormat } from '../../src/lib/import/pivot/detect';
import { ingestPivotRows } from '../../src/lib/import/pivot/index';
import { pivotLedgerEvents, type UsdRate } from '../../src/lib/import/pivot/events';
import { parsePivotRows } from '../../src/lib/import/pivot/rows';

const usdRateOne: UsdRate = () => '1';
const REIMPORT_ACCOUNT = 'csv:a';

/** Même pipeline que la propriété d'aller-retour : export Koinly Universal, puis réimport pivot. */
function reimport(events: LedgerEvent[]): LedgerEvent[] {
  const { csv } = eventsToKoinlyCsv(events);
  const table = parseCsvText(csv);
  const detection = detectPivotFormat(table.header);
  if (!detection.ok) throw new Error('détection du format Koinly Universal attendue');
  const parsed = parsePivotRows(table, detection.columns, 'gap-test', REIMPORT_ACCOUNT);
  const ingested = ingestPivotRows(
    parsed,
    {
      format: detection.format,
      header: table.header,
      unknownColumns: detection.unknownColumns,
      totalRows: table.rows.length,
    },
    {},
    REIMPORT_ACCOUNT,
    usdRateOne,
  );
  if (!ingested.ok) throw new Error(ingested.error);
  return pivotLedgerEvents(Object.values(ingested.rows), {}, usdRateOne).events;
}

const price = (asset: string, priceEur: string): PriceQuoteInput => ({
  asset,
  priceEur,
  at: '2026-02-01T00:00:00Z',
  source: 'test',
  stale: false,
});
const run = (events: LedgerEvent[], prices: Record<string, PriceQuoteInput>): PortfolioReport =>
  computePortfolio({ events, prices, settings: DEFAULT_ENGINE_SETTINGS });

const base = {
  id: 'e1',
  source: 'manual' as const,
  scope: 'coinhouse' as const,
  accountId: 'ch:main',
  rowKeys: [],
  warnings: [],
};

describe('pertes connues de l’aller-retour Koinly (figées, pas réparées)', () => {
  it('une migration part en échange « swap » et se relit comme une VENTE RÉALISÉE (le sens change)', () => {
    // 10 unités de « oldcoin » achetées 1000 € (PRU 100), puis migrées vers 5 « newcoin » à une
    // juste valeur de 1500 € — sous le mode par défaut (coût reporté, décision n° 8), aucun gain
    // n'est constaté : le coût de 1000 € voyage tel quel vers newcoin.
    const buy: TradeEvent = {
      ...base,
      id: 'buy',
      at: '2026-01-01T10:00:00',
      kind: 'trade',
      out: { asset: 'eur', qty: '1000' },
      in: { asset: 'oldcoin', qty: '10' },
      valueEur: '1000',
      valueEurSource: 'manual',
      fee: null,
      quotePrice: null,
    };
    const migration: MigrationEvent = {
      ...base,
      id: 'mig',
      at: '2026-01-02T10:00:00',
      kind: 'migration',
      out: { asset: 'oldcoin', qty: '10' },
      in: { asset: 'newcoin', qty: '5' },
      fairValueOutEur: '1500',
      fairValueInEur: null,
    };
    const prices = { oldcoin: price('oldcoin', '1'), newcoin: price('newcoin', '1') };

    const before = run([buy, migration], prices);
    const oldBefore = before.closed.find((p) => p.asset === 'oldcoin');
    const newBefore = before.positions.find((p) => p.asset === 'newcoin');
    expect(oldBefore?.realized.toString(), 'coût reporté : aucun gain constaté sur oldcoin').toBe(
      '0',
    );
    expect(newBefore?.costBasis.toString(), 'le coût de 1000 € a voyagé tel quel').toBe('1000');
    expect(newBefore?.pru?.toString()).toBe('200');

    const reimported = reimport([buy, migration]);
    expect(
      reimported.some((e) => e.kind === 'migration'),
      'plus aucune « migration » après l’aller-retour : le sens a changé',
    ).toBe(false);
    const after = run(reimported, prices);
    const oldAfter = after.closed.find((p) => p.asset === 'oldcoin');
    const newAfter = after.positions.find((p) => p.asset === 'newcoin');
    // Figé : un gain de 500 € apparaît sur oldcoin (1500 € de « Net Worth » − 1000 € de coût) là où
    // le report de coût n'en réalisait aucun — et newcoin repart d'un coût de 1500 €, pas 1000 €.
    expect(oldAfter?.realized.toString(), 'un gain fantôme de 500 € apparaît').toBe('500');
    expect(newAfter?.costBasis.toString(), 'le coût réel (1000 €) ne survit pas').toBe('1500');
    expect(newAfter?.pru?.toString()).toBe('300');
  });

  it('le coût d’un solde d’ouverture crypto (non cash) redevient null — 0 € retenu par le moteur', () => {
    // 3 unités de « oldbal » à 900 € (PRU 300), un solde d'ouverture antérieur à l'export.
    const opening: OpeningBalanceEvent = {
      ...base,
      id: 'open',
      at: '2026-01-01T10:00:00',
      kind: 'opening-balance',
      in: { asset: 'oldbal', qty: '3' },
      costEur: '900',
    };
    const prices = { oldbal: price('oldbal', '1') };

    const before = run([opening], prices);
    const posBefore = before.positions.find((p) => p.asset === 'oldbal');
    expect(posBefore?.costBasis.toString()).toBe('900');
    expect(posBefore?.pru?.toString()).toBe('300');

    const reimported = reimport([opening]);
    expect(reimported).toHaveLength(1);
    const [reimportedEvent] = reimported;
    expect(reimportedEvent?.kind, 'un solde d’ouverture se relit comme un simple dépôt').toBe(
      'deposit',
    );
    if (reimportedEvent?.kind === 'deposit')
      expect(
        reimportedEvent.costEur,
        '« Net Worth » est écrit dans le CSV mais jamais relu ici',
      ).toBeNull();

    const after = run(reimported, prices);
    const posAfter = after.positions.find((p) => p.asset === 'oldbal');
    // Figé : le coût (900 €) ne survit pas, il redevient 0 — la quantité, elle, reste exacte.
    expect(posAfter?.qty.toString()).toBe('3');
    expect(posAfter?.costBasis.toString(), 'le coût de 900 € ne survit pas').toBe('0');
    expect(posAfter?.pru?.toString()).toBe('0');
  });
});
