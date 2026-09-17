/**
 * Ce qu'un aller-retour a coûté, et le mouvement de prix qu'il fallait pour le payer (décision
 * n° 158).
 *
 * Trois lectures d'un même trade, pour la question qu'un P&L net laisse ouverte — « combien les
 * frais m'ont-ils pris, et combien fallait-il gagner pour être rentable ? » :
 *
 * - la **part du brut partie en frais** ;
 * - le **seuil de rentabilité** : le mouvement de prix favorable, en fraction du prix d'entrée
 *   moyen, qui couvre les frais et le funding — et le **point mort**, le prix de sortie moyen qui
 *   l'atteint ;
 * - le **rôle de chaque exécution** : maker si l'ordre attendait dans le carnet, taker s'il l'a
 *   traversé, avec son taux de frais.
 *
 * Tout part des chiffres que `buildRoundTrips` tient déjà (brut = Σ `closedPnl`, frais, funding) :
 * rien n'est recalculé depuis les prix d'exécution. C'est ce qui empêche le seuil et le net affiché
 * de se contredire — sur un trade clos, le net est positif **si et seulement si** le mouvement
 * capté dépasse le seuil, les deux ratios partageant le même dénominateur. Un brut recalculé depuis
 * les prix moyens aurait donné un autre chiffre : la plateforme compte son `closedPnl` sur un prix
 * d'entrée arrondi à son pas de cotation.
 *
 * Et **avant** d'entrer, pour l'onglet « Seuil » : les taux réellement payés (`observedFeeRates`)
 * et le gain brut minimum d'un aller-retour hypothétique (`sizeBreakeven`).
 *
 * Pur, big.js seulement.
 */
import { D, ONE, ZERO, divOrNull, type Big } from '../money';
import type { NaiveDateTime } from '../types';
import type { RoundTrip } from './round-trips';
import type { Execution } from './types';

/** `taker` : l'ordre a traversé le carnet (tarif plein) ; `maker` : il y attendait (tarif réduit). */
export type LiquidityRole = 'maker' | 'taker';

export const roleOf = (x: Pick<Execution, 'crossed'>): LiquidityRole =>
  x.crossed ? 'taker' : 'maker';

/**
 * Exécutions consécutives d'un aller-retour qui partagent l'instant, le sens, le libellé, le rôle
 * et le statut de liquidation : les tranches d'un même ordre, regroupées comme la plateforme les
 * présente dans son historique. Un ordre qui traverse le carnet en trente tranches reste une ligne,
 * et l'écran se recoupe avec celui de la plateforme.
 */
export interface ExecutionLine {
  /** Identifiant de la première exécution du groupe (clé d'affichage). */
  id: string;
  at: NaiveDateTime;
  time: number;
  side: 'buy' | 'sell';
  /** Libellé de la plateforme (`Open Short`, `Close Long`, `Long > Short`…). */
  direction: string;
  role: LiquidityRole;
  liquidation: boolean;
  /** Nombre d'exécutions regroupées. */
  fills: number;
  /** Quantité revenant à CE trade — un retournement partage son exécution entre deux trades. */
  qty: Big;
  notional: Big;
  /** Prix moyen pondéré : `notional ÷ qty`. */
  price: Big;
  /** Frais en devise de cotation, négatifs pour un rebate ; au prorata sur un retournement. */
  fee: Big;
  /** Frais payés dans un autre jeton (ex. HYPE), par jeton — jamais valorisés. */
  feeNative: Record<string, Big>;
  /** `fee ÷ notional` ; `null` dès qu'une part des frais est payée dans un autre jeton. */
  feeRate: Big | null;
  /** Au moins une exécution du groupe est partagée avec l'aller-retour voisin (retournement). */
  shared: boolean;
}

interface Share {
  qty: Big;
  fee: Big;
  /** Part de la quantité de l'exécution : sert au prorata des frais payés dans un autre jeton. */
  ratio: Big;
  shared: boolean;
}

/**
 * Part d'une exécution qui revient à l'aller-retour de sens `direction`.
 *
 * Toute sa quantité, sauf sur un **retournement** : la plateforme y clôt une position et ouvre
 * l'autre dans le même fill. La règle est celle de `buildRoundTrips`, **au calcul près** — la
 * clôture prend `|startPosition|` et `frais × clôture ÷ quantité`, la réouverture le reste et
 * `frais − frais de clôture` —, pour que la somme des lignes retombe exactement sur les frais du
 * trade, sans l'écart d'une division arrondie différemment.
 */
