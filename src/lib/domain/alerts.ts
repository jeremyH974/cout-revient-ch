/**
 * Alertes de prix relatives au PRU (ou à un prix fixe) : règles définies par l'utilisateur,
 * évaluées à chaque arrivée de cotations. Module pur : les seuils relatifs suivent le PRU
 * recalculé par le moteur (un nouvel achat déplace le seuil sans toucher à la règle), et le
 * déclenchement est un FRANCHISSEMENT armé/désarmé — jamais un rappel en boucle tant que la
 * condition reste vraie (anti-spam : ré-armement à marge + délai minimal, décision n° 36).
 */
import { breakEvenSellPrice, type FeeRate } from './fees';
import { D, ZERO, type Big, type DecimalString } from './money';
import type { AssetCode } from './types';

export type AlertDirection = 'below' | 'above';

export type AlertThresholdSpec =
  /** Écart en % par rapport au PRU (magnitude ≥ 0 ; le côté est porté par `direction`). */
  | { kind: 'pru-pct'; percent: DecimalString }
  /** Prix EUR fixe (l'euro reste la devise des données, quelle que soit la devise d'affichage). */
  | { kind: 'price'; priceEur: DecimalString }
  /**
   * Objectif de gain NET DE FRAIS DE VENTE : seuil = prix où vendre toute la position dégage
   * `percent` % net, au barème figé dans la règle (grille Coinhouse du moment, éditable). Le
   * seuil suit le PRU et la quantité — il dépend du frais fixe réparti sur la position.
   */
  | { kind: 'pru-net-pct'; percent: DecimalString; fee: FeeRate };

export interface AlertRule {
  id: string;
  asset: AssetCode;
  direction: AlertDirection;
  threshold: AlertThresholdSpec;
  /** `once` : un seul déclenchement (ré-armement manuel) ; `recurring` : ré-armée après re-franchissement. */
  repeat: 'once' | 'recurring';
  enabled: boolean;
  /** Pourquoi ce seuil a été posé (aide-mémoire, jamais interprété). */
  note: string;
  /** ISO 8601. */
  createdAt: string;
}

/** État d'exécution d'une règle, persisté à part : supprimer/recréer une règle repart à neuf. */
export interface AlertRuleState {
  /** Armée = prête à se déclencher au prochain franchissement du seuil. */
  armed: boolean;
  /** Epoch ms du dernier déclenchement (`null` = jamais). */
  lastTriggeredAtMs: number | null;
  triggerCount: number;
}

/** Déclenchement produit par une évaluation ; l'appelant l'horodate et le journalise. */
export interface AlertFire {
  rule: AlertRule;
  thresholdEur: DecimalString;
  priceEur: DecimalString;
  pruEur: DecimalString | null;
}

/** Déclenchement journalisé (persisté) : ce que l'utilisateur retrouve dans l'historique. */
export interface AlertEvent {
  id: string;
  ruleId: string;
  asset: AssetCode;
  direction: AlertDirection;
  thresholdEur: DecimalString;
  priceEur: DecimalString;
  pruEur: DecimalString | null;
  /** ISO 8601. */
  at: string;
  read: boolean;
}

/** Position vue par les alertes : PRU (`null` si indisponible) et quantité détenue. */
export interface AlertPositionInput {
  pruEur: DecimalString | null;
  qty: DecimalString;
}

export interface AlertsEvaluationInput {
  rules: readonly AlertRule[];
  states: Readonly<Record<string, AlertRuleState>>;
  /** Prix spot EUR par actif — uniquement des cotations fraîches (jamais le cache périmé). */
  pricesEur: Readonly<Record<AssetCode, DecimalString>>;
  /** Positions par actif (PRU + quantité) ; un actif absent laisse ses règles dormantes. */
  positions: Readonly<Record<AssetCode, AlertPositionInput>>;
  /** Epoch ms de l'évaluation (horloge injectée par l'appelant). */
  nowMs: number;
}

export interface AlertsEvaluation {
  states: Record<string, AlertRuleState>;
  fired: AlertFire[];
}

/**
 * Marge de ré-armement : après un déclenchement, le prix doit s'éloigner d'au moins 1 % au-delà
 * du seuil (du bon côté) avant qu'une règle récurrente ne se réarme. Aucun tracker grand public
 * ne documente d'hystérésis (recherche du 25/08/2026) : leurs anti-spam sont purement temporels.
 */
export const REARM_MARGIN_PCT: DecimalString = '1';

/** Délai minimal entre deux déclenchements d'une même règle (garde-fou si le prix oscille vite). */
export const MIN_TRIGGER_GAP_MS = 3_600_000;

const HUNDRED = D('100');

