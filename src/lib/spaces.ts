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
    routes: ['loans', 'loansReport'],
  },
  {
    id: 'trading',
    label: 'Trading',
    home: { name: 'trading' },
    backLabel: 'Retour au trading',
    routes: [
      'trading',
      'trades',
      'trade',
      'tradeAdd',
      'tradeStats',
      'tradeBreakeven',
      'fills',
      'tradingReport',
    ],
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
 * Un espace par son identifiant. Il remplace les deux tables qui devinaient, à la lecture d'un
 * identifiant de producteur, sa couleur et sa destination (`spaceOfProducer` et le `HREF_OF` de la
 * Vue d'ensemble) : depuis la décision n° 178, le producteur porte son espace, et tout en découle.
 */
export function spaceById(id: SpaceId): Space {
  const space = SPACES.find((s) => s.id === id);
  if (space === undefined) throw new Error(`Espace inconnu : ${id}`);
  return space;
}