function shareOf(x: Execution, direction: RoundTrip['direction']): Share {
  const qty = D(x.qty);
  const fee = D(x.fee);
  const start = D(x.startPosition);
  const whole: Share = { qty, fee, ratio: ONE, shared: false };
  // Position nulle, ou exécution dans le sens de la position : elle ouvre, en entier.
  if (start.eq(ZERO) || start.gt(ZERO) === (x.side === 'buy')) return whole;
  const closing = qty.lte(start.abs()) ? qty : start.abs();
  const remainder = qty.minus(closing);
  if (remainder.eq(ZERO)) return whole;
  const closingFee = fee.times(closing).div(qty);
  const closesThisTrip = start.gt(ZERO) === (direction === 'long');
  return closesThisTrip
    ? { qty: closing, fee: closingFee, ratio: closing.div(qty), shared: true }
    : { qty: remainder, fee: fee.minus(closingFee), ratio: remainder.div(qty), shared: true };
}

const continues = (line: ExecutionLine, x: Execution, role: LiquidityRole): boolean =>
  line.time === x.time &&
  line.side === x.side &&
  line.direction === x.direction &&
  line.role === role &&
  line.liquidation === x.liquidation;

/**
 * Lignes d'exécution d'un aller-retour, dans l'ordre où le moteur les a jouées. `executions` peut
 * contenir celles de tout le compte : seules celles du trade sont retenues, et un identifiant
 * introuvable (historique changé depuis) est ignoré plutôt que deviné. Un trade saisi à la main
 * n'a pas d'exécution, donc aucune ligne.
 */
export function executionLines(trip: RoundTrip, executions: readonly Execution[]): ExecutionLine[] {
  const byId = new Map<string, Execution>();
  for (const x of executions) byId.set(x.id, x);
  const lines: ExecutionLine[] = [];
  for (const id of trip.executionIds) {
    const x = byId.get(id);
    if (x === undefined) continue;
    const role = roleOf(x);
    const share = shareOf(x, trip.direction);
    const notional = share.qty.times(x.price);
    const last = lines.at(-1);
    const line: ExecutionLine =
      last !== undefined && continues(last, x, role)
        ? last
        : {
            id: x.id,
            at: x.at,
            time: x.time,
            side: x.side,
            direction: x.direction,
            role,
            liquidation: x.liquidation,
            fills: 0,
            qty: ZERO,
            notional: ZERO,
            price: ZERO,
            fee: ZERO,
            feeNative: {},
            feeRate: null,
            shared: false,
          };
    if (line !== last) lines.push(line);
    line.fills += 1;
    line.qty = line.qty.plus(share.qty);
    line.notional = line.notional.plus(notional);
    line.fee = line.fee.plus(share.fee);
    line.shared ||= share.shared;
    if (x.feeNative) {
      const paid = D(x.feeNative.qty).times(share.ratio);
      line.feeNative[x.feeNative.asset] = (line.feeNative[x.feeNative.asset] ?? ZERO).plus(paid);
    }
  }
  for (const line of lines) {
    line.price = divOrNull(line.notional, line.qty) ?? ZERO;
    line.feeRate =
      Object.keys(line.feeNative).length > 0 ? null : divOrNull(line.fee, line.notional);
  }
  return lines;
}

/**
 * Pourquoi le seuil manque : l'entrée du trade est inconnue (historique partiel), ou une part des
 * frais est payée dans un jeton que le moteur ne valorise pas — les ratios seraient alors
 * sous-estimés, et un seuil trop bas est pire que pas de seuil.
 */
export type CostsUnavailable = 'incomplete' | 'native-fees';

