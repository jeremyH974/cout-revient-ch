import { describe, expect, it } from 'vitest';
import { frankfurterProvider } from '../fx/frankfurter';
import { defaultHistoryProviders } from '../history/providers/index';
import { BTC_HOSTS } from '../import/onchain/btc';
import { FLAVOR_LABELS } from '../import/onchain/etherscan';
import { FEAR_GREED_ATTRIBUTION } from '../pricing/fear-greed';
import { defaultPriceProviders } from '../pricing/providers/index';
import { CALENDAR } from '../calendar/events.generated';
import { MACRO } from '../macro/snapshot.generated';
import { DATA_SOURCES, requiredAttributions, sourceEmitting } from './sources';

/**
 * Tout ce que le code peut nommer comme origine d'une donnée. La liste n'est pas écrite à la main :
 * elle est construite à partir des **fabriques réelles**, si bien qu'ajouter un fournisseur la fait
 * grandir toute seule et fait échouer le test tant que la source n'est pas inscrite au catalogue.
 * C'est tout l'intérêt du dispositif — l'oubli d'attribution est autrement silencieux.
 */
function namesEmittedByTheApp(): string[] {
  return [
    ...defaultPriceProviders({ usdToEur: () => '1' }).map((p) => p.name),
    ...defaultHistoryProviders({}, () => '1').map((p) => p.name),
    frankfurterProvider().name,
    // `evm-sync.ts` étiquette « Blockscout » la tentative sans clé, hors table des parfums.
    'Blockscout',
    ...Object.values(FLAVOR_LABELS),
    ...BTC_HOSTS,
    FEAR_GREED_ATTRIBUTION,
    // Sources du contexte de marché : l'app ne les contacte pas, ce sont les générateurs qui le
    // font en CI — mais leurs données sont bien affichées, donc elles doivent être créditées.
    // Les listes viennent des fichiers engendrés eux-mêmes : ajouter une source à un générateur
    // fait grandir celle-ci, et fait échouer ce test tant qu'elle n'est pas au catalogue.
    ...CALENDAR.sources.map((s) => s.source),
    ...MACRO.sources.map((s) => s.source),
  ];
}

describe('catalogue des sources de données', () => {
  it('crédite toute source que le code interroge : en ajouter une sans l’inscrire échoue ici', () => {
    const orphans = [...new Set(namesEmittedByTheApp())].filter((n) => sourceEmitting(n) === null);
    expect(orphans).toEqual([]);
  });

  it('ne crédite personne en trop : chaque entrée correspond à une source réellement interrogée', () => {
    const emitted = new Set(namesEmittedByTheApp());
    const unused = DATA_SOURCES.filter((s) => !s.emits.some((name) => emitted.has(name)));
    expect(unused.map((s) => s.id)).toEqual([]);
  });

  it('n’attribue pas deux sources au même nom', () => {
    const seen = new Map<string, string>();
    for (const source of DATA_SOURCES) {
      for (const name of source.emits) {
        expect(seen.get(name), `« ${name} » revendiqué deux fois`).toBeUndefined();
        seen.set(name, source.id);
      }
    }
  });

  it('porte une mention mot pour mot et sa référence datée dès qu’un devoir est contractuel', () => {
    for (const source of requiredAttributions()) {
      expect(source.notice, source.id).toBeTruthy();
      expect(source.terms, source.id).not.toBeNull();
      expect(source.terms?.checkedOn, source.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('ne prétend pas connaître une obligation non constatée', () => {
    for (const source of DATA_SOURCES) {
      if (source.duty !== 'required') continue;
      expect(source.terms?.url, source.id).toMatch(/^https:\/\//);
    }
    // Une source non vérifiée est créditée, mais n'impose rien : pas de mention imposée.
    for (const source of DATA_SOURCES) {
      if (source.duty === 'unverified') expect(source.notice, source.id).toBeNull();
    }
  });

  it('reprend les quatre obligations constatées', () => {
    // La BCE s'est ajoutée le 01/09/2026 : la table affirmait « aucune clause d'attribution
    // constatée » alors que le disclaimer en porte une, et l'app relayait ses taux sans la citer
    // (décision n° 91). Un devoir non constaté et un devoir inexistant ne sont pas la même chose.
    expect(
      requiredAttributions()
        .map((s) => s.id)
        .sort(),
    ).toEqual(['alternative-me', 'coingecko', 'ecb', 'etherscan']);
    expect(sourceEmitting('CoinGecko')?.notice).toBe('Powered by CoinGecko');
    expect(sourceEmitting('Etherscan V2')?.notice).toBe('Powered by Etherscan.io APIs');
    expect(sourceEmitting('BCE via Frankfurter')?.notice).toBe(
      'Source : Banque centrale européenne',
    );
  });

  it('donne à chaque source un lien et un rôle lisibles', () => {
    for (const source of DATA_SOURCES) {
      expect(source.url, source.id).toMatch(/^https:\/\//);
      expect(source.role.length, source.id).toBeGreaterThan(20);
      expect(source.emits.length, source.id).toBeGreaterThan(0);
    }
  });
});
