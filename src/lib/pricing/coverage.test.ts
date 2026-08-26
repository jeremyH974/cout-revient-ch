import { describe, expect, it } from 'vitest';
import { isEurPegged } from '../history/service';
import { EUR_PEGGED, TICKERS } from './tickers';

/**
 * P8 réclamait « l'historique long de EURCV et GMX ». Les deux cas se sont réglés d'eux-mêmes — GMX
 * par l'historique profond DefiLlama (2.5.1), EURCV par son ancrage à l'euro — mais rien ne le
 * verrouillait, et une régression serait passée inaperçue : une courbe qui redevient courte ne
 * lève aucune erreur, elle raccourcit, c'est tout.
 *
 * Plutôt que d'épingler ces deux tickers, on vérifie la **propriété** pour les 70 : tout actif de
 * la table curée doit avoir un chemin vers un historique profond — un identifiant CoinGecko (donc
 * DefiLlama, sans profondeur maximale), ou l'ancrage euro. En ajouter un qui n'a ni l'un ni l'autre
 * échoue ici, au lieu de se découvrir sur un graphe tronqué.
 */
describe('couverture de l’historique profond', () => {
  it('donne à chaque actif curé un chemin vers un historique complet', () => {
    const uncovered = Object.entries(TICKERS)
      .filter(([code, info]) => info.coingeckoId === null && !isEurPegged(code))
      .map(([code]) => code);
    expect(uncovered).toEqual([]);
  });

  it('GMX passe par son identifiant CoinGecko, donc par le filet DefiLlama', () => {
    expect(TICKERS['gmx']?.coingeckoId).toBe('gmx');
  });

  it('EURCV vaut 1 € par construction plutôt que de dépendre d’un fournisseur', () => {
    expect(TICKERS['eurcv']?.coingeckoId).toBeNull();
    expect(isEurPegged('eurcv')).toBe(true);
  });

  it('ancre les stablecoins euro même hors table curée — c’est ce qui les sauve du « sans cours »', () => {
    // `eure`, `eurs` et `eurt` ne sont volontairement PAS dans `TICKERS` : aucun fournisseur ne les
    // cote, et sans l'ancrage ils n'auraient aucun prix. Le débordement est le mécanisme, pas un
    // oubli — d'où ce test, qui tomberait si quelqu'un « rangeait » l'un des deux ensembles.
    for (const code of EUR_PEGGED) expect(isEurPegged(code), code).toBe(true);
    expect([...EUR_PEGGED].some((c) => !(c in TICKERS))).toBe(true);
  });

  it('fait gagner l’ancrage sur la cotation quand un actif a les deux (EURC)', () => {
    // EURC est à la fois dans la table curée (id CoinGecko « euro-coin ») et ancré à l'euro.
    // `loadDailyHistory` court-circuite sur `isEurPegged` avant même de lire le cache : les deux
    // chemins ne peuvent donc jamais diverger d'un centime.
    expect(TICKERS['eurc']?.coingeckoId).toBe('euro-coin');
    expect(isEurPegged('eurc')).toBe(true);
  });
});