export interface TradeCosts {
  unavailable: CostsUnavailable | null;
  /** Frais ÷ brut : trade clos, brut et frais strictement positifs ; `null` sinon. */
  feeShareOfGross: Big | null;
  /** Frais ÷ volume échangé (notionnels d'entrée et de sortie) : le taux moyen payé. */
  averageFeeRate: Big | null;
  /**
   * Mouvement de prix favorable qui couvre frais et funding, en fraction du prix d'entrée moyen.
   * Négatif quand le funding reçu (et, sur une position ouverte, le gain déjà réalisé) dépasse les
   * frais : le trade restait gagnant même avec un léger mouvement contraire.
   */
  breakevenMove: Big | null;
  /** Le même mouvement, par unité d'actif, dans la devise de cotation. */
  breakevenDistance: Big | null;
  /** Prix de sortie moyen au point mort. */
  breakevenPrice: Big | null;
  /** Trade clos : brut ÷ notionnel d'entrée, le mouvement effectivement capté. */
  capturedMove: Big | null;
  /**
   * Position ouverte : taux de frais supposé pour la sortie, le taux moyen du trade jusqu'ici. Une
   * hypothèse, que l'écran doit nommer — rien ne dit que la sortie sera prise au même tarif.
   */
  assumedExitRate: Big | null;
  makerFills: number;
  takerFills: number;
}

/**
 * Seuil de rentabilité d'un aller-retour.
 *
 * **Trade clos.** Les frais sont connus et figés : le point mort est la sortie moyenne `X` qui
 * annule `brut(X) − frais + funding`, soit `X = entrée ± (frais − funding) ÷ quantité`. Le seuil
 * et le mouvement capté sont deux fractions du même notionnel d'entrée, ce qui rend leur
 * comparaison exacte.
 *
 * **Position ouverte.** La sortie n'a pas encore payé ses frais : on la suppose au taux moyen `r`
 * du trade, sur la quantité restante `q`, et `X` annule
 * `réalisé ± (X − entrée) × q − frais − r × X × q + funding`, d'où
 * `X = (entrée × q ± (frais − funding − réalisé)) ÷ (q × (1 ∓ r))` — le signe du haut pour un long.
 */
export function tradeCosts(trip: RoundTrip, lines: readonly ExecutionLine[]): TradeCosts {
  let makerFills = 0;
  let takerFills = 0;
  let nativeFees = false;
  for (const line of lines) {
    if (line.role === 'maker') makerFills += line.fills;
    else takerFills += line.fills;
    if (Object.keys(line.feeNative).length > 0) nativeFees = true;
  }
  const none: TradeCosts = {
    unavailable: null,
    feeShareOfGross: null,
    averageFeeRate: null,
    breakevenMove: null,
    breakevenDistance: null,
    breakevenPrice: null,
    capturedMove: null,
    assumedExitRate: null,
    makerFills,
    takerFills,
  };
  const entry = trip.avgEntry;
  if (trip.incomplete || entry === null) return { ...none, unavailable: 'incomplete' };
  if (nativeFees) return { ...none, unavailable: 'native-fees' };

  const sign = trip.direction === 'long' ? ONE : ONE.neg();
  const exitNotional = trip.avgExit === null ? ZERO : trip.avgExit.times(trip.qtyClosed);
  const averageFeeRate = divOrNull(trip.fees, entry.times(trip.qtyOpened).plus(exitNotional));

  if (trip.status === 'closed') {
    const toCover = trip.fees.minus(trip.funding);
    const entryNotional = entry.times(trip.qtyClosed);
    const distance = divOrNull(toCover, trip.qtyClosed);
    return {
      ...none,
      feeShareOfGross:
        trip.grossPnl.gt(ZERO) && trip.fees.gt(ZERO) ? trip.fees.div(trip.grossPnl) : null,
      averageFeeRate,
      breakevenMove: divOrNull(toCover, entryNotional),
      breakevenDistance: distance,
      breakevenPrice: distance === null ? null : entry.plus(sign.times(distance)),
      capturedMove: divOrNull(trip.grossPnl, entryNotional),
    };
  }

  const remaining = trip.qtyOpened.minus(trip.qtyClosed);
  if (averageFeeRate === null || !remaining.gt(ZERO)) return { ...none, averageFeeRate };
  const toCover = trip.fees.minus(trip.funding).minus(trip.grossPnl);
  const price = divOrNull(
    entry.times(remaining).plus(sign.times(toCover)),
    remaining.times(ONE.minus(sign.times(averageFeeRate))),
  );
  const distance = price === null ? null : sign.times(price.minus(entry));
  return {
    ...none,
    averageFeeRate,
    breakevenMove: distance === null ? null : divOrNull(distance, entry),
    breakevenDistance: distance,
    breakevenPrice: price,
    assumedExitRate: averageFeeRate,
  };
}

