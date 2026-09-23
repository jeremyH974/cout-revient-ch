/**
 * Faut-il replier les sections de Réglages à l'ouverture de la page ?
 *
 * **Seulement sur un petit écran** (décision n° 185). C'est là que la page faisait huit hauteurs
 * d'écran, et c'est le défaut qu'on voulait corriger. Sur un écran large, replier ajouterait un
 * geste à CHAQUE parcours qui passe par les réglages — coffre, sauvegarde, chiffrement, exports,
 * sources de prix, méthode de calcul — sans rien faire gagner : la douzaine de tests de bout en
 * bout qui traversent ces écrans l'a montré d'un coup, et un utilisateur l'aurait ressenti pareil.
 *
 * Lu **une seule fois**, à la construction du composant, jamais en réaction au redimensionnement :
 * une section que l'utilisateur vient d'ouvrir ne doit pas se refermer sous ses doigts parce qu'il
 * a tourné son téléphone ou réduit sa fenêtre.
 */
export const NARROW_QUERY = '(max-width: 767px)';

export function collapsedByDefault(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.(NARROW_QUERY)?.matches === true;
}
