import { describe, expect, it } from 'vitest';
import { CANDLE_INTERVALS } from '../import/hyperliquid/candles';
import { candleWords, marketLabel, marketList, platformPoints } from './curve-detail';

describe('les mots de la courbe détaillée', () => {
  it('chaque pas servi a ses mots, sans retomber sur le libellé de l’API', () => {
    for (const interval of CANDLE_INTERVALS) {
      expect(candleWords(interval.id)).not.toContain(interval.id);
    }
    expect(candleWords('1m')).toBe("bougies d'une minute");
    expect(candleWords('15m')).toBe('bougies de 15 minutes');
    expect(candleWords('1d')).toBe("bougies d'un jour");
    expect(candleWords('3d')).toBe('bougies de 3d');
  });

  it('un marché dit s’il est perp ou spot, et une liste se lit comme une phrase', () => {
    expect(marketLabel('perp:BTC')).toBe('BTC (perp)');
    expect(marketLabel('perp:xyz:TSLA')).toBe('xyz:TSLA (perp)');
    expect(marketLabel('BTC')).toBe('BTC');
    expect(marketList([])).toBe('');
    expect(marketList(['spot:HYPE'])).toBe('HYPE (spot)');
    expect(marketList(['perp:BTC', 'spot:HYPE', 'spot:PURR'])).toBe(
      'BTC (perp), HYPE (spot) et PURR (spot)',
    );
  });

  it('le nombre de points s’accorde', () => {
    expect(platformPoints(1)).toBe("1 point d'Hyperliquid");
    expect(platformPoints(12)).toBe("12 points d'Hyperliquid");
  });
});
