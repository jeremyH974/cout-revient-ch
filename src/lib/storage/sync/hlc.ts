/**
 * Horloge logique hybride (HLC — Kulkarni & Demirbas, 2014) : un compteur qui reste proche de
 * l'heure murale quand les appareils sont d'accord, et qui s'en détache juste assez pour rester
 * strictement croissant quand ils ne le sont pas.
 *
 * Sérialisée en chaîne TRIABLE LEXICOGRAPHIQUEMENT (comparaison de chaînes = comparaison voulue) :
 * `<ms sur 13 chiffres>.<compteur sur 4 chiffres>.<deviceId>`. `''` = « hérité » : plus petit que
 * toute horloge réelle, une chaîne vide étant un préfixe strict de toute chaîne non vide en
 * JavaScript (`'' < '0000000000001.0000.d'` est vrai).
 *
 * Comparaison volontairement en `<`/`>` simples, jamais `localeCompare` (décision n° 81 de ce
 * dépôt : les deux ordres divergent sur la casse, `'a'.localeCompare('A')` rendant -1 quand
 * `'a' < 'A'` est faux). Elle est exacte ici car les segments temporels sont des chiffres à largeur
 * FIXE et l'identifiant d'appareil un UUID (hexadécimal et tirets, jamais de lettre dont la casse
 * varie) : l'ordre lexicographique simple coïncide avec l'ordre numérique voulu, sans dépendre
 * d'aucune locale.
 */

const MS_DIGITS = 13;
const COUNTER_DIGITS = 4;
const COUNTER_OVERFLOW = 10 ** COUNTER_DIGITS;
const HLC_RE = /^(\d{13})\.(\d{4})\.(.+)$/;

export interface ParsedHlc {
  wallMs: number;
  counter: number;
  deviceId: string;
}

/** `null` pour `''` (hérité) ou une chaîne mal formée — jamais une exception. */
export function parseHlc(clock: string): ParsedHlc | null {
  if (clock === '') return null;
  const m = HLC_RE.exec(clock);
  if (!m) return null;
  return { wallMs: Number(m[1]), counter: Number(m[2]), deviceId: m[3]! };
}

const pad = (n: number, width: number): string => String(n).padStart(width, '0');

/**
 * Prochaine horloge émise par CET appareil.
 *
 * `clock` doit déjà porter le maximum de tout ce qui a été vu : appeler `hlcMax(local, distante)`
 * avant `hlcTick` garantit qu'un décalage d'horloge entre appareils ne fait jamais perdre une
 * édition postérieure à une fusion — le prochain tick local est alors strictement plus grand que
 * tout ce que cet appareil a observé, y compris ce qui vient d'ailleurs.
 *
 * Règle HLC : le mur logique est `max(heure murale actuelle, mur de la dernière horloge vue)` ;
 * le compteur repart de zéro si le mur a avancé, sinon il s'incrémente — c'est ce second cas qui
 * distingue plusieurs écritures survenues à la même milliseconde (ou une horloge système qui
 * n'avance pas assez vite). En cas de débordement du compteur (plusieurs milliers d'écritures dans
 * la même milliseconde logique — un gros import peut dater des milliers de qualifications d'un
 * coup), le mur avance d'une unité et le compteur repart de zéro plutôt que de déborder sur un
 * cinquième chiffre, ce qui casserait la largeur fixe dont dépend le tri lexicographique.
 */
export function hlcTick(clock: string, wallNowMs: number, deviceId: string): string {
  const prev = parseHlc(clock);
  const prevWall = prev?.wallMs ?? 0;
  let wall = Math.max(wallNowMs, prevWall);
  let counter = wall === prevWall ? (prev?.counter ?? -1) + 1 : 0;
  if (counter >= COUNTER_OVERFLOW) {
    wall += 1;
    counter = 0;
  }
  return `${pad(wall, MS_DIGITS)}.${pad(counter, COUNTER_DIGITS)}.${deviceId}`;
}

/** Comparaison triable : négatif si `a` est antérieure à `b`, positif si postérieure, 0 à égalité. */
export function hlcCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** La plus grande des deux horloges (chaîne triable ⇒ comparaison directe). */
export function hlcMax(a: string, b: string): string {
  return hlcCompare(a, b) >= 0 ? a : b;
}
