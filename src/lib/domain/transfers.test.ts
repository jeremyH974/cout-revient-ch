/**
 * Virements internes appariés (décision n° 25) : appariement automatique borné (fenêtre, actif,
 * comptes différents, tolérance frais réseau), overrides, et sémantique moteur — la sortie se fait
 * au coût et le coût voyage vers le dépôt, dans la vue consolidée comme dans la vue par compte.
 */
import { describe, expect, it } from 'vitest';
import { computePortfolio, computePortfolioByAccount } from './engine/aggregate';
import { runLedger } from './engine/compute';
import { D } from './money';
import { pairFeeQty, pairTransfers } from './transfers';
import {
  DEFAULT_ENGINE_SETTINGS,
  type DepositEvent,
  type TradeEvent,
  type WithdrawalEvent,
} from './types';

let seq = 0;
const base = (accountId: string) => ({
  id: `e${++seq}`,
  source: 'manual' as const,
  scope: 'external' as const,
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
): TradeEvent => ({
  ...base(accountId),
  kind: 'trade',
  at,
  out: { asset: 'eur', qty: eur },
  in: { asset, qty },
  valueEur: eur,
  valueEurSource: 'manual',
  fee: null,
  quotePrice: null,
});
const withdrawal = (
  accountId: string,
  at: string,
  asset: string,
  qty: string,
  proceedsEur: string | null = null,
): WithdrawalEvent => ({
  ...base(accountId),
  kind: 'withdrawal',
  at,
  out: { asset, qty },
  proceedsEur,
});
const deposit = (
  accountId: string,
  at: string,
  asset: string,
  qty: string,
  costEur: string | null = null,
): DepositEvent => ({
  ...base(accountId),
  kind: 'deposit',
  at,
  in: { asset, qty },
  costEur,
});
const settings = DEFAULT_ENGINE_SETTINGS;

describe('pairTransfers', () => {
  it('apparie retrait et dépôt compatibles (fenêtre, actif, comptes différents)', () => {
    const w = withdrawal('a', '2026-03-01T10:00:00', 'btc', '0.5');
    const d = deposit('b', '2026-03-01T10:25:00', 'btc', '0.4995');
    const { events, pairs, unpairedDeposits, unpairedWithdrawals } = pairTransfers([w, d]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ withdrawalId: w.id, depositId: d.id, forced: false });
    expect(pairFeeQty(pairs[0]!).toString()).toBe('0.0005');
    expect(unpairedDeposits).toHaveLength(0);
    expect(unpairedWithdrawals).toHaveLength(0);
    const dw = events.find((e) => e.id === w.id) as WithdrawalEvent;
    const dd = events.find((e) => e.id === d.id) as DepositEvent;
    expect(dw.transferTo).toBe(d.id);
    expect(dd.transferFrom).toBe(w.id);
  });

  it('respecte la fenêtre temporelle (−2 h / +72 h)', () => {
    const w = withdrawal('a', '2026-03-01T10:00:00', 'btc', '1');
    const early = deposit('b', '2026-03-01T07:59:00', 'btc', '1');
    const late = deposit('b', '2026-03-04T10:01:00', 'btc', '1');
    const skew = deposit('b', '2026-03-01T08:30:00', 'btc', '1');
    expect(pairTransfers([w, early]).pairs).toHaveLength(0);
    expect(pairTransfers([w, late]).pairs).toHaveLength(0);
    expect(pairTransfers([w, skew]).pairs).toHaveLength(1);
  });

  it('tolère les frais réseau (≤ 2 %) mais pas un écart supérieur, ni un vrai surplus', () => {
    const w = withdrawal('a', '2026-03-01T10:00:00', 'eth', '10');
    const okFee = deposit('b', '2026-03-01T11:00:00', 'eth', '9.8');
    const tooShort = deposit('b', '2026-03-01T11:00:00', 'eth', '9.79');
    const overshoot = deposit('b', '2026-03-01T11:00:00', 'eth', '10.1');
    expect(pairTransfers([w, okFee]).pairs).toHaveLength(1);
    expect(pairTransfers([w, tooShort]).pairs).toHaveLength(0);
    expect(pairTransfers([w, overshoot]).pairs).toHaveLength(0);
  });

  it('n’apparie ni même compte, ni actif différent, ni valeurs déjà renseignées', () => {
    const w = withdrawal('a', '2026-03-01T10:00:00', 'btc', '1');
    expect(pairTransfers([w, deposit('a', '2026-03-01T10:05:00', 'btc', '1')]).pairs).toHaveLength(
      0,
    );
    expect(pairTransfers([w, deposit('b', '2026-03-01T10:05:00', 'eth', '1')]).pairs).toHaveLength(
      0,
    );
    expect(
      pairTransfers([w, deposit('b', '2026-03-01T10:05:00', 'btc', '1', '100')]).pairs,
    ).toHaveLength(0);
    expect(
      pairTransfers([
        withdrawal('a', '2026-03-01T10:00:00', 'btc', '1', '900'),
        deposit('b', '2026-03-01T10:05:00', 'btc', '1'),
      ]).pairs,
    ).toHaveLength(0);
  });

  it('est glouton par proximité temporelle et déterministe (indépendant de l’ordre d’entrée)', () => {
    const w1 = withdrawal('a', '2026-03-01T10:00:00', 'btc', '1');
    const w2 = withdrawal('c', '2026-03-01T11:00:00', 'btc', '1');
    const d1 = deposit('b', '2026-03-01T11:10:00', 'btc', '1');
    const forward = pairTransfers([w1, w2, d1]).pairs;
    const backward = pairTransfers([d1, w2, w1]).pairs;
    expect(forward).toHaveLength(1);
    expect(forward[0]!.withdrawalId).toBe(w2.id);
    expect(backward).toEqual(forward);
  });

  it('overrides : « none » bloque, un id force la paire hors fenêtre, un id invalide est ignoré', () => {
    const w = withdrawal('a', '2026-03-01T10:00:00', 'btc', '1');
    const d = deposit('b', '2026-03-10T10:00:00', 'btc', '1');
    expect(pairTransfers([w, d]).pairs).toHaveLength(0);
    const forced = pairTransfers([w, d], { [w.id]: d.id });
    expect(forced.pairs).toHaveLength(1);
    expect(forced.pairs[0]!.forced).toBe(true);
    const near = deposit('b', '2026-03-01T10:05:00', 'btc', '1');
    expect(pairTransfers([w, near], { [w.id]: 'none' }).pairs).toHaveLength(0);
    expect(pairTransfers([w, d], { [w.id]: 'zzz' }).pairs).toHaveLength(0);
  });

  it('chaque dépôt n’est utilisé qu’une fois', () => {
    const w1 = withdrawal('a', '2026-03-01T10:00:00', 'btc', '1');
    const w2 = withdrawal('a', '2026-03-01T10:30:00', 'btc', '1');
    const d = deposit('b', '2026-03-01T10:31:00', 'btc', '1');
    const { pairs, unpairedWithdrawals } = pairTransfers([w1, w2, d]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.withdrawalId).toBe(w2.id);
    expect(unpairedWithdrawals.map((x) => x.id)).toEqual([w1.id]);
  });
});

