/**
 * Propriété d'aller-retour (P72, docs/backup-format.md) : événements → export Koinly Universal →
 * réimport pivot → moteur, comparé au même moteur sur les événements d'origine. L'arbitraire
 * (`Step` → `LedgerEvent[]`) est repris tel quel de
 * `src/lib/domain/engine/engine.property.test.ts` — copié plutôt qu'importé (ce fichier n'exporte
 * rien, et `src/lib/domain/` est hors périmètre de ce chantier) — et déjà restreint aux types qui
 * survivent à l'aller-retour : il ne génère QUE des `trade` (achat/vente en EUR ou USDC) et des
 * `reward`, jamais de `migration` ni de solde d'ouverture. Ces deux pertes connues sont hors de son
 * univers et figées séparément par `koinly-roundtrip-gaps.test.ts`.
 *
 * Piège documenté par le plan de ce chantier : une jambe USDC est reconvertie au réimport via
 * `usdRate` (taux BCE du jour), jamais relue depuis `Net Worth`. Pour que l'écart mesuré soit une
 * vraie perte et non un taux différent, le taux BCE simulé est fixé à 1 (1 USDC = 1 EUR), exactement
 * comme le fait déjà `engine.property.test.ts` pour construire ses achats/ventes en USDC.
 */
import fc from 'fast-check';
import Big from 'big.js';
import { describe, expect, it } from 'vitest';
import { D } from '../../src/lib/domain/money';
import { computePortfolio } from '../../src/lib/domain/engine/aggregate';
import type {
  PortfolioReport,
  PositionReport,
  PriceQuoteInput,
} from '../../src/lib/domain/engine/report';
import {
  DEFAULT_ENGINE_SETTINGS,
  type LedgerEvent,
  type RewardEvent,
  type TradeEvent,
} from '../../src/lib/domain/types';
import { eventsToKoinlyCsv } from '../../src/lib/export/koinly-csv';
import { parseCsvText } from '../../src/lib/import/csv';
import { detectPivotFormat } from '../../src/lib/import/pivot/detect';
import { ingestPivotRows } from '../../src/lib/import/pivot/index';
import { pivotLedgerEvents, type UsdRate } from '../../src/lib/import/pivot/events';
import { parsePivotRows } from '../../src/lib/import/pivot/rows';

// --- Arbitraire (copie fidèle de engine.property.test.ts, voir le commentaire d'en-tête) --------

type Crypto = 'a' | 'b';
type Step =
  | { kind: 'buy'; asset: Crypto; qty: number; cents: number; pay: 'eur' | 'usdc' }
  | { kind: 'sell'; asset: Crypto; pct: number; cents: number }
  | { kind: 'reward'; asset: Crypto; qty: number }
  | { kind: 'usdc'; cents: number };

const crypto = fc.constantFrom<Crypto>('a', 'b');
const stepArb: fc.Arbitrary<Step> = fc.oneof(
  fc.record({
    kind: fc.constant('buy' as const),
    asset: crypto,
    qty: fc.integer({ min: 1, max: 100_000 }),
    cents: fc.integer({ min: 1, max: 10_000_000 }),
    pay: fc.constantFrom<'eur' | 'usdc'>('eur', 'usdc'),
  }),
  fc.record({
    kind: fc.constant('sell' as const),
    asset: crypto,
    pct: fc.integer({ min: 1, max: 100 }),
    cents: fc.integer({ min: 1, max: 10_000_000 }),
  }),
  fc.record({
    kind: fc.constant('reward' as const),
    asset: crypto,
    qty: fc.integer({ min: 1, max: 1000 }),
  }),
  fc.record({
    kind: fc.constant('usdc' as const),
    cents: fc.integer({ min: 100, max: 10_000_000 }),
  }),
);
const priceArb = fc.integer({ min: 1, max: 100_000_000 });

const milli = (n: number): string => D(String(n)).div('1000').toString();
const euros = (cents: number): string => D(String(cents)).div('100').toString();
const at = (i: number): string =>
  `2026-01-${String(1 + Math.floor(i / 24)).padStart(2, '0')}T${String(i % 24).padStart(2, '0')}:00:00`;

let seq = 0;
const base = (i: number) => ({
  id: `p${++seq}`,
  at: at(i),
  source: 'manual' as const,
  scope: 'coinhouse' as const,
  accountId: 'ch:main' as const,
  rowKeys: [],
  warnings: [],
});
const trade = (
  i: number,
  out: { asset: string; qty: string },
  inn: { asset: string; qty: string },
  valueEur: string,
): TradeEvent => ({
  ...base(i),
  kind: 'trade',
  out,
  in: inn,
  valueEur,
  valueEurSource: 'manual',
  fee: null,
  quotePrice: null,
});
const reward = (i: number, asset: string, qty: string): RewardEvent => ({
  ...base(i),
  kind: 'reward',
  in: { asset, qty },
  fairValueEur: null,
});

