/**
 * Comptes : `computePortfolioByAccount` rejoue le grand livre de chaque compte séparément (PRU et
 * réalisé de la plateforme), tandis que `computePortfolio` sur le même grand livre entier reste la
 * vue consolidée (PRU global, inchangée depuis la v1). Les deux ne se somment pas exactement après
 * une vente (docs/DECISIONS.md n° 20) : seule la quantité s'additionne toujours à l'identique.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { D, ZERO, toDecimalString, type Big } from '../money';
import { DEFAULT_ENGINE_SETTINGS, type LedgerEvent, type TradeEvent } from '../types';
import { computePortfolio, computePortfolioByAccount } from './aggregate';
import type { PriceQuoteInput } from './report';

let seq = 0;
const base = (accountId: string, scope: 'coinhouse' | 'external' = 'coinhouse') => ({
  id: `t${++seq}`,
  source: 'manual' as const,
  scope,
  accountId,
  rowKeys: [],
  warnings: [],
});
const buy = (
  accountId: string,
  at: string,
  asset: string,
  qty: string,
  eur: string,
  scope: 'coinhouse' | 'external' = 'coinhouse',
): TradeEvent => ({
  ...base(accountId, scope),
  kind: 'trade',
  at,
  out: { asset: 'eur', qty: eur },
  in: { asset, qty },
  valueEur: eur,
  valueEurSource: 'manual',
  fee: null,
  quotePrice: null,
});
const sell = (
  accountId: string,
  at: string,
  asset: string,
  qty: string,
  eur: string,
  scope: 'coinhouse' | 'external' = 'coinhouse',
): TradeEvent => ({
  ...base(accountId, scope),
  kind: 'trade',
  at,
  out: { asset, qty },
  in: { asset: 'eur', qty: eur },
  valueEur: eur,
  valueEurSource: 'manual',
  fee: null,
  quotePrice: null,
});
const price = (asset: string, eur: string): PriceQuoteInput => ({
  asset,
  priceEur: eur,
  at: '2026-08-23T10:00:00Z',
  source: 'test',
  stale: false,
});
const s = (b: Big | null | undefined): string | null => (b == null ? null : toDecimalString(b));

describe('moteur — comptes (computePortfolioByAccount)', () => {
  // ch:main achète 3 BTC à 50 000 € ; man:x1 achète 1 BTC à 70 000 € (prix différent) puis en vend
  // 0,4. man:x1 est délibérément marqué scope 'coinhouse' (un cas construit à la main, pas ce que
  // produit l'UI — voir src/lib/import/manual.ts où seul un compte explicite « Sur Coinhouse » vaut
  // ch:main) : cela exerce le cas où le grand livre consolidé contient, hors du compte Coinhouse,
  // un événement qui compte quand même dans le contrôle de solde (`EventScope`, indépendant du
  // compte). `computePortfolioByAccount` ne transmet `balances` qu'au compte ch:main (aggregate.ts),
  // donc son propre rapport reste correct même quand le consolidé se plaint.
  const events: LedgerEvent[] = [
    buy('ch:main', '2026-01-01T10:00:00', 'btc', '3', '150000'),
    buy('man:x1', '2026-01-02T10:00:00', 'btc', '1', '70000'),
    sell('man:x1', '2026-01-03T10:00:00', 'btc', '0.4', '30000'),
  ];
  const balances = [
    { rowKey: 'r1', asset: 'btc', signedQty: '3', balance: '3', at: '2026-01-01T10:00:00' },
  ];
  const prices = { btc: price('btc', '60000') };

  it('un rapport par compte, chacun avec son propre PRU (CUMP invariant à la vente)', () => {
    const byAccount = computePortfolioByAccount({
      events,
      prices,
      settings: DEFAULT_ENGINE_SETTINGS,
      balances,
    });
    expect([...byAccount.keys()].sort()).toEqual(['ch:main', 'man:x1']);

    const ch = byAccount.get('ch:main')!.positions[0]!;
    expect(s(ch.qty)).toBe('3');
    expect(s(ch.pru)).toBe('50000');
    expect(s(ch.costBasis)).toBe('150000');

    const man = byAccount.get('man:x1')!.positions[0]!;
    expect(s(man.qty)).toBe('0.6');
    expect(s(man.pru)).toBe('70000');
    expect(s(man.costBasis)).toBe('42000');
    expect(s(man.realized)).toBe('2000'); // 30000 − 70000 × 0,4.
  });

  it('la vue consolidée reste le grand livre entier : PRU pondéré par le coût, pas la moyenne des comptes', () => {
    const consolidated = computePortfolio({
      events,
      prices,
      settings: DEFAULT_ENGINE_SETTINGS,
      balances,
    });
    const btc = consolidated.positions[0]!;
    expect(s(btc.qty)).toBe('3.6');
    expect(s(btc.costBasis)).toBe('198000');
    // (150000 + 70000) / 4 = 55000, invariant à la vente — ni 50000 (ch:main), ni 70000 (man:x1),
    // ni leur moyenne simple (60000).
    expect(s(btc.pru)).toBe('55000');
  });

  it('Σ quantités par compte = quantité consolidée ; le coût, lui, ne se somme pas exactement après une vente', () => {
    const byAccount = computePortfolioByAccount({
      events,
      prices,
      settings: DEFAULT_ENGINE_SETTINGS,
      balances,
    });
    const consolidated = computePortfolio({
      events,
      prices,
      settings: DEFAULT_ENGINE_SETTINGS,
      balances,
    });
    const sumQty = [...byAccount.values()].reduce(
      (acc, r) => acc.plus(r.positions.find((p) => p.asset === 'btc')?.qty ?? ZERO),
      ZERO,
    );
    const sumCost = [...byAccount.values()].reduce(
      (acc, r) => acc.plus(r.positions.find((p) => p.asset === 'btc')?.costBasis ?? ZERO),
      ZERO,
    );
    expect(s(sumQty)).toBe(s(consolidated.positions[0]!.qty));
    // Voulu (docs/DECISIONS.md n° 20) : chaque compte a son propre PRU, donc le coût réparti entre
    // comptes au moment de la vente n'est pas celui du CUMP consolidé.
    expect(s(sumCost)).not.toBe(s(consolidated.positions[0]!.costBasis));
  });

  it("le solde ne s'applique qu'au compte Coinhouse : le consolidé peut se plaindre quand le compte reste correct", () => {
    const byAccount = computePortfolioByAccount({
      events,
      prices,
      settings: DEFAULT_ENGINE_SETTINGS,
      balances,
    });
    const consolidated = computePortfolio({
      events,
      prices,
      settings: DEFAULT_ENGINE_SETTINGS,
      balances,
    });

    // Compte Coinhouse : le solde (3 BTC) correspond exactement à ses propres événements.
    const chIntegrity = byAccount.get('ch:main')!.positions[0]!.integrity;
    expect(chIntegrity?.status).toBe('ok');
    expect(chIntegrity?.impliedOpening).toBeNull();
    expect(chIntegrity?.reorderedDays).toEqual([]);

    // Compte man:x1 : jamais de contrôle de solde (balances non transmis par computePortfolioByAccount).
    expect(byAccount.get('man:x1')!.positions[0]!.integrity).toBeNull();

    // Consolidé : le même unique relevé de solde (3 BTC) est comparé à la quantité scope='coinhouse'
    // de TOUT le grand livre (3 + 1 − 0,4 = 3,6, aggregate.ts ne filtre pas par compte) → écart.
    const btcIntegrity = consolidated.positions[0]!.integrity;
    expect(btcIntegrity?.status).toBe('final-mismatch');
    expect(s(btcIntegrity?.expected)).toBe('3');
    expect(s(btcIntegrity?.found)).toBe('3.6');
  });
});

describe('moteur — comptes, propriété', () => {
  it('sans vente : Σ quantités et Σ coûts par compte = quantité et coût consolidés, actif par actif', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            account: fc.constantFrom('ch:main', 'man:x1', 'man:x2'),
            asset: fc.constantFrom('a', 'b'),
            qty: fc.integer({ min: 1, max: 100_000 }),
            cents: fc.integer({ min: 1, max: 10_000_000 }),
          }),
          { minLength: 1, maxLength: 30 },
        ),
        (steps) => {
          const events: LedgerEvent[] = steps.map((step, i) =>
            buy(
              step.account,
              `2026-01-${String(1 + (i % 28)).padStart(2, '0')}T10:00:00`,
              step.asset,
              D(String(step.qty)).div('1000').toString(),
              D(String(step.cents)).div('100').toString(),
            ),
          );
          const byAccount = computePortfolioByAccount({
            events,
            prices: {},
            settings: DEFAULT_ENGINE_SETTINGS,
          });
          const consolidated = computePortfolio({
            events,
            prices: {},
            settings: DEFAULT_ENGINE_SETTINGS,
          });
          for (const asset of ['a', 'b']) {
            const consPos = [
              ...consolidated.positions,
              ...consolidated.stablecoins,
              ...consolidated.closed,
            ].find((p) => p.asset === asset);
            const sumQty = [...byAccount.values()].reduce((acc, r) => {
              const p = [...r.positions, ...r.stablecoins, ...r.closed].find(
                (x) => x.asset === asset,
              );
              return acc.plus(p?.qty ?? ZERO);
            }, ZERO);
            const sumCost = [...byAccount.values()].reduce((acc, r) => {
              const p = [...r.positions, ...r.stablecoins, ...r.closed].find(
                (x) => x.asset === asset,
              );
              return acc.plus(p?.costBasis ?? ZERO);
            }, ZERO);
            expect(s(sumQty)).toBe(s(consPos?.qty ?? ZERO));
            expect(s(sumCost)).toBe(s(consPos?.costBasis ?? ZERO));
          }
        },
      ),
      { numRuns: 150 },
    );
  });
});
