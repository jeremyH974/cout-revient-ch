/**
 * Le chronomètre, à la demande — hors CI (décision n° 85).
 *
 *     npm run bench
 *
 * Vitest ne ramasse que `*.test.ts` : ce fichier n'allonge pas la CI d'une seconde. Il existe pour
 * répondre à la question que le garde-fou déterministe ne pose pas — **à partir de combien
 * d'opérations l'outil cesse-t-il d'être utilisable ?** — et la réponse a surpris : elle se compte
 * en centaines, pas en dizaines de milliers.
 *
 * Les deux formes sont mesurées séparément parce qu'elles ne relèvent pas de la même complexité.
 * Confondre « un gros portefeuille » et « un portefeuille très mouvementé » ferait dire n'importe
 * quoi à la mesure : le premier est linéaire, le second cubique.
 */
import { bench, describe } from 'vitest';
import { runLedger } from '../../src/lib/domain/engine/compute';
import { DEFAULT_ENGINE_SETTINGS } from '../../src/lib/domain/types';
import { accumulation, roundTrip } from './scenario';

/** Assez d'itérations pour une moyenne, jamais assez pour attendre. */
const quick = { warmupIterations: 1, iterations: 5 } as const;
/** Les tailles douloureuses : une passe suffit, elle dure déjà des secondes. */
const once = { warmupIterations: 0, iterations: 1, time: 0 } as const;

describe('accumulation (DCA pur, aucune cession) — attendu linéaire', () => {
  for (const n of [1_000, 10_000, 50_000]) {
    const events = accumulation(n);
    bench(`${n} opérations`, () => void runLedger(events, DEFAULT_ENGINE_SETTINGS), quick);
  }
});

describe('aller-retour (achats et cessions partielles alternés) — mesuré cubique', () => {
  for (const n of [50, 100, 200]) {
    const events = roundTrip(n);
    bench(`${n} opérations`, () => void runLedger(events, DEFAULT_ENGINE_SETTINGS), quick);
  }
  // 800 épuise le tas de Node (worker tué) : la mesure s'arrête à la dernière taille calculable.
  for (const n of [400]) {
    const events = roundTrip(n);
    bench(`${n} opérations`, () => void runLedger(events, DEFAULT_ENGINE_SETTINGS), once);
  }
});
