/**
 * Faut-il proposer le coffre, et sinon pourquoi (décision n° 145).
 *
 * Le chiffrement au repos existe depuis la décision n° 120 et sert à **tous** les utilisateurs, pas
 * seulement à la variante personnelle : `VaultSection` est rendu par `Settings.svelte` sans aucun
 * garde `__PRIVATE_BUILD__`. Il est pourtant éteint par défaut et rangé dans un écran qu'on n'ouvre
 * pas — donc, en pratique, presque personne ne l'active et les données restent en clair.
 *
 * Ce module ne décide pas de cryptographie : il décide d'un **moment**. Trois raisons de se taire,
 * une seule de parler.
 *
 * - `installed` — c'est fait, il n'y a rien à proposer.
 * - `demo` — le jeu de démonstration est fictif (décision n° 14) : chiffrer du faux ne protège rien
 *   et dépense une décision que l'utilisateur devra reprendre sur ses vraies données.
 * - `no-data` — chiffrer un état vide ne protège rien non plus. Proposer à l'installation, avant
 *   le moindre import, c'est demander un mot de passe pour garder une pièce vide.
 * - `offer` — il y a de vraies données, elles sont en clair, et l'utilisateur vient de les voir
 *   s'afficher. C'est le seul moment où la question a un sens.
 *
 * **Pourquoi aucune date de rejet n'est mémorisée.** L'invite vit sur l'écran d'import, qu'on
 * ouvre délibérément et qu'on rouvre à chaque nouveau relevé. Elle revient donc d'elle-même, au
 * rythme des données à protéger, sans champ persisté ni migration de schéma — et sans jamais
 * s'imposer ailleurs. Une invite qui se répète à chaque écran s'use par habituation et finit
 * cliquée sans être lue ; celle-ci ne le peut pas.
 *
 * Module pur, sans Svelte ni DOM : la zone `.svelte` n'est mesurée par aucune couverture, cette
 * règle-ci l'est (même motif que `accounts.ts` et `qualified.ts`, décision n° 94).
 */

/** Ce que l'écran doit faire de l'invite au coffre. Une seule valeur l'affiche. */
export type VaultOffer = 'offer' | 'installed' | 'demo' | 'no-data';

export interface VaultOfferInput {
  /** Le coffre est-il déjà installé sur CET appareil ? (l'état vit dans le navigateur, pas dans un compte) */
  vaultInstalled: boolean;
  /** Mode démonstration : les chiffres affichés sont fictifs. */
  demoMode: boolean;
  /** L'utilisateur a-t-il des données à protéger ? */
  hasData: boolean;
}

/**
 * L'ordre des tests porte du sens et ne doit pas changer : un coffre installé prime sur tout le
 * reste (rien à proposer, même en démonstration), puis la démonstration prime sur l'absence de
 * données (le jeu de démonstration EN fournit, et c'est précisément pour ça qu'il faut l'écarter).
 */
export function vaultOffer(input: VaultOfferInput): VaultOffer {
  if (input.vaultInstalled) return 'installed';
  if (input.demoMode) return 'demo';
  if (!input.hasData) return 'no-data';
  return 'offer';
}