/** Interprète les étapes en tenant les soldes : les ventes restent ≤ solde, l'USDC dépensé existe. */
function toEvents(steps: readonly Step[]): { events: LedgerEvent[] } {
  const holdings: Record<string, Big> = { a: D('0'), b: D('0'), usdc: D('0') };
  const events: LedgerEvent[] = [];
  steps.forEach((step, i) => {
    if (step.kind === 'usdc') {
      const amount = euros(step.cents);
      events.push(trade(i, { asset: 'eur', qty: amount }, { asset: 'usdc', qty: amount }, amount));
      holdings['usdc'] = holdings['usdc']!.plus(amount);
    } else if (step.kind === 'buy') {
      const cost = euros(step.cents);
      const qty = milli(step.qty);
      const pay = step.pay === 'usdc' && holdings['usdc']!.gte(cost) ? 'usdc' : 'eur';
      events.push(trade(i, { asset: pay, qty: cost }, { asset: step.asset, qty }, cost));
      holdings[step.asset] = holdings[step.asset]!.plus(qty);
      if (pay === 'usdc') holdings['usdc'] = holdings['usdc']!.minus(cost);
    } else if (step.kind === 'sell') {
      const held = holdings[step.asset]!;
      if (held.lte('0')) return;
      const qty = step.pct === 100 ? held : held.times(String(step.pct)).div('100');
      const proceeds = euros(step.cents);
      events.push(
        trade(
          i,
          { asset: step.asset, qty: qty.toString() },
          { asset: 'eur', qty: proceeds },
          proceeds,
        ),
      );
      holdings[step.asset] = held.minus(qty);
    } else {
      const qty = milli(step.qty);
      events.push(reward(i, step.asset, qty));
      holdings[step.asset] = holdings[step.asset]!.plus(qty);
    }
  });
  return { events };
}

// --- Moteur et aller-retour Koinly ---------------------------------------------------------------

const quote = (asset: string, cents: number): PriceQuoteInput => ({
  asset,
  priceEur: euros(cents),
  at: '2026-02-01T00:00:00Z',
  source: 'test',
  stale: false,
});
const run = (events: LedgerEvent[], pa: number, pb: number): PortfolioReport =>
  computePortfolio({
    events,
    prices: { a: quote('a', pa), b: quote('b', pb), usdc: quote('usdc', 92) },
    settings: DEFAULT_ENGINE_SETTINGS,
  });

/** 1 USDC = 1 EUR, comme le taux implicite de `toEvents` : voir le commentaire d'en-tête. */
const usdRateOne: UsdRate = () => '1';
const REIMPORT_ACCOUNT = 'csv:a';

/** Export Koinly Universal des événements, puis réimport pivot dans UN SEUL compte fixe. */
function reimport(events: LedgerEvent[]): LedgerEvent[] {
  const { csv, rows, skipped } = eventsToKoinlyCsv(events);
  expect(skipped).toBe(0);
  // Une séquence d'étapes entièrement « sautée » (ex. une seule vente sans rien détenu, voir
  // `toEvents`) produit zéro événement : le CSV n'a alors que son en-tête, et `ingestPivotRows`
  // refuse à bon droit un fichier sans ligne exploitable. La propriété reste vraie (rien à
  // transporter, rien ne devrait changer) ; court-circuiter évite un plantage du harnais de test
  // plutôt que du code produit — trouvé par le fuzzer dès le premier tirage.
  if (rows === 0) return [];
  const table = parseCsvText(csv);
  const detection = detectPivotFormat(table.header);
  if (!detection.ok) throw new Error('détection du format Koinly Universal attendue');
  expect(detection.format).toBe('koinly-universal');
  const parsed = parsePivotRows(table, detection.columns, 'roundtrip', REIMPORT_ACCOUNT);
  expect(parsed.issues).toEqual([]);
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
  const { events: reimported } = pivotLedgerEvents(Object.values(ingested.rows), {}, usdRateOne);
  expect(reimported.every((e) => e.kind !== 'unqualified')).toBe(true);
  return reimported;
}

// --- Comparaison par actif, tolérance 1e-9 (celle de l'oracle indépendant) -----------------------

const EPS = new Big('0.000000001');
const close = (x: Big | null, y: Big | null): boolean =>
  x === null || y === null ? x === y : x.minus(y).abs().lte(EPS);
const positionsOf = (r: PortfolioReport): PositionReport[] => [
  ...r.positions,
  ...r.stablecoins,
  ...r.closed,
];
const byAsset = (r: PortfolioReport): Map<string, PositionReport> =>
  new Map(positionsOf(r).map((p) => [p.asset, p]));

function expectSamePortfolio(before: PortfolioReport, after: PortfolioReport): void {
  expect(before.blocked, 'aucune survente possible par construction').toEqual([]);
  expect(after.blocked).toEqual([]);
  const b = byAsset(before);
  const a = byAsset(after);
  expect(new Set(a.keys()), 'mêmes actifs des deux côtés').toEqual(new Set(b.keys()));
  for (const [asset, pb] of b) {
    const pa = a.get(asset)!;
    expect(close(pa.qty, pb.qty), `${asset} : quantité`).toBe(true);
    expect(close(pa.pru, pb.pru), `${asset} : PRU`).toBe(true);
    expect(close(pa.costBasis, pb.costBasis), `${asset} : coût`).toBe(true);
    expect(close(pa.value, pb.value), `${asset} : valeur`).toBe(true);
    expect(close(pa.realized, pb.realized), `${asset} : réalisé`).toBe(true);
    expect(close(pa.total, pb.total), `${asset} : total`).toBe(true);
  }
  expect(close(after.totals.total, before.totals.total), 'total du portefeuille').toBe(true);
}

describe('aller-retour Koinly — ce qui survit (achats/ventes/récompenses EUR + USDC)', () => {
  it('quantité, PRU, coût, valeur, réalisé et total identiques après export puis réimport, par actif', () => {
    fc.assert(
      fc.property(
        fc.array(stepArb, { minLength: 1, maxLength: 30 }),
        priceArb,
        priceArb,
        (steps, pa, pb) => {
          const { events } = toEvents(steps);
          const before = run(events, pa, pb);
          const after = run(reimport(events), pa, pb);
          expectSamePortfolio(before, after);
        },
      ),
      { numRuns: 150 },
    );
  });
});
