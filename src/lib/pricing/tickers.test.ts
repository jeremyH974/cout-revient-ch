import { describe, expect, it } from 'vitest';
import { CURATED_TICKERS, EUR_PEGGED, TICKERS } from './tickers';
import { AMBIGUOUS_SYMBOLS, GENERATED_TICKERS } from './tickers.generated';

/** Forme d'un code d'actif : minuscules alphanumériques, comme `normalizeAssetCode` les produit. */
const CODE = /^[a-z0-9]{2,12}$/;

describe('table des prix — la curée gagne toujours sur la générée', () => {
  /**
   * L'invariant qui compte. La table curée porte des décisions prises à la main — `eurcv` sans
   * identifiant parce qu'ancré à l'euro, `wif` → `dogwifcoin` — et une régénération ne doit
   * JAMAIS les effacer. L'écrasement serait parfaitement silencieux : le prix changerait, rien
   * d'autre.
   */
  it('rend la valeur curée pour chaque symbole curé', () => {
    for (const [code, info] of Object.entries(CURATED_TICKERS)) {
      expect(TICKERS[code], code).toEqual(info);
    }
  });

  it('ne réémet pas un symbole déjà curé', () => {
    const doublons = Object.keys(GENERATED_TICKERS).filter((c) => c in CURATED_TICKERS);
    expect(doublons).toEqual([]);
  });

  it('couvre les deux tables réunies, sans en perdre une', () => {
    const attendu = new Set([...Object.keys(GENERATED_TICKERS), ...Object.keys(CURATED_TICKERS)]);
    expect(new Set(Object.keys(TICKERS))).toEqual(attendu);
  });
});

describe('table des prix — un symbole ambigu ne reçoit aucun identifiant', () => {
  /**
   * Un mauvais identifiant ne donne pas « pas de prix » : il donne un **prix faux**, donc un PRU
   * faux, sans que rien ne le signale. Écarter les symboles en conflit coûte une couverture
   * dérisoire et supprime entièrement ce risque.
   */
  it('n’a cartographié aucun symbole déclaré ambigu', () => {
    const fautifs = AMBIGUOUS_SYMBOLS.filter((s) => s in GENERATED_TICKERS);
    expect(fautifs).toEqual([]);
  });

  it('déclare la liste des ambigus, même vide', () => {
    expect(Array.isArray(AMBIGUOUS_SYMBOLS)).toBe(true);
  });

  it('laisse un symbole ambigu sans cotation automatique, sauf s’il est curé', () => {
    for (const symbol of AMBIGUOUS_SYMBOLS) {
      if (symbol in CURATED_TICKERS) continue;
      expect(TICKERS[symbol], symbol).toBeUndefined();
    }
  });
});

describe('table des prix — forme des entrées générées', () => {
  it('porte un identifiant CoinGecko et un nom pour chacune', () => {
    for (const [code, info] of Object.entries(GENERATED_TICKERS)) {
      expect(info.coingeckoId, code).toBeTruthy();
      expect(info.name.length, code).toBeGreaterThan(0);
    }
  });

  it('n’invente aucun symbole Coinbase : CoinGecko ne les connaît pas', () => {
    for (const [code, info] of Object.entries(GENERATED_TICKERS)) {
      expect(info.coinbase, code).toBeNull();
    }
  });

  it('n’émet que des codes représentables par l’app', () => {
    const invalides = Object.keys(GENERATED_TICKERS).filter((c) => !CODE.test(c));
    expect(invalides).toEqual([]);
  });

  it('élargit réellement la couverture', () => {
    // Le but de la brique : chacun détient des cryptos différentes. 70 entrées ne suffisaient pas.
    expect(Object.keys(CURATED_TICKERS).length).toBeGreaterThanOrEqual(70);
    expect(Object.keys(TICKERS).length).toBeGreaterThan(300);
  });
});

describe('table des prix — les ancrages euro survivent à l’élargissement', () => {
  it('garde chaque stablecoin euro ancré, curé ou non', () => {
    for (const code of EUR_PEGGED) {
      // L'ancrage court-circuite les fournisseurs : une entrée générée ne doit pas donner
      // l'illusion qu'un stablecoin euro se cote ailleurs.
      if (code in GENERATED_TICKERS) {
        expect(CURATED_TICKERS[code], `${code} ancré mais généré`).toBeDefined();
      }
    }
  });
});
