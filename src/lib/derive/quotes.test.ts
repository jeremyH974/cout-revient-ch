/**
 * L'ordre de priorité des cotations (décision n° 94).
 *
 * Prix manuel > cotation en direct > cache. Cet arbitrage décide de tous les chiffres affichés, il
 * n'était écrit qu'à un seul endroit, et s'en écarter ne casserait rien de visible : cela
 * afficherait simplement de mauvais prix. C'est exactement le genre de règle qu'il faut tenir par
 * un test plutôt que par la mémoire.
 */
import { describe, expect, it } from 'vitest';
import type { PriceQuoteInput } from '../domain/engine/report';
import { MANUAL_PRICE_EPOCH, effectiveQuotes } from './quotes';

const quote = (asset: string, priceEur: string, source: string): PriceQuoteInput => ({
  asset,
  priceEur,
  at: '2026-09-01',
  source,
  stale: false,
});

const noOverride = {};

describe('priorité des cotations', () => {
  it('le cache sert quand il est seul', () => {
    const result = effectiveQuotes({ btc: quote('btc', '50000', 'cache') }, {}, noOverride);
    expect(result['btc']?.priceEur).toBe('50000');
  });

  it('une cotation en direct l’emporte sur le cache', () => {
    const result = effectiveQuotes(
      { btc: quote('btc', '50000', 'cache') },
      { btc: quote('btc', '51000', 'live') },
      noOverride,
    );
    expect(result['btc']?.priceEur).toBe('51000');
  });

  it('un prix manuel l’emporte sur les DEUX', () => {
    const result = effectiveQuotes(
      { btc: quote('btc', '50000', 'cache') },
      { btc: quote('btc', '51000', 'live') },
      { btc: { manualPriceEur: '42000', manualPriceAt: '2026-08-01' } },
    );
    expect(result['btc']?.priceEur).toBe('42000');
    expect(result['btc']?.source).toBe('manuel');
    expect(result['btc']?.at).toBe('2026-08-01');
  });

  it('un prix manuel n’est jamais périmé : c’est la valeur de l’utilisateur, pas une cotation', () => {
    const stale = { ...quote('btc', '50000', 'cache'), stale: true };
    const result = effectiveQuotes(
      { btc: stale },
      {},
      {
        btc: { manualPriceEur: '42000', manualPriceAt: null },
      },
    );
    expect(result['btc']?.stale).toBe(false);
  });

  /**
   * L'époque Unix plutôt que la date du jour, délibérément : elle n'est pas plausible, donc elle se
   * remarque. Dater d'aujourd'hui un prix saisi il y a six mois le ferait passer pour frais.
   */
  it('un prix manuel sans date porte une date invraisemblable, jamais celle du jour', () => {
    const result = effectiveQuotes(
      {},
      {},
      { btc: { manualPriceEur: '42000', manualPriceAt: null } },
    );
    expect(result['btc']?.at).toBe(MANUAL_PRICE_EPOCH);
    expect(result['btc']?.at.startsWith('1970')).toBe(true);
  });

  it('un réglage sans prix manuel ne remplace rien', () => {
    const result = effectiveQuotes(
      { btc: quote('btc', '50000', 'cache') },
      {},
      {
        btc: { manualPriceEur: null, manualPriceAt: '2026-08-01' },
      },
    );
    expect(result['btc']?.priceEur).toBe('50000');
    expect(result['btc']?.source).toBe('cache');
  });

  it('n’écrase pas les autres actifs', () => {
    const result = effectiveQuotes(
      { btc: quote('btc', '50000', 'cache'), eth: quote('eth', '3000', 'cache') },
      {},
      { btc: { manualPriceEur: '42000', manualPriceAt: null } },
    );
    expect(result['eth']?.priceEur).toBe('3000');
    expect(Object.keys(result).sort()).toEqual(['btc', 'eth']);
  });
});
