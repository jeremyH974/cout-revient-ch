/**
 * Ce que le calcul coûte, en grandeurs DÉTERMINISTES (décision n° 85).
 *
 * Un test de performance qui chronomètre mesure surtout le bruit du runner partagé ; il clignote,
 * et un garde-fou qui clignote finit désactivé. Ce fichier ne chronomètre donc rien.
 *
 * Il compte deux grandeurs qui sont des fonctions **pures** du scénario — identiques sur toutes les
 * machines, à tous les runs — et qui sont exactement les deux causes du coût observé au banc
 * d'essai (`engine-load.bench.ts`) :
 *
 * 1. le nombre d'objets `LotConsumption` produits, en **O(n²)** — toujours vrai ;
 * 2. le nombre de décimales portées par les quantités — **borné depuis la décision n° 87**.
 *
 * Leur produit faisait le O(n³) de la décision n° 85 (12,3 s pour 400 opérations). Le second
 * facteur ayant été borné, il ne reste que le quadratique, et 400 opérations passent en 127 ms.
 *
 * Le quadratique restant a sa propre cause, non traitée : `position.ts` ne purge jamais sa liste
 * de lots, et la méthode proportionnelle n'en épuise aucun. C'est un autre sujet, plus risqué —
 * il touche la sémantique de la trace, pas seulement sa précision.
 *
 * Les chiffres ci-dessous sont un **constat de l'état actuel**, pas une cible : ils doivent changer
 * le jour où quelqu'un s'attaque au quadratique, et ce test est là pour l'exiger.
 */
import { describe, expect, it } from 'vitest';
import { runLedger } from '../../src/lib/domain/engine/compute';
import { MAX_TRACKED_LOTS } from '../../src/lib/domain/engine/position';
import { DEFAULT_ENGINE_SETTINGS, type LedgerEvent } from '../../src/lib/domain/types';
import { accumulation, roundTrip } from './scenario';

interface Load {
  /** Nombre total d'objets de trace produits par les cessions. */
  consumptions: number;
  /** Décimales de la quantité la plus « longue » rencontrée dans la trace. */
  maxDecimals: number;
}

function measure(events: readonly LedgerEvent[]): Load {
  const run = runLedger(events, DEFAULT_ENGINE_SETTINGS);
  let consumptions = 0;
  let maxDecimals = 0;
  for (const position of run.positions.values())
    for (const entry of position.history)
      for (const consumed of entry.lotsConsumed) {
        consumptions++;
        const decimals = consumed.qty.toFixed().split('.')[1]?.length ?? 0;
        if (decimals > maxDecimals) maxDecimals = decimals;
      }
  return { consumptions, maxDecimals };
}

describe('charge du moteur', () => {
  const small = measure(roundTrip(60));
  const large = measure(roundTrip(120));

  it('sous la borne, la trace reste complète — et donc quadratique', () => {
    // Ces deux tailles ouvrent moins de `MAX_TRACKED_LOTS` lots : aucun regroupement, chaque
    // cession parcourt encore tous les lots. C'est le comportement voulu — un portefeuille
    // ordinaire garde sa trace entière, au détail près.
    expect(small.consumptions).toBe(493);
    expect(large.consumptions).toBe(1888);
    const ratio = large.consumptions / small.consumptions;
    expect(ratio, 'quadratique attendu sous la borne').toBeGreaterThan(3.4);
    expect(ratio, 'au-delà, la complexité a empiré').toBeLessThan(4.6);
  });

  /**
   * **Le renversement** (décision n° 152). Ce fichier annonçait que ses chiffres « doivent changer
   * le jour où quelqu'un s'attaque au quadratique, et ce test est là pour l'exiger ». Voilà ce
   * jour : au-delà de la borne, doubler la taille ne quadruple plus rien, il double.
   */
  it('au-delà de la borne, doubler la taille DOUBLE la trace au lieu de la quadrupler', () => {
    const big = measure(roundTrip(1200));
    const bigger = measure(roundTrip(2400));
    const ratio = bigger.consumptions / big.consumptions;
    expect(ratio, 'linéaire attendu au-delà de la borne').toBeGreaterThan(1.8);
    expect(ratio, 'le quadratique est revenu').toBeLessThan(2.2);
  });

  it('aucune position ne suit plus de lots que la borne', () => {
    // La grandeur déterministe qui résume tout : c'est elle qui plafonne le coût d'une cession.
    for (const n of [600, 1200, 2400]) {
      const run = runLedger(roundTrip(n), DEFAULT_ENGINE_SETTINGS);
      for (const position of run.positions.values())
        expect(position.lots.length, `${n} opérations`).toBeLessThanOrEqual(MAX_TRACKED_LOTS);
    }
  });

  it('la précision des quantités est BORNÉE : elle ne dépend plus de la taille', () => {
    // Avant la décision n° 87, ces deux nombres valaient 692 et 1501 : `fraction` portait les 30
    // décimales de `Big.DP` et `times` étant exact, les chiffres s'additionnaient à chaque
    // cession. C'était le facteur O(n) qui, multiplié par l'O(n²) ci-dessus, faisait un O(n³).
    expect(small.maxDecimals).toBe(18);
    expect(large.maxDecimals).toBe(18);
    // Le vrai constat : doubler la taille ne change plus rien. C'est cette égalité, et non une
    // borne supérieure, qui dit que la croissance a bien disparu.
    expect(large.maxDecimals).toBe(small.maxDecimals);
  });

  it('dix-huit décimales, la précision du wei — et pas une de plus', () => {
    // `LOT_DP` dans `position.ts`. Si quelqu'un remonte cette borne, ce test le dira : au-delà, ce
    // ne sont plus des chiffres significatifs mais un artefact de division qui coûte cher.
    expect(large.maxDecimals).toBeLessThanOrEqual(18);
  });

  it('sans cession, rien de tout cela : l’accumulation seule reste linéaire', () => {
    // La forme « DCA pur » ne déclenche aucun parcours de lots. Le coût vient des CESSIONS, pas de
    // la taille du portefeuille — distinction que le banc d'essai chiffre en millisecondes.
    expect(measure(accumulation(600)).consumptions).toBe(0);
    expect(measure(accumulation(1200)).consumptions).toBe(0);
  });
});
