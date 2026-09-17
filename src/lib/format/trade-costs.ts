/**
 * Les phrases de la carte « Frais et seuil de rentabilité » de la fiche d'un trade (décision
 * n° 158). Le moteur (`domain/trading/costs.ts`) rend des ratios signés ; ce module les dit dans
 * le sens du trade — un short gagne quand le prix **baisse** — et nomme l'hypothèse quand il y en a
 * une. Isolé ici pour être testé : une phrase qui inverse « monter » et « baisser » sur un short
 * ferait lire l'inverse de ce que les chiffres disent.
 */
import { ZERO, parseDecimal, type Big } from '../domain/money';
import type { CostsUnavailable, TradeCosts } from '../domain/trading/costs';
import type { RoundTrip } from '../domain/trading/round-trips';
import { fmtPrice, fmtSmallPct, roundHalfUp } from './fr';

type TripFacts = Pick<RoundTrip, 'direction' | 'status' | 'symbol'>;

/** Verbe du mouvement favorable, à l'infinitif. */
const favorable = (trip: TripFacts): string => (trip.direction === 'long' ? 'monter' : 'baisser');

/** Côté du point mort où la sortie gagne : au-dessus pour un long, sous lui pour un short. */
const winningSide = (trip: TripFacts): string =>
  trip.direction === 'long' ? 'au-dessus de' : 'sous';

/** Ce que le prix a fait, dit dans le sens du marché : `move` est favorable au trade s'il est > 0. */
function pastMove(trip: TripFacts, move: Big): string {
  if (move.eq(ZERO)) return "n'a pas bougé";
  const rose = move.gt(ZERO) === (trip.direction === 'long');
  return `${rose ? 'est monté' : 'a baissé'} de ${fmtSmallPct(move.abs())}`;
}

const perUnit = (distance: Big, trip: TripFacts): string =>
  `${fmtPrice(distance.abs(), 'USD')} par ${trip.symbol}`;

/**
 * La phrase du seuil, ou `null` s'il manque. Un seuil négatif n'est pas une erreur : c'est un trade
 * dont le funding (et, ouvert, le gain déjà réalisé) payait déjà les frais — la phrase le dit au
 * lieu d'annoncer un « mouvement nécessaire » négatif, qui ne se lit pas.
 */
export function breakevenSentence(trip: TripFacts, costs: TradeCosts): string | null {
  const { breakevenMove: move, breakevenDistance: distance, breakevenPrice: price } = costs;
  if (move === null || distance === null || price === null) return null;
  const exit = `${winningSide(trip)} ${fmtPrice(price, 'USD')}`;

  if (trip.status === 'closed') {
    const captured = costs.capturedMove;
    const after = (subject: string): string =>
      captured === null ? '' : ` ; ${subject} ${pastMove(trip, captured)}`;
    if (!move.gt(ZERO))
      return `Le funding reçu couvrait déjà les frais : toute sortie ${exit} était gagnante${after('le prix')}.`;
    return (
      `Le prix devait ${favorable(trip)} de ${fmtSmallPct(move)} (${perUnit(distance, trip)}, ` +
      `soit une sortie ${exit}) pour couvrir les frais et le funding${after('il')}.`
    );
  }

  const assumption =
    costs.assumedExitRate === null
      ? ''
      : `, en supposant des frais de sortie au taux moyen du trade jusqu'ici (${fmtSmallPct(costs.assumedExitRate)})`;
  if (!move.gt(ZERO))
    return `Le gain déjà réalisé et le funding couvrent les frais : toute sortie ${exit} reste gagnante${assumption}.`;
  return (
    `Pour sortir sans perte, frais et funding compris, le prix doit ${favorable(trip)} ` +
    `d'au moins ${fmtSmallPct(move)} ` +
    `depuis l'entrée moyenne (${perUnit(distance, trip)}) : point mort à ` +
    `${fmtPrice(price, 'USD')}${assumption}.`
  );
}

