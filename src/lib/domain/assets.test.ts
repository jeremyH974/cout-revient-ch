import { describe, expect, it } from 'vitest';
import {
  assetClass,
  assetSymbol,
  equityCode,
  isCashLike,
  isEquityCode,
  normalizeAssetCode,
} from './assets';

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

  it('marque les titres, et la marque décide de la classe', () => {
    expect(equityCode('AAPL')).toBe('eq:aapl');
    expect(equityCode(' aapl ')).toBe('eq:aapl');
    expect(assetClass('eq:aapl')).toBe('equity');
    expect(assetSymbol('eq:aapl')).toBe('aapl');
    expect(assetSymbol('btc')).toBe('btc');
  });

  it('sépare deux actifs de classes différentes qui partagent un ticker', () => {
    // « SOL » désigne Solana et Emeren Group (NYSE) : deux codes, donc deux positions.
    expect(equityCode('SOL')).not.toBe(normalizeAssetCode('SOL'));
    expect(assetClass('sol')).toBe('crypto');
    expect(assetClass(equityCode('SOL'))).toBe('equity');
  });

  it('est idempotent et refuse un symbole vide', () => {
    expect(equityCode('eq:aapl')).toBe('eq:aapl');
    expect(() => equityCode('   ')).toThrow();
  });

  it('ne prend pas un ticker nommé « eq » pour un titre', () => {
    expect(isEquityCode('eq')).toBe(false);
    expect(isEquityCode('eq:')).toBe(false);
    expect(assetClass('eq')).toBe('crypto');
  });

  it("un titre n'est jamais une contrepartie cash, même nommé comme une devise", () => {
    expect(isCashLike(equityCode('AAPL'))).toBe(false);
    expect(isCashLike('eq:eur')).toBe(false);
    expect(assetClass('eq:eur')).toBe('equity');
  });
});