/**
 * Seuil EUR effectif d'une règle : `null` quand il dépend d'un PRU (ou d'une quantité)
 * indisponible — la règle est alors dormante. Unique source de vérité : l'aperçu à la création,
 * la liste des alertes et l'évaluation passent tous par ici, aucun écran ne peut afficher un
 * autre seuil que celui testé.
 */
export function alertThresholdEur(
  rule: AlertRule,
  position: AlertPositionInput | null,
): Big | null {
  if (rule.threshold.kind === 'price') return D(rule.threshold.priceEur);
  if (position === null || position.pruEur === null) return null;
  if (rule.threshold.kind === 'pru-net-pct') {
    const qty = D(position.qty);
    if (qty.lte(ZERO)) return null;
    return breakEvenSellPrice(
      D(position.pruEur),
      qty,
      rule.threshold.fee,
      D(rule.threshold.percent),
    );
  }
  const offset = D(rule.threshold.percent).div(HUNDRED);
  const factor = rule.direction === 'below' ? D('1').minus(offset) : D('1').plus(offset);
  const threshold = D(position.pruEur).times(factor);
  return threshold.lt(ZERO) ? ZERO : threshold;
}

/** Condition de déclenchement au niveau `price` pour un seuil donné. */
export function alertConditionMet(direction: AlertDirection, price: Big, threshold: Big): boolean {
  return direction === 'below' ? price.lte(threshold) : price.gte(threshold);
}

/**
 * État initial d'une règle : jamais de déclenchement à la création. Si la condition est déjà
 * remplie, la règle naît désarmée et attend un re-franchissement (l'interface le dit).
 */
export function initialAlertState(conditionMet: boolean): AlertRuleState {
  return { armed: !conditionMet, lastTriggeredAtMs: null, triggerCount: 0 };
}

/** Écart relatif du prix au seuil (ratio signé : −0,05 = prix 5 % sous le seuil). */
export function alertDistance(price: Big, threshold: Big): Big | null {
  if (threshold.lte(ZERO)) return null;
  return price.minus(threshold).div(threshold);
}

/** Prix de ré-armement : au-delà du seuil, du côté opposé au déclenchement, avec la marge. */
function rearmReached(direction: AlertDirection, price: Big, threshold: Big): boolean {
  const margin = D(REARM_MARGIN_PCT).div(HUNDRED);
  return direction === 'below'
    ? price.gte(threshold.times(D('1').plus(margin)))
    : price.lte(threshold.times(D('1').minus(margin)));
}

/**
 * Évalue toutes les règles sur un instantané de prix. Pur et sans effet : renvoie les nouveaux
 * états et les déclenchements ; l'appelant journalise, notifie et persiste.
 *
 * Sémantique (franchissement, pas niveau) :
 * - règle désactivée, prix absent ou PRU requis absent → état inchangé (dormante) ;
 * - état inconnu (règle importée sans état) → initialisé sans déclenchement ;
 * - armée + condition remplie → déclenche, sauf si le dernier déclenchement date de moins de
 *   `MIN_TRIGGER_GAP_MS` (la règle reste armée : le déclenchement est différé, jamais perdu) ;
 * - désarmée + prix revenu au-delà de la marge de ré-armement → ré-armée (récurrentes seulement ;
 *   une règle `once` déjà déclenchée attend un ré-armement manuel).
 */
export function evaluateAlerts(input: AlertsEvaluationInput): AlertsEvaluation {
  const states: Record<string, AlertRuleState> = {};
  const fired: AlertFire[] = [];
  for (const rule of input.rules) {
    const previous = input.states[rule.id];
    if (previous) states[rule.id] = previous;
    if (!rule.enabled) continue;
    const priceRaw = input.pricesEur[rule.asset];
    if (priceRaw === undefined) continue;
    const position = input.positions[rule.asset] ?? null;
    const threshold = alertThresholdEur(rule, position);
    if (threshold === null) continue;
    const price = D(priceRaw);
    const condition = alertConditionMet(rule.direction, price, threshold);
    const state = previous ?? initialAlertState(condition);
    if (!previous) {
      states[rule.id] = state;
      continue;
    }
    if (state.armed && condition) {
      const gapOk =
        state.lastTriggeredAtMs === null ||
        input.nowMs - state.lastTriggeredAtMs >= MIN_TRIGGER_GAP_MS;
      if (!gapOk) continue;
      states[rule.id] = {
        armed: false,
        lastTriggeredAtMs: input.nowMs,
        triggerCount: state.triggerCount + 1,
      };
      fired.push({
        rule,
        thresholdEur: threshold.toString(),
        priceEur: price.toString(),
        pruEur: position?.pruEur ?? null,
      });
      continue;
    }
    if (
      !state.armed &&
      rule.repeat === 'recurring' &&
      rearmReached(rule.direction, price, threshold)
    ) {
      states[rule.id] = { ...state, armed: true };
    }
  }
  return { states, fired };
}
