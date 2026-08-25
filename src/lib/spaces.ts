/**
 * Registre des espaces de l'application (proposition v2, § 6.0) : la navigation principale, le
 * retour de la barre d'application et l'accent visuel en découlent. Un futur module (Rendement,
 * Fiscal, On-chain…) se déclare ici sans toucher aux autres espaces.
 */
import type { Route, RouteName } from './router.svelte';

export type SpaceId = 'overview' | 'invest' | 'trading' | 'more';

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
    routes: ['overview', 'welcome'],
  },
  {
    id: 'invest',
    label: 'Investissement',
    home: { name: 'portfolio' },
    backLabel: 'Retour au portefeuille',
    routes: ['portfolio', 'asset', 'import', 'add', 'report', 'alerts'],
  },
  {
    id: 'trading',
    label: 'Trading',
    home: { name: 'trading' },
    backLabel: 'Retour au trading',
    routes: ['trading', 'trades', 'trade', 'tradeAdd', 'tradeStats', 'fills'],
  },
  {
    id: 'more',
    label: 'Plus',
    home: { name: 'more' },
    backLabel: 'Retour au menu',
    routes: ['more', 'accounts', 'settings', 'help', 'news', 'privacy'],
  },
];

/** Espace d'une route ; la Vue d'ensemble par défaut. */
export function spaceOf(name: RouteName): Space {
  return SPACES.find((s) => s.routes.includes(name)) ?? SPACES[0]!;
}
