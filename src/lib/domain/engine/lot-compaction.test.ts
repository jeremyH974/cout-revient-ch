/**
 * Le regroupement des lots anciens (décision n° 152).
 *
 * La méthode proportionnelle prend une part de **chaque** lot ouvert à chaque cession et n'en épuise
 * aucun : le coût d'un grand livre était `achats × cessions`, soit 11,3 s pour 3 200 opérations.
 * Au-delà de `MAX_TRACKED_LOTS`, les lots les plus anciens sont désormais regroupés.
 *
 * Ce fichier surveille les trois choses qui rendent ce regroupement acceptable, dans cet ordre
 * d'importance :
 *
 * 1. **Aucun chiffre financier ne bouge.** La somme des lots consommés par une cession reste
 *    exactement son coût de cession — c'est la propriété qui prouve que l'attribution n'a pas été
 *    perturbée, et elle se vérifie sans avoir à rejouer une version non regroupée.
 * 2. **Rien ne disparaît en silence.** Chaque lot dit combien d'acquisitions il représente, et la
 *    somme de ces compteurs redonne le nombre exact d'acquisitions.
 * 3. **Aucun signal n'est perdu.** Deux lots d'origines différentes ne se regroupent jamais : la
 *    trace se sert de l'origine pour signaler un coût repris d'une migration ou une récompense
 *    valorisée à zéro.
 */
import { describe, expect, it } from 'vitest';
import { runLedger } from './compute';
import { MAX_TRACKED_LOTS } from './position';
import { DEFAULT_ENGINE_SETTINGS, type LedgerEvent, type TradeEvent } from '../types';
import { ZERO, type Big } from '../money';

let seq = 0;
const base = () => ({
  id: `e${++seq}`,
  source: 'manual' as const,
  scope: 'coinhouse' as const,
  accountId: 'ch:main' as const,
  rowKeys: [],
  warnings: [],
});
const day = (i: number): string => {
  const d = new Date(Date.UTC(2020, 0, 1) + i * 86_400_000);
  return `${d.toISOString().slice(0, 10)}T10:00:00`;
};
const buy = (i: number, qty: string, eur: string): TradeEvent => ({
  ...base(),
  kind: 'trade',
  at: day(i),
  out: { asset: 'eur', qty: eur },
  in: { asset: 'btc', qty },
  valueEur: eur,
  valueEurSource: 'manual',
  fee: null,
  quotePrice: null,
});
const sell = (i: number, qty: string, eur: string): TradeEvent => ({
  ...base(),
  kind: 'trade',
  at: day(i),
  out: { asset: 'btc', qty },
  in: { asset: 'eur', qty: eur },
  valueEur: eur,
  valueEurSource: 'manual',
  fee: null,
  quotePrice: null,
});

const reward = (i: number, qty: string, fair: string): LedgerEvent => ({
  ...base(),
  kind: 'reward',
  at: day(i),
  in: { asset: 'btc', qty },
  fairValueEur: fair,
});

/**
 * Achats et ventes alternés, à des prix qui VARIENT — sans quoi le réalisé vaudrait zéro partout et
 * ne prouverait rien de l'attribution. Une récompense tous les onze événements : c'est elle qui
 * rend le cloisonnement des origines OBSERVABLE, sans quoi le test passerait au vert même si le
 * regroupement traversait les familles.
 */
function mixed(n: number): LedgerEvent[] {
  const events: LedgerEvent[] = [];
  for (let i = 0; i < n; i++) {
    const price = 20_000 + (i % 97) * 137;
    if (i % 11 === 7) events.push(reward(i, '0.05', String(0.05 * price)));
    else if (i % 3 === 2 && i > 3) events.push(sell(i, '0.4', String(0.4 * price)));
    else events.push(buy(i, '1', String(price)));
  }
  return events;
}

const position = (events: readonly LedgerEvent[]) => {
  const run = runLedger(events, DEFAULT_ENGINE_SETTINGS);
  const p = run.positions.get('btc');
  expect(p, 'la position btc doit exister').toBeDefined();
  return p!;
};

const sum = (values: readonly Big[]): Big => values.reduce((acc, v) => acc.plus(v), ZERO);

