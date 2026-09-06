/**
 * Convertisseur de l'export « transactions » de BienPrêter (PSFP AMF n° FP-2023-38) vers le
 * moteur Prêts. Un seul fichier porte trois choses distinctes qu'il faut séparer :
 *   1. les souscriptions et remboursements, rattachés à un `N°Contrat` → événements de prêt ;
 *   2. les mouvements du portefeuille électronique (dépôt, bonus, prélèvements) → trésorerie ;
 *   3. tout libellé inconnu → signalé, jamais ignoré.
 *
 * TROIS PIÈGES DU FORMAT, constatés sur un export réel de 1 425 lignes (06/09/2026) :
 *
 * A. **La colonne `Montant` change de sens en cours d'historique.** Sur `Remboursement mensuel`
 *    (ancien flux, jusqu'au 07/09/2025) elle porte le montant NET ; sur
 *    `Remboursement mensuel (new)` (à partir du 08/08/2025) elle porte le BRUT capital + intérêts.
 *    Vérifié 551/551 et 589/589. On ne la lit donc JAMAIS sur une ligne de remboursement : seules
 *    les colonnes ventilées font foi, et elles vérifient `net = capital + intérêts − prélèvements`
 *    sur 1 212 lignes sur 1 212.
 *
 * B. **Un remboursement anticipé est éclaté en plusieurs lignes au même (contrat, date)** — une
 *    porte le capital, les autres les intérêts période par période. Dédoublonner sur ce couple
 *    perdrait des intérêts : la clé est un hachage de contenu avec suffixe de collision, comme
 *    l'import pivot.
 *
 * C. **Le même impôt figure deux fois** depuis le passage au nouveau flux : dans la colonne
 *    ventilée du remboursement, ET comme débit autonome du portefeuille (131,28 € des deux côtés
 *    en 2025 sur l'export de référence). La colonne fait foi ; les deux ne s'additionnent jamais.
 *
 * Ce que l'export NE contient PAS : taux nominal, échéance, convention de jours, mode
 * d'amortissement. Les prêts sont donc créés en `unknown` sur ces champs — l'intérêt couru et la
 * détection de retard restent hors de portée tant que l'utilisateur ne les complète pas.
 */
import type { AccountId, DecimalString, NaiveDateTime } from '../../domain/types';
import type {
  Amortisation,
  DayCount,
  Loan,
  LoanEvent,
  WalletMovement,
} from '../../domain/lending/types';
import { D, toDecimalString } from '../../domain/money';
import { parseNaiveDateTime, parseNumberCell } from '../coinhouse/rows';
import { fnv1a } from '../pivot/rows';
import type { CsvTable } from '../csv';

export interface BienPreterImport {
  loans: Loan[];
  events: LoanEvent[];
  wallet: WalletMovement[];
  /** Libellés d'opération non reconnus : comptés et localisés, jamais avalés. */
  unknown: { label: string; count: number; lines: number[] }[];
  /** Lignes où `net ≠ capital + intérêts − prélèvements` : l'export se contredit, on le dit. */
  inconsistent: {
    lineNo: number;
    contract: string;
    expected: DecimalString;
    found: DecimalString;
  }[];
  /** Constats à porter à l'écran : ce n'est pas une erreur, mais on ne peut pas le taire. */
  notes: string[];
  problems: string[];
}

/** Colonnes de l'export, dans leur libellé exact : le convertisseur ne lit rien d'autre. */
type Column =
  | 'Opération'
  | 'N°Contrat'
  | 'Projet'
  | 'Entreprise'
  | 'Date'
  | 'Montant'
  | 'Remarques'
  | 'Capital remboursé'
  | 'Intérêts remboursés'
  | 'Prélèvements fiscaux et sociaux'
  | 'Montant net';

const norm = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*\(new\)$/, '');

/** L'en-tête est la signature du format : quatre colonnes ventilées qu'aucun autre export n'a. */
export function detectBienPreter(header: readonly string[]): boolean {
  const seen = new Set(header.map((h) => norm(h)));
  return (
    seen.has('n°contrat') &&
    seen.has('capital remboursé') &&
    seen.has('intérêts remboursés') &&
    seen.has('prélèvements fiscaux et sociaux')
  );
}

const SUBSCRIPTION = 'intention de prêt acceptée';
const REPAYMENTS = new Set([
  'remboursement mensuel',
  'remboursement anticipé total',
  'remboursement anticipé partiel',
]);
const WALLET: Record<string, WalletMovement['kind']> = {
  'dépôt de fonds': 'deposit',
  bonus: 'bonus',
  'prélèvements fiscaux': 'tax',
  // Symétrique attendu du dépôt, non observé sur l'export de référence : s'il porte un autre
  // libellé, il tombera dans `unknown` et se verra, plutôt que d'être compté à tort.
  'retrait de fonds': 'withdrawal',
};

/** `dd/MM/yyyy` sans heure : on réutilise le parseur Coinhouse en posant minuit. */
function dayToNaive(raw: string): NaiveDateTime | null {
  const value = raw.trim();
  if (value === '') return null;
  return parseNaiveDateTime(/^\d{2}\/\d{2}\/\d{4}$/.test(value) ? `${value} 00:00:00` : value);
}

/** Cellule numérique française (`1 234,56`) → décimal canonique ; `0` si vide. */
function amount(raw: string | undefined): DecimalString | null {
  const cell = parseNumberCell(raw ?? '');
  if (cell.kind === 'empty') return '0';
  return cell.kind === 'ok' ? cell.value : null;
}

const abs = (value: DecimalString): DecimalString => toDecimalString(D(value).abs());

