/**
 * Registre des espaces de l'application (proposition v2, § 6.0) : la navigation principale, le
 * retour de la barre d'application et l'accent visuel en découlent. Un futur module (Rendement,
 * Fiscal, On-chain…) se déclare ici sans toucher aux autres espaces.
 */
import type { Route, RouteName } from './router.svelte';

export type SpaceId = 'overview' | 'invest' | 'wealth' | 'trading' | 'more';

export interface Space {
  id: SpaceId;
  /** Libellé de navigation (icône + texte, jamais la couleur seule). */
  label: string;
  home: Route;
  /** Libellé du lien de retour de la barre d'application vers `home`. */
  backLabel: string;
  routes: readonly RouteName[];
}

export const SPACES: readonly Space[] = [
  {
    id: 'overview',
    label: "Vue d'ensemble",
    home: { name: 'overview' },
    backLabel: "Retour à la vue d'ensemble",
    routes: ['overview', 'welcome', 'netWorthReport'],
  },
  {
    id: 'invest',
    label: 'Investissement',
    home: { name: 'portfolio' },
    backLabel: 'Retour au portefeuille',
    routes: ['portfolio', 'titles', 'asset', 'import', 'add', 'report', 'secondOpinion', 'alerts'],
  },
  {
    id: 'wealth',
    // « Patrimoine » est réservé au TOTAL consolidé depuis que le rapport du même nom existe :
    // il y affichait « Patrimoine : aucune donnée » au milieu d'un document intitulé « Rapport
    // de patrimoine », dont le total s’appelle lui aussi « Patrimoine ». L’identifiant `wealth`
    // et le hash `#/wealth` ne changent pas — un identifiant n'est pas un libellé, et un lien
    // partagé ne se casse pas pour un mot.
    label: 'Prêts',
    home: { name: 'loans' },
    backLabel: 'Retour aux prêts',
    routes: ['loans'],
  },
  {
    id: 'trading',
    label: 'Trading',
    home: { name: 'trading' },
    backLabel: 'Retour au trading',
    routes: ['trading', 'trades', 'trade', 'tradeAdd', 'tradeStats', 'tradeBreakeven', 'fills'],
  },
  {
    id: 'more',
    label: 'Plus',
    home: { name: 'more' },
    backLabel: 'Retour au menu',
    routes: [
      'more',
      'market',
      'watch',
      'declaration',
      'taxes',
      'accounts',
      'reconciliation',
      'settings',
      'help',
      'news',
      'privacy',
    ],
  },
];

/** Espace d'une route ; la Vue d'ensemble par défaut. */
export function spaceOf(name: RouteName): Space {
  return SPACES.find((s) => s.routes.includes(name)) ?? SPACES[0]!;
}

/**
 * Espace d'un producteur de la courbe de patrimoine (`history/net-worth.ts`).
 *
 * Trois endroits de la Vue d'ensemble en décidaient chacun de son côté : le lien, la bordure de la
 * légende, et la couleur de la barre de répartition. Les deux premiers ont été corrigés (décision
 * n° 117) ; **le troisième ne l'avait jamais été** — les Prêts s'y peignaient dans la couleur du
 * trading tout en portant la bordure de l'investissement, faute de règle dédiée. La même chose
 * montrée de deux façons : exactement ce qu'une norme de notation interdit.
 *
 * Le repli sur `trading` est voulu : les comptes de trading sont les seuls producteurs dont
 * l'identifiant est celui du compte, donc inconnu d'avance. Cette reconnaissance par chaîne reste
 * **provisoire** — P116 la remplacera par un champ porté par le producteur lui-même, plutôt que
 * devinée à la lecture d'un identifiant.
 */
const PRODUCER_SPACES: Readonly<Record<string, SpaceId>> = {
  invest: 'invest',
  lending: 'wealth',
};

export function spaceOfProducer(id: string): SpaceId {
  return PRODUCER_SPACES[id] ?? 'trading';
}