// --- Avant d'entrer : l'onglet « Seuil » -------------------------------------------------------

/**
 * Taux de frais réellement payés, par rôle : la **médiane** des `sample` exécutions perps les plus
 * récentes de chaque rôle, frais réglés dans la devise de cotation. Une médiane et non la dernière
 * exécution : un builder fee, un fill minuscule aux frais arrondis ou un rebate ponctuel feraient
 * sinon varier « le » taux d'un fill à l'autre. `null` faute d'exécution de ce rôle — jamais un
 * taux emprunté à une grille que l'application ne sait pas tenir à jour.
 */
export function observedFeeRates(
  executions: readonly Execution[],
  sample = 50,
): Record<LiquidityRole, Big | null> {
  const recent = executions
    .filter((x) => x.market === 'perp' && x.feeNative === null)
    .sort((a, b) => b.time - a.time);
  const median = (role: LiquidityRole): Big | null => {
    const rates: Big[] = [];
    for (const x of recent) {
      if (rates.length === sample) break;
      if (roleOf(x) !== role) continue;
      const notional = D(x.qty).times(x.price);
      if (notional.gt(ZERO)) rates.push(D(x.fee).div(notional));
    }
    if (rates.length === 0) return null;
    rates.sort((a, b) => a.cmp(b));
    const mid = Math.floor(rates.length / 2);
    return rates.length % 2 === 1 ? rates[mid]! : rates[mid - 1]!.plus(rates[mid]!).div('2');
  };
  return { taker: median('taker'), maker: median('maker') };
}

/** Point mort d'un aller-retour hypothétique : ce que l'onglet « Seuil » affiche. */
export interface SizeBreakeven {
  qty: Big;
  /** Taille × prix d'entrée. */
  notional: Big;
  /**
   * **Le prix que l'actif doit atteindre** : au-dessus de l'entrée pour un long, en dessous pour un
   * short. Les frais de sortie y sont calculés à ce prix-là, ce qui en fait le point mort exact.
   */
  exitPrice: Big;
  /** Écart entre ce prix et l'entrée, dans le sens du trade, par unité d'actif. */
  distance: Big;
  /** Le même écart en fraction du prix d'entrée : il ne dépend pas de la taille. */
  move: Big;
  /** Gain brut minimum : `distance × taille`, égal aux frais d'entrée et de sortie au point mort. */
  grossMin: Big;
}

/**
 * Point mort d'un aller-retour de `qty` entré au prix `price`, entrée au taux `entryRate` et sortie
 * au taux `exitRate` **appliqué au prix de sortie**. Il annule
 * `± (X − entrée) × taille − frais d'entrée − frais de sortie(X)`, d'où, signe du haut pour un long :
 *
 *     X = entrée × (1 ± taux d'entrée) ÷ (1 ∓ taux de sortie)
 *
 * La première version appliquait les deux taux au prix d'entrée : un quart de centime d'écart pour
 * 10 000 $, négligeable tant que l'écran ne montrait qu'un pourcentage et un montant. Il affiche
 * désormais le **prix à atteindre**, et l'écart par unité, le pourcentage et la valeur doivent alors
 * se recouper au centime près : qui multiplie l'un par l'autre doit retomber sur le troisième
 * (décision n° 158).
 *
 * `null` pour des taux absurdes — sortie à 100 % ou plus sur un long, prix de sortie nul ou
 * négatif : mieux vaut pas de point mort qu'un point mort faux.
 */
export function sizeBreakeven(
  direction: RoundTrip['direction'],
  price: Big,
  qty: Big,
  entryRate: Big,
  exitRate: Big,
): SizeBreakeven | null {
  const sign = direction === 'long' ? ONE : ONE.neg();
  const denominator = ONE.minus(sign.times(exitRate));
  if (!denominator.gt(ZERO) || !price.gt(ZERO)) return null;
  const exitPrice = price.times(ONE.plus(sign.times(entryRate))).div(denominator);
  if (!exitPrice.gt(ZERO)) return null;
  const distance = sign.times(exitPrice.minus(price));
  return {
    qty,
    notional: price.times(qty),
    exitPrice,
    distance,
    move: distance.div(price),
    grossMin: distance.times(qty),
  };
}