export function parseBienPreter(table: CsvTable, accountId: AccountId): BienPreterImport {
  const index = new Map(table.header.map((h, i) => [norm(h), i]));
  const at = (row: string[], column: Column): string => {
    const i = index.get(norm(column));
    return i === undefined ? '' : (row[i] ?? '');
  };

  const loans = new Map<string, Loan>();
  const events: LoanEvent[] = [];
  const wallet: WalletMovement[] = [];
  const unknown = new Map<string, { count: number; lines: number[] }>();
  const inconsistent: BienPreterImport['inconsistent'] = [];
  const problems: string[] = [];
  const used = new Set<string>();

  /** Clé stable par contenu ; `#n` tranche la collision de deux lignes rigoureusement identiques. */
  const keyOf = (prefix: string, parts: string[]): string => {
    const base = `${prefix}:${fnv1a(parts.join(''))}`;
    if (!used.has(base)) {
      used.add(base);
      return base;
    }
    let n = 2;
    while (used.has(`${base}#${n}`)) n += 1;
    used.add(`${base}#${n}`);
    return `${base}#${n}`;
  };

  table.rows.forEach((row, i) => {
    const lineNo = table.lineNumbers[i] ?? i + 2;
    const label = at(row, 'Opération').trim();
    const operation = norm(label);
    const when = dayToNaive(at(row, 'Date'));
    if (when === null) {
      problems.push(`Ligne ${lineNo} : date illisible (« ${at(row, 'Date')} »).`);
      return;
    }
    const contract = at(row, 'N°Contrat').trim();

    if (operation === SUBSCRIPTION) {
      const gross = amount(at(row, 'Montant'));
      if (gross === null) {
        problems.push(`Ligne ${lineNo} : montant illisible sur une souscription.`);
        return;
      }
      const principal = abs(gross); // l'export signe la sortie du portefeuille.
      if (!loans.has(contract)) {
        loans.set(contract, {
          id: `bp:${contract}`,
          accountId,
          platform: 'bienpreter',
          borrower: at(row, 'Entreprise').trim() || contract,
          label: at(row, 'Projet').trim() || contract,
          principal,
          // Absents de l'export : ni taux, ni échéance, ni convention, ni amortissement.
          rate: '0',
          dayCount: 'unknown' satisfies DayCount,
          amortisation: 'unknown' satisfies Amortisation,
          subscribedAt: when,
          maturity: null,
          currency: 'eur',
          sector: null,
        });
      }
      events.push({
        id: keyOf('bp', [contract, when, principal, operation]),
        loanId: `bp:${contract}`,
        at: when,
        kind: 'subscription',
        amount: principal,
      });
      return;
    }

    if (REPAYMENTS.has(operation)) {
      // PIÈGE A : `Montant` n'est pas lu ici — son sens change selon l'ancienneté de la ligne.
      const principal = amount(at(row, 'Capital remboursé'));
      const interest = amount(at(row, 'Intérêts remboursés'));
      const withheld = amount(at(row, 'Prélèvements fiscaux et sociaux'));
      const net = amount(at(row, 'Montant net'));
      if (principal === null || interest === null || withheld === null || net === null) {
        problems.push(`Ligne ${lineNo} : colonne ventilée illisible sur un remboursement.`);
        return;
      }
      const expected = D(principal).plus(D(interest)).minus(D(withheld));
      if (!expected.eq(D(net))) {
        inconsistent.push({
          lineNo,
          contract,
          expected: toDecimalString(expected),
          found: net,
        });
      }
      const note = at(row, 'Remarques').trim();
      events.push({
        id: keyOf('bp', [contract, when, principal, interest, withheld, operation]),
        loanId: `bp:${contract}`,
        at: when,
        kind: 'repayment',
        principal,
        interest,
        withheld,
        ...(note ? { note } : {}),
      });
      return;
    }

    const kind = WALLET[operation];
    if (kind) {
      const signed = amount(at(row, 'Montant'));
      if (signed === null) {
        problems.push(`Ligne ${lineNo} : montant illisible sur un mouvement de portefeuille.`);
        return;
      }
      wallet.push({
        id: keyOf('bpw', [when, signed, operation]),
        at: when,
        kind,
        amount: signed,
        label,
      });
      return;
    }

    const seen = unknown.get(label) ?? { count: 0, lines: [] };
    seen.count += 1;
    if (seen.lines.length < 5) seen.lines.push(lineNo);
    unknown.set(label, seen);
  });

  // PIÈGE C : à partir du 08/08/2025, le nouveau flux inscrit le MÊME impôt deux fois — dans la
  // colonne « Prélèvements fiscaux et sociaux » du remboursement, et comme débit autonome du
  // portefeuille. Constaté sur un export réel : 131,28 € des deux côtés en 2025. La colonne fait
  // foi (elle est rattachée à un contrat et à une date) ; les lignes autonomes servent au solde de
  // trésorerie. Les additionner compterait l'impôt deux fois.
  const notes: string[] = [];
  const standalone = wallet.filter((w) => w.kind === 'tax');
  if (standalone.length > 0) {
    const inLedger = events.reduce(
      (total, e) => (e.kind === 'repayment' ? total.plus(D(e.withheld)) : total),
      D('0'),
    );
    const inWallet = standalone.reduce((total, w) => total.plus(D(w.amount).abs()), D('0'));
    notes.push(
      `Les prélèvements apparaissent deux fois dans cet export : ${toDecimalString(inLedger)} € ` +
        `ventilés par prêt, et ${toDecimalString(inWallet)} € débités du portefeuille depuis le ` +
        `passage au nouveau flux. C'est le même impôt — ne l'additionnez pas.`,
    );
  }

  return {
    loans: [...loans.values()],
    events,
    wallet,
    unknown: [...unknown].map(([label, v]) => ({ label, count: v.count, lines: v.lines })),
    inconsistent,
    notes,
    problems,
  };
}
