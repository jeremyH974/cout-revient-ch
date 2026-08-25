import { describe, expect, it } from 'vitest';
import { COINHOUSE_ACCOUNT_ID, type FeeEvent, type TradeEvent } from './types';
import { analyzeSubscription, classiqueFeeKindOf, oneYearBefore } from './subscription';
import { COINHOUSE_FEES } from './fees';
import { D } from './money';

const base: Pick<TradeEvent, 'source' | 'scope' | 'accountId' | 'rowKeys' | 'warnings'> = {
  source: 'coinhouse-csv',
  scope: 'coinhouse',
  accountId: COINHOUSE_ACCOUNT_ID,
  rowKeys: [],
  warnings: [],
};

function trade(
  id: string,
  at: string,
  out: string,
  into: string,
  valueEur: string,
  fee: { grossEur: string; rebateEur: string } | null = null,
): TradeEvent {
  return {
    ...base,
    id,
    at,
    kind: 'trade',
    out: { asset: out, qty: '1' },
    in: { asset: into, qty: '1' },
    valueEur,
    valueEurSource: 'counter-leg',
    fee: fee ? { asset: 'eur', gross: fee.grossEur, rebate: fee.rebateEur, ...fee } : null,
    quotePrice: null,
  };
}

function subscription(id: string, at: string, amountEur: string): FeeEvent {
  return { ...base, id, at, kind: 'fee', amountEur, label: 'Abonnement Coinhouse' };
}

describe('oneYearBefore', () => {
  it('recule d’un an sans fuseau, 29 février rabattu au 28', () => {
    expect(oneYearBefore('2026-08-25T10:00:00')).toBe('2025-08-25T10:00:00');
    expect(oneYearBefore('2024-02-29T00:00:00')).toBe('2023-02-28T00:00:00');
  });
});

describe('classiqueFeeKindOf', () => {
  it('classe chaque échange par ses jambes (achat supposé par virement)', () => {
    expect(classiqueFeeKindOf(trade('t', 'x', 'eur', 'btc', '1'))).toBe(COINHOUSE_FEES['buy-sepa']);
    expect(classiqueFeeKindOf(trade('t', 'x', 'btc', 'eur', '1'))).toBe(COINHOUSE_FEES['sell-eur']);
    expect(classiqueFeeKindOf(trade('t', 'x', 'usdc', 'eurcv', '1'))).toBe(
      COINHOUSE_FEES['stable-stable'],
    );
    expect(classiqueFeeKindOf(trade('t', 'x', 'btc', 'usdc', '1'))).toBe(
      COINHOUSE_FEES['crypto-crypto'],
    );
    // Payer en USDC est une conversion crypto↔crypto (décision n° 4), pas un achat en euros.
    expect(classiqueFeeKindOf(trade('t', 'x', 'usdc', 'btc', '1'))).toBe(
      COINHOUSE_FEES['crypto-crypto'],
    );
  });
});

describe('analyzeSubscription', () => {
  it('abonné : détecte l’offre, somme remises et abonnements, fenêtre 12 mois glissante', () => {
    const events = [
      // Achat 1 000 € : frais Classique = 0,99 % + 0,12 = 10,02 (choisi pour retomber juste).
      trade('t1', '2026-06-01T10:00:00', 'eur', 'btc', '1000', {
        grossEur: '10.02',
        rebateEur: '10.02',
      }),
      // Vente 500 € : Classique = 1,29 % + 0,12 = 6,57 ; remise partielle.
      trade('t2', '2026-08-01T10:00:00', 'btc', 'eur', '500', {
        grossEur: '6.57',
        rebateEur: '3',
      }),
      // Vieil achat HORS fenêtre (plus d'un an avant le dernier événement).
      trade('t0', '2024-01-01T10:00:00', 'eur', 'eth', '200', {
        grossEur: '2.1',
        rebateEur: '0',
      }),
      subscription('s1', '2026-07-01T00:00:00', '9.9'),
      subscription('s2', '2026-08-01T00:00:00', '9.9'),
      subscription('s0', '2024-02-01T00:00:00', '9.9'),
      // Événement d'une autre source : ignoré (il ne paie pas la grille Coinhouse).
      { ...trade('hl', '2026-08-02T00:00:00', 'eur', 'sol', '9999'), source: 'pivot-csv' as const },
    ];
    const analysis = analyzeSubscription(events);
    expect(analysis.tradeCount).toBe(3);
    expect(analysis.detectedTier).toBe('investisseur');
    expect(analysis.windowStart).toBe('2025-08-01T10:00:00');
    expect(analysis.subscriptionsTotal).toBe('29.7');
    expect(analysis.subscriptions12m).toBe('19.8');
    expect(analysis.feesGross).toBe('18.69');
    expect(analysis.rebates).toBe('13.02');
    expect(analysis.rebates12m).toBe('13.02');
    expect(analysis.feesNet).toBe('5.67');
    expect(analysis.feesNet12m).toBe('3.57');
    // Contrefactuel : 10,02 + 6,57 + (200 × 0,99 % + 0,12 = 2,1) = 18,69.
    expect(analysis.classiqueFees).toBe('18.69');
    expect(analysis.savedVsClassique).toBe('13.02');
    expect(analysis.netOfSubscription).toBe('-16.68');
    expect(analysis.netOfSubscription12m).toBe(D('13.02').minus('19.8').toString());
    expect(analysis.volume).toBe('1700');
    expect(analysis.volume12m).toBe('1500');
    expect(analysis.breakEvenAnnualVolume).toBeNull();
  });

  it('gestion privée quand l’abonnement annualisé dépasse la frontière', () => {
    const events = [
      trade('t1', '2026-08-01T10:00:00', 'eur', 'btc', '1000'),
      subscription('s1', '2026-05-01T00:00:00', '798'),
    ];
    expect(analyzeSubscription(events).detectedTier).toBe('gestion-privee');
  });

  it('classique : pas d’abonnement, seuil de rentabilité au taux effectif observé', () => {
    const events = [
      trade('t1', '2026-08-01T10:00:00', 'eur', 'btc', '1000', {
        grossEur: '10.02',
        rebateEur: '0',
      }),
    ];
    const analysis = analyzeSubscription(events);
    expect(analysis.detectedTier).toBe('classique');
    expect(analysis.netOfSubscription).toBeNull();
    // Taux effectif = 10,02 ÷ 1 000 ; seuil = 118,8 ÷ taux.
    expect(analysis.breakEvenAnnualVolume).toBe(D('118.8').div(D('10.02').div('1000')).toString());
  });

  it('sans opération Coinhouse : rien à dire', () => {
    const analysis = analyzeSubscription([]);
    expect(analysis.tradeCount).toBe(0);
    expect(analysis.subscriptionCount).toBe(0);
    expect(analysis.windowStart).toBeNull();
  });
});
