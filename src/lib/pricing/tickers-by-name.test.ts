import { describe, expect, it } from 'vitest';
import { assetName, codeByName } from './tickers';

describe('résolution d’un actif par son nom', () => {
  it('retrouve le code des cryptos qu’eToro nomme au lieu de les tickeriser', () => {
    expect(codeByName('Bitcoin')).toBe('btc');
    expect(codeByName('Ethereum')).toBe('eth');
    expect(codeByName('  dogecoin ')).toBe('doge');
  });

  it('fait l’aller-retour avec le nom affiché', () => {
    for (const code of ['btc', 'eth', 'doge']) {
      expect(codeByName(assetName(code))).toBe(code);
    }
  });

  it('ne résout pas un nom inconnu, et n’en invente pas', () => {
    expect(codeByName('Instrument Qui N’Existe Pas')).toBeNull();
    expect(codeByName('')).toBeNull();
  });
});