describe('moteur — le coût voyage', () => {
  const scenario = () => {
    const b = buy('a', '2026-01-01T09:00:00', 'btc', '1', '10000');
    const w = withdrawal('a', '2026-02-01T10:00:00', 'btc', '0.5');
    const d = deposit('b', '2026-02-01T12:00:00', 'btc', '0.4995');
    return { b, events: pairTransfers([b, w, d]).events, w, d };
  };

  it('vue consolidée : réalisé nul, coût conservé, frais réseau renchérissant le PRU', () => {
    const { events } = scenario();
    const report = computePortfolio({ events, prices: {}, settings });
    const btc = [...report.positions, ...report.closed].find((p) => p.asset === 'btc')!;
    expect(btc.qty.toString()).toBe('0.9995');
    expect(btc.costBasis.toString()).toBe('10000');
    expect(btc.realized.toString()).toBe('0');
    expect(btc.investedTotal.minus(btc.proceedsTotal).toString()).toBe('10000');
  });

  it('vue par compte : le dépôt du compte destination porte le coût sorti du compte source', () => {
    const { events } = scenario();
    const byAccount = computePortfolioByAccount({ events, prices: {}, settings });
    const a = [...byAccount.get('a')!.positions, ...byAccount.get('a')!.closed].find(
      (p) => p.asset === 'btc',
    )!;
    const b = [...byAccount.get('b')!.positions, ...byAccount.get('b')!.closed].find(
      (p) => p.asset === 'btc',
    )!;
    expect(a.qty.toString()).toBe('0.5');
    expect(a.costBasis.toString()).toBe('5000');
    expect(a.realized.toString()).toBe('0');
    expect(b.qty.toString()).toBe('0.4995');
    expect(b.costBasis.toString()).toBe('5000');
    expect(b.pru!.toFixed(2)).toBe('10010.01');
  });

  it('dépôt horodaté avant le retrait (horloges décalées) : différé puis appliqué au bon coût', () => {
    const b = buy('a', '2026-01-01T09:00:00', 'btc', '1', '10000');
    const w = withdrawal('a', '2026-02-01T10:00:00', 'btc', '0.5');
    const d = deposit('b', '2026-02-01T09:30:00', 'btc', '0.5');
    const { events } = pairTransfers([b, w, d]);
    expect((events.find((e) => e.id === d.id) as DepositEvent).transferFrom).toBe(w.id);
    const run = runLedger(events, settings);
    const btc = run.positions.get('btc')!;
    expect(btc.qty.toString()).toBe('1');
    expect(btc.costBasis.toString()).toBe('10000');
    expect(btc.realized.toString()).toBe('0');
    expect(run.transferCosts.get(w.id)!.toString()).toBe('5000');
  });

  it('source bloquée (historique manquant) : pas de coût transféré, position gelée comme avant', () => {
    const w = withdrawal('a', '2026-02-01T10:00:00', 'btc', '0.5');
    const d = deposit('b', '2026-02-01T12:00:00', 'btc', '0.5');
    const { events } = pairTransfers([w, d]);
    const run = runLedger(events, settings);
    expect(run.transferCosts.has(w.id)).toBe(false);
    // La cession sans historique bloque l'actif (sémantique inchangée du moteur) : le dépôt
    // apparié est gelé lui aussi, l'utilisateur doit d'abord compléter l'historique d'achat.
    expect(run.positions.get('btc')!.blocked).not.toBeNull();
  });

  it('invariant par actif : total = valeur + Σ produits − Σ achats malgré le virement', () => {
    const { events } = scenario();
    const priced = computePortfolio({
      events,
      prices: {
        btc: { asset: 'btc', priceEur: '20000', at: '2026-03-01', source: 'test', stale: false },
      },
      settings,
    });
    const btc = priced.positions.find((p) => p.asset === 'btc')!;
    const total = btc.total!;
    const check = btc.value!.plus(btc.proceedsTotal).minus(btc.investedTotal);
    expect(total.minus(check).abs().lte(D('0.000001'))).toBe(true);
  });
});
