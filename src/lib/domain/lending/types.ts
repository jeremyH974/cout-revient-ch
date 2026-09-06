/**
 * Types du moteur Prêts (proposition du 06/09/2026). Quatrième forme d'actif : le prêt
 * amortissable, ni fongible à lots (pas de cours, pas de PRU) ni valorisé à la main — sa valeur
 * est le capital restant dû, qui se CALCULE. Vocabulaire du contrat, pas du marché : Prêteur,
 * Emprunteur, Échéance. Un crédit que l'on rembourse est le même objet au signe près (lot P37).
 *
 * Deux règles structurantes, héritées du plain-text accounting :
 *   1. Les événements sont datés et append-only ; on ne modifie jamais le passé.
 *   2. Le statut d'un prêt (« en retard », « en défaut ») se DÉRIVE de la comparaison entre
 *      l'échéance attendue et les remboursements reçus. Il n'est jamais stocké — une vérité
 *      parallèle qu'on oublie de recalculer est le piège n° 4 de la proposition.
 *
 * Montants en chaînes décimales dans la devise du prêt (EUR chez BienPrêter) ; aucun `number`
 * ne porte un montant. Les taux sont des fractions annuelles (`0.12` = 12 %).
 */
import type { AccountId, DecimalString, EventId, NaiveDateTime } from '../types';

/** Identifiant stable d'un prêt : `bp:<ref>`, `man:<uuid>`… Jamais le nom du projet, qui change. */
export type LoanId = string;

/** Plateforme d'origination, en minuscules (`bienpreter`, `october`…). */
export type LendingPlatform = string;

/**
 * Convention de décompte des jours. `unknown` est une VALEUR, pas un défaut silencieux : les
 * conventions varient d'une plateforme française à l'autre, et un intérêt couru calculé sous une
 * convention supposée ne recolle jamais à l'IFU reçu en fin d'année.
 */
export type DayCount = 'act/365' | 'act/360' | '30/360' | 'unknown';

/** BienPrêter pratique l'amortissable ET l'in fine : impossible de présupposer l'un des deux. */
export type Amortisation = 'in-fine' | 'linear' | 'constant' | 'unknown';

/**
 * Nature de la preuve d'irrécouvrabilité définitive. Le BOFiP (BOI-RPPM-RCM-20-10-20-30) renvoie
 * à l'art. 272 du CGI : la preuve résulte de l'ÉCHEC DE POURSUITES ENGAGÉES. Un simple impayé à
 * l'échéance ne suffit pas, quelle qu'en soit la cause.
 */
export type WriteOffProof = 'failed-proceedings' | 'credit-insurance' | 'debtor-vanished' | 'other';

/** Le contrat, décidé à la souscription. Ce qui bouge ensuite est un événement, pas un champ. */
export interface Loan {
  id: LoanId;
  accountId: AccountId;
  platform: LendingPlatform;
  /** Emprunteur ou projet : base du calcul de concentration. */
  borrower: string;
  /** Libellé affichable ; purement cosmétique, jamais une clé. */
  label: string;
  /** Capital souscrit, strictement positif. */
  principal: DecimalString;
  /** Taux nominal annuel en fraction (`0.12` = 12 %). */
  rate: DecimalString;
  dayCount: DayCount;
  amortisation: Amortisation;
  subscribedAt: NaiveDateTime;
  /** Échéance contractuelle ; `null` pour un prêt sans terme (revolving). */
  maturity: NaiveDateTime | null;
  /** Devise du prêt, en minuscules (`eur`). */
  currency: string;
  /** Secteur d'activité de l'emprunteur, si connu — second axe de concentration. */
  sector: string | null;
}

interface LoanEventBase {
  id: EventId;
  loanId: LoanId;
  at: NaiveDateTime;
  note?: string;
}

/**
 * Encaissement réel. La ventilation capital / intérêt n'est pas un détail comptable : seule la
 * part d'intérêt est un revenu de capitaux mobiliers, et c'est elle seule qui forme l'assiette
 * d'imputation de l'art. 125-00 A du CGI.
 */
interface CashIn {
  /** Part de capital remboursé (≥ 0). */
  principal: DecimalString;
  /** Part d'intérêt brut (≥ 0), AVANT prélèvement à la source. */
  interest: DecimalString;
  /** Acompte de 12,8 % et prélèvements sociaux retenus par la plateforme (≥ 0). */
  withheld: DecimalString;
}

/**
 * Événement daté d'un prêt. `default` et `write-off` sont volontairement DEUX événements
 * distincts : le premier est un signal de risque, le second — et lui seul — ouvre le droit à
 * imputation fiscale. Les confondre expose soit à un redressement, soit à une perte fiscale.
 */
export type LoanEvent =
  | (LoanEventBase & { kind: 'subscription'; amount: DecimalString })
  | (LoanEventBase & { kind: 'repayment' } & CashIn)
  | (LoanEventBase & { kind: 'late' })
  | (LoanEventBase & { kind: 'default'; outstandingAtDefault: DecimalString | null })
  | (LoanEventBase & { kind: 'write-off'; proof: WriteOffProof })
  | (LoanEventBase & { kind: 'recovery' } & CashIn)
  | (LoanEventBase & { kind: 'secondary-sale'; proceeds: DecimalString });