/** « 3 exécutions, toutes taker » ; « 5 exécutions : 3 taker, 2 maker » ; `null` sans exécution. */
export function rolesSentence(costs: Pick<TradeCosts, 'makerFills' | 'takerFills'>): string | null {
  const { makerFills: maker, takerFills: taker } = costs;
  const total = maker + taker;
  if (total === 0) return null;
  const count = `${total} exécution${total > 1 ? 's' : ''}`;
  if (maker === 0) return total === 1 ? `${count}, taker` : `${count}, toutes taker`;
  if (taker === 0) return total === 1 ? `${count}, maker` : `${count}, toutes maker`;
  return `${count} : ${taker} taker, ${maker} maker`;
}

/** Pourquoi la carte n'affiche pas de seuil. */
export function unavailableSentence(reason: CostsUnavailable): string {
  return reason === 'incomplete'
    ? "Historique partiel : l'entrée de ce trade est inconnue, son seuil de rentabilité ne peut pas être calculé."
    : "Une partie des frais a été payée dans un autre jeton, que l'application ne valorise pas : la part des frais et le seuil seraient sous-estimés, ils ne sont donc pas affichés.";
}

// --- Onglet « Seuil » : champs saisis à la française, et leur pré-remplissage -------------------

/**
 * Nombre saisi à la française — « 0,035 », « 65 000 », « 65000.5 », « -0,003 » : espaces (même
 * insécables) retirés, une virgule décimale acceptée. `null` pour tout le reste, jamais un zéro.
 */
export function parseFrDecimal(text: string): Big | null {
  return parseDecimal(text.replace(/[\s\u00a0\u202f]/g, '').replace(',', '.'));
}

/** Un taux saisi en pourcent (« 0,035 ») → fraction (0,00035) ; `null` si illisible. */
export function parseRateInput(text: string): Big | null {
  return parseFrDecimal(text)?.div('100') ?? null;
}

/** Au-delà, le tableau ne tient plus sur un écran de téléphone, même en défilant. */
export const MAX_SIZES = 6;

/**
 * Liste de tailles : séparées par des espaces ou des points-virgules (« 10 20 30 », « 0,5 ; 1,5 »).
 * La virgule étant décimale en français, une **seule** virgule dans un morceau reste une décimale
 * (« 0,5 ») ; plusieurs en font une liste (« 10,20,30 »), et une virgule finale (« 10, 20 ») est
 * un séparateur. Tailles strictement positives, sans doublon, dans l'ordre saisi.
 */
export function parseSizeList(text: string): Big[] {
  const sizes: Big[] = [];
  for (const token of text.split(/[\s;]+/)) {
    const commas = token.split(',').length - 1;
    const parts = commas > 1 ? token.split(',') : [token.replace(/,$/, '')];
    for (const part of parts) {
      const value = parseFrDecimal(part);
      if (value === null || !value.gt(ZERO) || sizes.some((s) => s.eq(value))) continue;
      sizes.push(value);
      if (sizes.length === MAX_SIZES) return sizes;
    }
  }
  return sizes;
}

/** Nombre → texte de champ, virgule décimale, sans séparateur de milliers (qui le rendrait illisible). */
const inputText = (value: Big, dp: number): string =>
  roundHalfUp(value, dp).toString().replace('.', ',');

/** Taux (fraction) → pourcent à saisir : 0,00035 → « 0,035 ». Vide s'il est inconnu. */
export const rateInputText = (rate: Big | null): string =>
  rate === null ? '' : inputText(rate.times('100'), 4);

/** Prix → texte de champ : deux décimales au-dessus de 1, huit en dessous (jetons à petit prix). */
export const priceInputText = (price: Big | null): string =>
  price === null ? '' : inputText(price, price.abs().gte('1') ? 2 : 8);

/** Quantité → texte de champ, sans perte : les quantités de la plateforme ont au plus 8 décimales. */
export const qtyInputText = (qty: Big): string => inputText(qty, 8);
