/**
 * Ledger Live — historique des opérations. Deux variantes d'en-tête coexistent (avec ou sans
 * colonne `Status`) ; `detect` ne dépend que des quatre colonnes communes aux deux. Les colonnes
 * Countervalue (`Countervalue Ticker`, `Countervalue at Operation Date`, `Countervalue at CSV
 * Export`) sont IGNORÉES délibérément : les estimations Ledger ne sont pas fiables (les deux
 * parseurs de référence lus le 24/08/2026 — BittyTax et Export-To-Ghostfolio — les rejettent
 * également).
 *
 * Choix assumé (contradiction connue entre ces deux parseurs de référence, tranchée à la manière
 * de BittyTax) : pour `OUT`, `Operation Amount` est le montant TOTAL débité, frais réseau déjà
 * INCLUS dedans — donc pas de jambe de frais séparée, seulement une mention en description quand
 * `Operation Fees` > 0. Pour les opérations de type `FEES`/`REVEAL`/`BOND`/`UNBOND`/
 * `WITHDRAW_UNBONDED`/`DELEGATE`/`UNDELEGATE`/`OPT_IN`/`OPT_OUT`, un `Operation Fees` > 0 devient
 * une sortie au coût étiquetée `cost` ; à 0, l'opération est un mouvement interne hors modèle.
 */
import { D, ZERO, type Big } from '../../domain/money';
import type { PivotAmount } from '../../domain/types';
import type { CsvTable } from '../csv';
import { utcStringToMs } from '../time';
import type { PivotIssue } from '../pivot/rows';
import { canonHeader, type PlatformConverter, type PlatformDraft } from './types';

const REQUIRED = ['operation date', 'operation type', 'currency ticker', 'operation amount'];

/** Types sans frais séparée : `Operation Fees` > 0 devient une sortie au coût (« cost »). */
const COST_IF_FEE_TYPES = new Set([
  'FEES',
  'REVEAL',
  'BOND',
  'UNBOND',
  'WITHDRAW_UNBONDED',
  'DELEGATE',
  'UNDELEGATE',
  'OPT_IN',
  'OPT_OUT',
]);

export const ledgerLive: PlatformConverter = {
  id: 'ledger-live',
  label: 'Ledger Live — historique des opérations',
  detect(header) {
    const canonical = header.map(canonHeader);
    return REQUIRED.every((name) => canonical.includes(name));
  },
  convert(table: CsvTable) {
    const canonical = table.header.map(canonHeader);
    const col = (name: string): number => canonical.indexOf(name);
    const c = {
      date: col('operation date'),
      status: col('status'),
      ticker: col('currency ticker'),
      type: col('operation type'),
      amount: col('operation amount'),
      fees: col('operation fees'),
      hash: col('operation hash'),
      account: col('account name'),
    };
    const drafts: PlatformDraft[] = [];
    const issues: PivotIssue[] = [];
    let skippedInternal = 0;

    table.rows.forEach((cells, i) => {
      const lineNo = table.lineNumbers[i]!;
      const cell = (index: number): string => (index >= 0 ? (cells[index] ?? '').trim() : '');
      const native = cells.map((x) => (x ?? '').trim()).join('|');

      const rawDate = cell(c.date);
      const timeMs = utcStringToMs(rawDate);
      if (timeMs === null) {
        issues.push({ lineNo, message: `Date Ledger Live illisible « ${rawDate} ».` });
        return;
      }

      // Colonne Status optionnelle (2e variante d'en-tête) : filtrage seulement si présente.
      if (c.status >= 0) {
        const status = cell(c.status);
        if (status.toUpperCase() !== 'CONFIRMED') {
          issues.push({
            lineNo,
            message: `Statut Ledger Live « ${status || '(vide)'} » : ligne ignorée.`,
          });
          return;
        }
      }

      const ticker = cell(c.ticker).toLowerCase();
      const type = cell(c.type).toUpperCase();
      const accountName = cell(c.account);

      let amount: Big;
      let fees: Big;
      try {
        amount = D(cell(c.amount) === '' ? '0' : cell(c.amount)).abs();
        fees = D(cell(c.fees) === '' ? '0' : cell(c.fees)).abs();
      } catch {
        issues.push({
          lineNo,
          message: `Montant Ledger Live illisible (Amount « ${cell(c.amount)} » ou Fees « ${cell(c.fees)} »).`,
        });
        return;
      }

      const notes: string[] = [];
      if (accountName !== '') notes.push(`Compte Ledger : ${accountName}`);

      const txHash = cell(c.hash) || null;
      const push = (
        sent: PivotAmount | null,
        received: PivotAmount | null,
        label: string | null,
      ): void => {
        drafts.push({
          lineNo,
          nativeContent: native,
          timeMs,
          sent,
          received,
          fee: null,
          netWorth: null,
          label,
          description: notes.length > 0 ? notes.join(' ; ') : null,
          txHash,
        });
      };
      const asAmount = (): PivotAmount | null =>
        amount.gt(ZERO) ? { amount: amount.toString(), currency: ticker } : null;

      switch (type) {
        case 'OUT':
          // Amount = total débité, frais réseau déjà inclus dedans (choix assumé, voir docstring).
          if (fees.gt(ZERO))
            notes.push(`frais réseau ${fees.toString()} ${ticker.toUpperCase()} inclus`);
          push(asAmount(), null, null);
          break;
        case 'IN':
          if (fees.gt(ZERO))
            notes.push(`frais ${fees.toString()} ${ticker.toUpperCase()} mentionnés (non déduits)`);
          push(null, asAmount(), null);
          break;
        case 'REWARD':
          push(null, asAmount(), 'staking');
          break;
        case 'NFT_IN':
        case 'NFT_OUT':
          issues.push({ lineNo, message: `Ledger Live : opération NFT (« ${type} ») non gérée.` });
          break;
        default:
          if (COST_IF_FEE_TYPES.has(type)) {
            if (fees.gt(ZERO)) push({ amount: fees.toString(), currency: ticker }, null, 'cost');
            else skippedInternal++;
          } else {
            issues.push({
              lineNo,
              message: `Type Ledger Live inconnu « ${type} » : ligne non importée.`,
            });
          }
      }
    });

    return { drafts, issues, skippedInternal };
  },
};