export type LoanEventKind = LoanEvent['kind'];

/**
 * Statut dérivé. Ordre de priorité : les états terminaux d'abord (`written-off`, `sold`,
 * `repaid`), puis le risque (`defaulted`, `late`), puis le cours normal.
 */
export type LoanStatus =
  'pending' | 'performing' | 'late' | 'defaulted' | 'written-off' | 'sold' | 'repaid';

/** Ce que le moteur sait dire d'un prêt à une date donnée. Tout y est dérivé, rien n'est stocké. */
export interface LoanReport {
  loan: Loan;
  status: LoanStatus;
  /** Σ des décaissements réellement constatés (peut différer du capital souscrit). */
  disbursed: DecimalString;
  principalRepaid: DecimalString;
  /** Intérêts BRUTS encaissés, avant prélèvement à la source. */
  interestReceived: DecimalString;
  withheld: DecimalString;
  writtenOff: DecimalString;
  /**
   * Produit d'une cession sur le marché secondaire. Non ventilé capital / intérêt : la plateforme
   * ne le fournit pas, et l'inventer fausserait l'assiette fiscale. Le TRI, lui, le voit.
   */
  saleProceeds: DecimalString;
  /** `disbursed − principalRepaid − writtenOff`, ramené à zéro par une cession, plancher à zéro. */
  outstanding: DecimalString;
  /**
   * Intérêts courus non échus à la date d'observation ; `null` quand la convention de jours est
   * inconnue — un chiffre absent vaut mieux qu'un chiffre faux (décision n° 9).
   */
  accruedInterest: DecimalString | null;
  /** Jours de retard à la date d'observation ; `null` si le prêt n'est pas en retard. */
  daysLate: number | null;
  lastEventAt: NaiveDateTime | null;
}

/** Concentration mesurée par l'indice de Herfindahl-Hirschman sur les encours. */
export interface Concentration {
  /** Σ des carrés des poids, dans `[0, 1]` ; `null` si l'encours total est nul. */
  index: DecimalString | null;
  /** `1 / HHI` : nombre de lignes équipondérées qui donnerait la même concentration. */
  effectiveCount: DecimalString | null;
  /** Lignes triées par poids décroissant, pour nommer le risque plutôt que le résumer. */
  top: { key: string; outstanding: DecimalString; weight: DecimalString }[];
}

export interface LendingTotals {
  disbursed: DecimalString;
  principalRepaid: DecimalString;
  interestReceived: DecimalString;
  withheld: DecimalString;
  writtenOff: DecimalString;
  saleProceeds: DecimalString;
  outstanding: DecimalString;
  /** Σ des intérêts courus calculables ; les prêts en convention inconnue en sont exclus. */
  accruedInterest: DecimalString;
  /** Nombre de prêts dont l'intérêt couru n'a PAS pu être calculé : rend l'exclusion visible. */
  accrualUnavailable: number;
  /** `outstanding + accruedInterest` — la valeur du portefeuille, jamais confondue avec `disbursed`. */
  value: DecimalString;
}

export interface LendingInput {
  loans: readonly Loan[];
  events: readonly LoanEvent[];
  /** Jour d'observation `YYYY-MM-DD` : retard, intérêts courus et valeur terminale s'y rapportent. */
  asOf: string;
}

export interface LendingReport {
  asOf: string;
  loans: LoanReport[];
  totals: LendingTotals;
  byStatus: Record<LoanStatus, number>;
  /** Concentration mesurée sur DEUX axes : un défaut d'emprunteur et une défaillance de */
  /** plateforme sont deux risques de nature différente (piège n° 5 de la proposition). */
  concentration: { byBorrower: Concentration; byPlatform: Concentration };
  /** Événements orphelins (rattachés à un prêt absent) : signalés, jamais ignorés en silence. */
  orphanEvents: EventId[];
}

/**
 * Mouvement du portefeuille électronique de la plateforme : dépôt, retrait, bonus, et débit des
 * prélèvements. Hors grand livre des prêts — un dépôt n'est pas un prêt — mais indispensable au
 * solde de trésorerie et à la réconciliation avec le relevé de la plateforme.
 */
export interface WalletMovement {
  id: string;
  at: NaiveDateTime;
  kind: 'deposit' | 'withdrawal' | 'bonus' | 'tax';
  /** Montant SIGNÉ tel que la plateforme le donne (négatif = sortie du portefeuille). */
  amount: DecimalString;
  label: string;
}

/**
 * Ce qui se persiste : les contrats, les événements et la trésorerie, tous indexés par
 * identifiant stable. Rien de dérivé n'est stocké — encours, statut et TRI sont recalculés à
 * chaque chargement, ce qui rend un ré-import idempotent.
 */
export interface LendingState {
  loans: Record<LoanId, Loan>;
  events: Record<EventId, LoanEvent>;
  wallet: Record<string, WalletMovement>;
}

export function emptyLendingState(): LendingState {
  return { loans: {}, events: {}, wallet: {} };
}
