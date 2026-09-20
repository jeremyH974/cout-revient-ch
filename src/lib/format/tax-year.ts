/**
 * Le vocabulaire de l'année fiscale — **un seul**, pour les trois écrans et pour le PDF.
 *
 * ## Le défaut que ce module existe pour corriger
 *
 * Trois écrans nommaient la même chose de trois façons : « Année déclarée » au Rapport et à la
 * Déclaration, « Année » aux Impôts — seul ce dernier disant ce que l'année a de particulier.
 * « Année déclarée 2026 » se lit de deux manières opposées : *l'année qu'on déclare* (2026, celle
 * qui court) ou *l'année où l'on déclare* (2026, donc les revenus 2025). Les deux lectures sont
 * défendables, et c'est exactement ce qui rend l'étiquette inutilisable — elle a fait chercher à
 * un utilisateur une année « 2027 » qui ne pouvait pas exister, alors que l'année en cours était
 * déjà sélectionnée sous ses yeux.
 *
 * La règle retenue : **le sélecteur porte l'année décrite, et rien ne se devine.** Le libellé est
 * donc le plus neutre possible — « Année » — et la phrase qui suit dit trois choses qu'aucune
 * étiquette ne peut porter seule : dans quel état est cette année, ce que cet état implique, et
 * le printemps où elle se déclare. C'est la règle **UNIFY** d'ISO 24896:2026 (notation pour le
 * reporting d'entreprise, publiée le 11/06/2026) : même signification, même apparence.
 *
 * ## Pourquoi « elle se déclare » et non « à déclarer »
 *
 * L'écran Impôts écrivait « À déclarer au printemps 2025 » quelle que soit l'année choisie. Sur
 * une année close depuis longtemps, cet impératif décrit une échéance passée comme si elle était
 * à venir. « Elle se déclare au printemps 2025 » énonce un fait de calendrier, vrai hier comme
 * demain, et n'oblige pas ce module à savoir où en est la campagne déclarative.
 *
 * ## Ce que ce module ne fait pas
 *
 * Il ne lit **aucune opération** : l'état d'une année se lit sur le seul calendrier (`yearStatus`).
 * Ce qui reste ouvert *dans les chiffres* d'une année en cours — le seuil de 305 €, la poche
 * d'imputation — est l'affaire de `yearOutlook`, qui a besoin du grand livre. Et il n'a pas
 * d'horloge : `today` est un paramètre, comme partout dans les modules purs de ce dépôt.
 */
import { yearStatus, type TaxYearState } from '../derive/tax-outlook';

/** Les trois morceaux de la phrase, plus la phrase entière. Rendus une fois, affichés partout. */
export interface TaxYearWording {
  /**
   * L'état, ponctuation comprise : c'est le morceau mis en avant à l'écran (`<strong>`). Il porte
   * son point final pour que le composant n'ait pas à en ajouter un — une ponctuation recollée au
   * rendu est le genre de détail qui diverge entre deux écrans.
   */
  state: string;
  /** Ce que l'état implique, en une phrase. */
  detail: string;
  /** Le printemps où cette année se déclare. */
  filing: string;
  /** Les trois bout à bout : ce que lit le PDF, détaché de l'écran qui l'a produit. */
  note: string;
}

/** L'état, tel qu'il s'annonce. Le point final en fait partie (voir `TaxYearWording.state`). */
const STATE_LABEL: Record<TaxYearState, string> = {
  'in-progress': 'Année en cours — provisoire.',
  future: 'Année à venir.',
  closed: 'Année close.',
};

/** Ce que l'état implique. Un constat de calendrier, jamais une consigne. */
const STATE_DETAIL: Record<TaxYearState, string> = {
  'in-progress': 'Tout peut encore bouger d’ici le 31 décembre.',
  future: 'Rien ne s’y est encore passé.',
  closed: 'Son résultat ne bougera plus.',
};

/**
 * Le libellé du sélecteur d'année — le même sur les trois écrans.
 *
 * « Année » et rien d'autre : tout qualificatif ajouté (« déclarée », « fiscale », « d'imposition »)
 * rouvre l'ambiguïté que ce module ferme. Ce que l'année recouvre sur un écran donné se dit dans
 * la phrase d'état, ou dans le `hint` du composant quand elle ne pilote qu'une partie de l'écran.
 */
export const TAX_YEAR_LABEL = 'Année';

/** L'année décrite, telle qu'elle s'annonce à l'écran et dans le PDF. `today` au format AAAA-MM-JJ. */
export function taxYearWording(year: number, today: string): TaxYearWording {
  const { state, declaredIn } = yearStatus(year, today);
  const filing = `Elle se déclare au printemps ${declaredIn}.`;
  const label = STATE_LABEL[state];
  const detail = STATE_DETAIL[state];
  return { state: label, detail, filing, note: `${label} ${detail} ${filing}` };
}
