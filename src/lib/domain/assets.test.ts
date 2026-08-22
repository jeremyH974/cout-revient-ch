import { describe, expect, it } from 'vitest';
import { assetClass, isCashLike, normalizeAssetCode } from './assets';

describe('assets', () => {
  it('classe fiat, stablecoins et cryptos', () => {
    expect(assetClass('eur')).toBe('fiat');
    expect(assetClass('usdc')).toBe('stablecoin');
    expect(assetClass('eurcv')).toBe('stablecoin');
    expect(assetClass('btc')).toBe('crypto');
    expect(assetClass('sky')).toBe('crypto');
  });

  it('normalise les tickers', () => {
    expect(normalizeAssetCode(' BTC ')).toBe('btc');
    expect(isCashLike('eur')).toBe(true);
    expect(isCashLike('usdc')).toBe(true);
    expect(isCashLike('eth')).toBe(false);
  });
});
