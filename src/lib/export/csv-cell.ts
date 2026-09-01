/**
 * Une cellule de CSV **destiné à un tableur**, échappée et désarmée.
 *
 * Excel et LibreOffice interprètent comme une **formule** toute cellule dont la valeur commence par
 * `=`, `+`, `-` ou `@`. Ce n'est pas une curiosité : le fichier n'a pas besoin d'être ouvert d'une
 * manière particulière, il suffit de double-cliquer dessus — et le README de ce projet dit
 * explicitement d'ouvrir les exports dans Excel.
 *
 * Ce qui transite ici n'est pas sous notre contrôle : des **libellés de comptes** saisis librement,
 * des **symboles d'actifs** venus d'imports tiers (format pivot, Ghostfolio, convertisseurs), et
 * dans `trades-csv.ts` le **journal entier** — setup, tags, erreurs, thèse, revue. Une note écrite
 * par soi-même, ou un fichier importé d'ailleurs, ressort dans un CSV qu'on ouvre dans un tableur.
 *
 * **La distinction qui compte, et qui n'est pas ici.** `koinly-csv.ts` a délibérément sa **propre**
 * fonction de mise entre guillemets et n'utilise pas celle-ci : son fichier est destiné à être
 * **réimporté** par Koinly ou Waltio, jamais lu par un humain dans un tableur. Y préfixer quoi que
 * ce soit corromprait la donnée chez le destinataire et casserait les propriétés d'aller-retour.
 * Un export pour tableur désarme les formules ; un export pour machine ne touche à rien
 * (décision n° 76).
 */

/**
 * Caractères qui, **en première position**, font d'une cellule une formule.
 *
 * `=`, `+`, `-` et `@` sont les quatre amorces reconnues par les tableurs. La tabulation et le
 * retour chariot s'y ajoutent parce qu'un tableur les traite comme des séparateurs : ils permettent
 * de terminer la cellule courante et de faire commencer la suivante par `=`.
 */
export const FORMULA_STARTERS = ['=', '+', '-', '@', '\t', '\r'] as const;

/** Ce qu'on préfixe pour désarmer. Voir `docs/exports.md` : cette apostrophe est visible. */
const GUARD = "'";

/**
 * Rend une cellule CSV : guillemets échappés, formule désarmée.
 *
 * La valeur n'est jamais tronquée ni réécrite — seulement préfixée, et seulement quand elle
 * commence par un caractère d'amorce. Une valeur ordinaire ressort telle quelle.
 */
export function textCell(value: string): string {
  const armed = (FORMULA_STARTERS as readonly string[]).includes(value.slice(0, 1));
  const guarded = armed ? `${GUARD}${value}` : value;
  return `"${guarded.replace(/"/g, '""')}"`;
}
