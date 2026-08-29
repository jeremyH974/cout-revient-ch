/**
 * Rendu français des déclarations 3916-bis (décision n° 40, P66). Le moteur
 * (`src/lib/domain/declarations-fr.ts`) classe chaque compte en un STATUT codé, sans un mot de
 * français ; c'est ici — et seulement ici — qu'il devient une phrase.
 *
 * Rappel intangible, comme pour les constats : ceci AIDE au report, ce n'est ni une déclaration, ni
 * un conseil fiscal. La formulation exacte des enjeux (montants de sanction, cas de l'auto-hébergé)
 * est fixée une fois ici pour ne jamais diverger entre l'écran Comptes, le rapport et l'export.
 */
import type { AccountDeclaration, DeclarationStatus } from '../domain/declarations-fr';
import type { AccountId, CountryCode } from '../domain/types';

/**
 * Sous-ensemble PRATIQUE de l'ISO 3166-1 alpha-2 : les juridictions des plateformes réellement
 * rencontrées par les utilisateurs de l'app (Union européenne/EEE au complet, plus les principales
 * places non européennes). Volontairement non exhaustif — un code absent s'affiche tel quel plutôt
 * que d'inventer un nom : ne jamais deviner reste la règle, y compris ici.
 */
export const COUNTRY_NAMES: Readonly<Record<string, string>> = {
  FR: 'France',
  DE: 'Allemagne',
  AT: 'Autriche',
  BE: 'Belgique',
  NL: 'Pays-Bas',
  LU: 'Luxembourg',
  IE: 'Irlande',
  ES: 'Espagne',
  PT: 'Portugal',
  IT: 'Italie',
  MT: 'Malte',
  CY: 'Chypre',
  GR: 'Grèce',
  PL: 'Pologne',
  CZ: 'Tchéquie',
  SK: 'Slovaquie',
  HU: 'Hongrie',
  SI: 'Slovénie',
  HR: 'Croatie',
  RO: 'Roumanie',
  BG: 'Bulgarie',
  EE: 'Estonie',
  LV: 'Lettonie',
  LT: 'Lituanie',
  FI: 'Finlande',
  SE: 'Suède',
  DK: 'Danemark',
  IS: 'Islande',
  NO: 'Norvège',
  LI: 'Liechtenstein',
  CH: 'Suisse',
  GB: 'Royaume-Uni',
  MC: 'Monaco',
  AD: 'Andorre',
  US: 'États-Unis',
  CA: 'Canada',
  MX: 'Mexique',
  BR: 'Brésil',
  AR: 'Argentine',
  SG: 'Singapour',
  HK: 'Hong Kong',
  JP: 'Japon',
  KR: 'Corée du Sud',
  CN: 'Chine',
  IN: 'Inde',
  AE: 'Émirats arabes unis',
  SA: 'Arabie saoudite',
  IL: 'Israël',
  TR: 'Turquie',
  AU: 'Australie',
  NZ: 'Nouvelle-Zélande',
  ZA: 'Afrique du Sud',
  KY: 'Îles Caïmans',
  BM: 'Bermudes',
  BS: 'Bahamas',
  VG: 'Îles Vierges britanniques',
  SC: 'Seychelles',
  MU: 'Maurice',
};

/** Nom français d'un pays connu ; le code lui-même si la table ne le couvre pas (jamais deviné). */
export function countryName(code: CountryCode): string {
  return COUNTRY_NAMES[code] ?? code;
}

/** Options triées par nom, pour un sélecteur de pays — `FR` en tête (le cas le plus fréquent à corriger). */
export const COUNTRY_OPTIONS: readonly { code: string; name: string }[] = [
  { code: 'FR', name: COUNTRY_NAMES['FR']! },
  ...Object.entries(COUNTRY_NAMES)
    .filter(([code]) => code !== 'FR')
    .map(([code, name]) => ({ code, name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr')),
];

export const STATUS_LABELS: Record<DeclarationStatus, string> = {
  'excluded-domestic': 'Hors périmètre (France)',
  included: 'À déclarer (3916-bis)',
  'uncertain-self-hosted': 'Incertain (clé détenue seul)',
  unknown: 'Pays à préciser',
};

export interface RenderedDeclaration {
  accountId: AccountId;
  accountLabel: string;
  status: DeclarationStatus;
  statusLabel: string;
  /** Phrase complète, sans le nom du compte (déjà porté par `accountLabel` à côté). */
  detail: string;
}

/**
 * Une phrase par statut. Le `switch` est exhaustif : ajouter un statut au moteur sans écrire sa
 * phrase ici est une ERREUR DE COMPILATION, jamais un texte vide à l'écran (même principe que
 * `src/lib/format/insights.ts`).
 */
function textOf(d: AccountDeclaration): string {
  switch (d.status) {
    case 'excluded-domestic':
      return 'Organisme établi en France : hors périmètre du formulaire 3916-bis.';
    case 'included': {
      const country = d.country ? countryName(d.country) : 'à l’étranger';
      const state = d.currentlyHolds ? 'actuellement détenu' : 'actuellement vide';
      const used = d.usedInYear ? ', utilisé cette année' : '';
      const closed = d.possiblyClosedInYear ? ', peut-être clos cette année' : '';
      return `Organisme établi à l’étranger (${country}) : ${state}${used}${closed} — à déclarer au formulaire 3916-bis, même vide ou clos.`;
    }
    case 'uncertain-self-hosted':
      return 'Portefeuille dont vous détenez seul la clé : le texte ne tranche pas ce cas — vérifiez avec un professionnel.';
    case 'unknown':
      return 'Pays de l’organisme inconnu : précisez-le pour savoir si ce compte doit être déclaré.';
    default: {
      // Exhaustivité : un statut sans phrase ne compile pas.
      const missing: never = d.status;
      throw new Error(`Statut sans texte : ${String(missing)}`);
    }
  }
}

export function renderDeclaration(d: AccountDeclaration): RenderedDeclaration {
  return {
    accountId: d.accountId,
    accountLabel: d.label,
    status: d.status,
    statusLabel: STATUS_LABELS[d.status],
    detail: textOf(d),
  };
}

export function renderDeclarations(list: readonly AccountDeclaration[]): RenderedDeclaration[] {
  return list.map(renderDeclaration);
}

/** Une ligne par compte : presse-papier et résumé collable dans une IA (motif `insightsToText`). */
export function declarationsToText(list: readonly RenderedDeclaration[]): string {
  return list.map((d) => `- ${d.accountLabel} — ${d.statusLabel} : ${d.detail}`).join('\n');
}