describe('sous la borne, rien n’est regroupé', () => {
  const p = position(mixed(60));

  it('chaque lot ne représente qu’une acquisition', () => {
    expect(p.lots.length).toBeGreaterThan(10);
    expect(p.lots.every((lot) => lot.mergedCount === 1)).toBe(true);
  });
});

describe('au-delà de la borne', () => {
  const events = mixed(900);
  const purchases = events.filter((e) => e.kind === 'trade' && e.in.asset === 'btc').length;
  const rewards = events.filter((e) => e.kind === 'reward').length;
  const acquisitions = purchases + rewards;
  const p = position(events);

  it('ne suit jamais plus de lots que la borne', () => {
    expect(acquisitions).toBeGreaterThan(MAX_TRACKED_LOTS);
    expect(p.lots.length).toBeLessThanOrEqual(MAX_TRACKED_LOTS);
  });

  it('regroupe effectivement : au moins un lot en représente plusieurs', () => {
    // Sans cette assertion, le fichier passerait au vert sur un scénario qui ne regroupe rien —
    // c'est le défaut des décisions n° 136, 145 et 149, et il ne se reproduira pas ici.
    expect(p.lots.some((lot) => lot.mergedCount > 1)).toBe(true);
  });

  it('ne perd aucune acquisition : la somme des compteurs les redonne toutes', () => {
    expect(p.lots.reduce((acc, lot) => acc + lot.mergedCount, 0)).toBe(acquisitions);
  });

  /**
   * Le cloisonnement des origines, **observable**. Si le regroupement traversait les familles, les
   * compteurs d'une origine absorberaient ceux d'une autre et ces deux totaux se décaleraient.
   * L'origine n'est pas décorative : la trace s'en sert pour signaler une récompense valorisée à
   * zéro ou un coût repris d'une migration.
   */
  it('ne regroupe jamais deux origines ensemble', () => {
    expect(rewards).toBeGreaterThan(10);
    const byOrigin = (origin: string): number =>
      p.lots.filter((l) => l.origin === origin).reduce((acc, l) => acc + l.mergedCount, 0);
    expect(byOrigin('purchase'), 'achats regroupés').toBe(purchases);
    expect(byOrigin('reward'), 'récompenses regroupées').toBe(rewards);
  });

  /** L'invariant que l'auto-vérification contrôle en direct, ici EXACT et non à la tolérance près. */
  it('la somme des lots redonne exactement la quantité et le coût de la position', () => {
    expect(sum(p.lots.map((l) => l.qtyRemaining)).toString()).toBe(p.qty.toString());
    expect(sum(p.lots.map((l) => l.costRemaining)).toString()).toBe(p.costBasis.toString());
  });

  /**
   * **La propriété décisive.** Le coût de cession se calcule depuis `costBasis` et `qty`, jamais
   * depuis les lots ; si le regroupement avait perturbé l'attribution, cette égalité tomberait.
   * Elle se vérifie sans rejouer une version non regroupée : c'est l'énoncé même du type
   * `LotConsumption` — « Σ cost d'une cession EST son coût de cession ».
   */
  it('chaque cession reste exactement la somme des lots qu’elle consomme', () => {
    const disposals = p.history.filter((h) => h.lotsConsumed.length > 0);
    expect(disposals.length).toBeGreaterThan(100);
    for (const h of disposals) {
      const costOfSale = (h.valueEur ?? ZERO).minus(h.realized ?? ZERO);
      expect(sum(h.lotsConsumed.map((c) => c.cost)).toString(), h.eventId).toBe(
        costOfSale.toString(),
      );
      expect(sum(h.lotsConsumed.map((c) => c.qty)).toString(), h.eventId).toBe(
        (h.qty ?? ZERO).abs().toString(),
      );
    }
  });

  it('dit dans chaque consommation combien d’acquisitions le lot représente', () => {
    const consumed = p.history.flatMap((h) => h.lotsConsumed);
    expect(consumed.length).toBeGreaterThan(0);
    expect(consumed.every((c) => c.mergedCount >= 1)).toBe(true);
    expect(consumed.some((c) => c.mergedCount > 1)).toBe(true);
  });
});
