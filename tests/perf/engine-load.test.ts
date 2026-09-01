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
 * 1. le nombre d'objets `LotConsumption` produits, en **O(n²)** ;
 * 2. le nombre de décimales portées par les quantités, en **O(n)**.
 *
 * Leur produit est le O(n³) mesuré. Les chiffres ci-dessous sont un **constat de l'état actuel**,
 * pas une cible : ils doivent changer le jour où quelqu'un s'attaque au sujet, et ce test est là
 * pour l'exiger plutôt que pour le subir.
 */
import { describe, expect, it } from 'vitest';
import { runLedger } from '../../src/lib/domain/engine/compute';
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

  it('la trace des lots croît en O(n²) : doubler la taille la quadruple', () => {
    expect(small.consumptions).toBe(493);
    expect(large.consumptions).toBe(1888);
    // Chaque cession parcourt TOUS les lots ouverts, et la méthode proportionnelle n'en épuise
    // aucun : `position.ts` ne connaît que `push` et l'itération, jamais de purge.
    const ratio = large.consumptions / small.consumptions;
    expect(ratio, 'quadratique attendu').toBeGreaterThan(3.4);
    expect(ratio, 'au-delà, la complexité a empiré').toBeLessThan(4.6);
  });

  it('la précision des quantités croît en O(n) : chaque cession ajoute des chiffres', () => {
    expect(small.maxDecimals).toBe(692);
    expect(large.maxDecimals).toBe(1501);
    // `fraction = qty.div(this.qty)` porte 20 décimales ; `lot.qtyRemaining.times(fraction)` est
    // exact, donc les chiffres s'ADDITIONNENT à chaque cession. Rien ne les borne.
    const ratio = large.maxDecimals / small.maxDecimals;
    expect(ratio, 'linéaire attendu').toBeGreaterThan(1.7);
    expect(ratio, 'au-delà, la précision s’emballe plus vite qu’avant').toBeLessThan(2.6);
  });

  it('mille cinq cents décimales pour une quantité qui en demande huit', () => {
    // Le constat qui explique tout le reste : ce ne sont pas des chiffres significatifs, c'est un
    // artefact de division. Le coût arithmétique de chaque opération croît donc avec l'historique.
    expect(large.maxDecimals).toBeGreaterThan(1000);
  });

  it('sans cession, rien de tout cela : l’accumulation seule reste linéaire', () => {
    // La forme « DCA pur » ne déclenche aucun parcours de lots. Le coût vient des CESSIONS, pas de
    // la taille du portefeuille — distinction que le banc d'essai chiffre en millisecondes.
    expect(measure(accumulation(600)).consumptions).toBe(0);
    expect(measure(accumulation(1200)).consumptions).toBe(0);
  });
});
