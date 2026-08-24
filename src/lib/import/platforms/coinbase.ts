/**
 * Coinbase — relevé de transactions. Deux variantes d'en-tête coexistent (2025+ / plus ancienne) :
 * `Price Currency`/`Spot Price Currency`, `Fees and/or Spread`/`Fees`,
 * `Total (inclusive of fees and/or spread)`/`Total (inclusive of fees)` — chaque champ est résolu
 * par une liste de noms acceptés (comme `HEADERS` de `../pivot/detect.ts`). Coinbase fait parfois
 * précéder son export de lignes de préambule avant l'en-tête réel ; `parseCsvText` prend la
 * PREMIÈRE ligne non vide comme en-tête, donc si ce préambule est présent, `detect` échoue (pas de
 * colonne « Transaction Type ») — limitation connue, non contournée ici (le fichier réel Coinbase
 * doit être ouvert et le préambule retiré avant import). Sources : parseur BittyTax et échantillons
 * réels Export-To-Ghostfolio (lus le 24/08/2026).
 */
import { D, ZERO, type Big } from '../../domain/money';
import type { PivotAmount } from '../../domain/types';
import type { CsvTable } from '../csv';
import { utcStringToMs } from '../time';
import type { PivotIssue } from '../pivot/rows';
import { canonHeader, type PlatformConverter, type PlatformDraft } from './types';
import { parseMoneyText } from './money-text';

type Field =
  | 'id'
  | 'timestamp'
  | 'type'
  | 'asset'
  | 'quantity'
  | 'priceCurrency'
  | 'subtotal'
  | 'total'
  | 'fees'
  | 'notes';

/** En-têtes acceptés par champ (comparaison insensible à la casse et aux espaces multiples). */
const HEADERS: Record<Field, readonly string[]> = {
  id: ['id'],
  timestamp: ['timestamp'],
  type: ['transaction type'],
  asset: ['asset'],
  quantity: ['quantity transacted'],
  priceCurrency: ['price currency', 'spot price currency'],
  subtotal: ['subtotal'],
  total: ['total (inclusive of fees and/or spread)', 'total (inclusive of fees)'],
  fees: ['fees and/or spread', 'fees'],
  notes: ['notes'],
};

function resolveColumn(canonical: readonly string[], names: readonly string[]): number {
  for (const name of names) {
    const index = canonical.indexOf(name);
    if (index >= 0) return index;
  }
  return -1;
}

const BUY_TYPES = new Set(['buy', 'advanced trade buy', 'advance trade buy']);
const SELL_TYPES = new Set(['sell', 'advanced trade sell', 'advance trade sell']);

/** Types « revenu » : réception seule, valorisée à `Total` (valeur absolue). */
const REWARD_TYPE_LABELS = new Map<string, string>([
  ['staking income', 'staking'],
  ['rewards income', 'reward'],
  ['reward income', 'reward'],
  ['inflation reward', 'reward'],
  ['coinbase earn', 'reward'],
  ['learning reward', 'reward'],
  ['interest payout', 'interest'],
  ['subscription rebate', 'fee refund'],
  ['subscription rebates', 'fee refund'],
]);

/** Mouvements internes à Coinbase (spot ↔ Pro/Exchange/Prime/Vault/staking) : hors modèle. */
const INTERNAL_TYPES = new Set([
  'exchange deposit',
  'exchange withdrawal',
  'pro deposit',
  'pro withdrawal',
  'prime deposit',
  'prime withdrawal',
  'vault withdrawal',
  'retail staking transfer',
  'retail unstaking transfer',
]);

const MIGRATION_TYPES = new Set(['asset migration', 'retail eth2 deprecation']);

/** Notes de `Convert` : « Converted <qty> <asset> to <qty> <asset> ». */
const CONVERT_NOTES_RE = /Converted\s+[\d,]*\.?\d+\s+\S+\s+to\s+([\d,]*\.?\d+)\s+(\S+)/;

export const coinbase: PlatformConverter = {
  id: 'coinbase',
  label: 'Coinbase — relevé de transactions',
  detect(header) {
    const canonical = header.map(canonHeader);
    return (
      resolveColumn(canonical, HEADERS.type) >= 0 &&
      resolveColumn(canonical, HEADERS.quantity) >= 0 &&
      resolveColumn(canonical, HEADERS.subtotal) >= 0
    );
  },
  convert(table: CsvTable) {
    const canonical = table.header.map(canonHeader);
    const idIdx = resolveColumn(canonical, HEADERS.id);
    const timestampIdx = resolveColumn(canonical, HEADERS.timestamp);
    const typeIdx = resolveColumn(canonical, HEADERS.type);
    const assetIdx = resolveColumn(canonical, HEADERS.asset);
    const quantityIdx = resolveColumn(canonical, HEADERS.quantity);
    const priceCurrencyIdx = resolveColumn(canonical, HEADERS.priceCurrency);
    const subtotalIdx = resolveColumn(canonical, HEADERS.subtotal);
    const totalIdx = resolveColumn(canonical, HEADERS.total);
    const feesIdx = resolveColumn(canonical, HEADERS.fees);
    const notesIdx = resolveColumn(canonical, HEADERS.notes);

    const drafts: PlatformDraft[] = [];
    const issues: PivotIssue[] = [];
    let skippedInternal = 0;

    table.rows.forEach((cells, i) => {
      const lineNo = table.lineNumbers[i]!;
      const cell = (index: number): string => (index >= 0 ? (cells[index] ?? '').trim() : '');
      const native = cells.map((x) => (x ?? '').trim()).join('|');

      const rawTimestamp = cell(timestampIdx);
      const timeMs = utcStringToMs(rawTimestamp.replace(/\s*UTC$/i, ''));
      if (timeMs === null) {
        issues.push({ lineNo, message: `Date Coinbase illisible « ${rawTimestamp} ».` });
        return;
      }

      const type = cell(typeIdx).toLowerCase();
      const asset = cell(assetIdx).toLowerCase();
      const priceCurrency = cell(priceCurrencyIdx).toLowerCase() || undefined;
      const id = cell(idIdx);
      const notes = cell(notesIdx);
      const txHash = id === '' ? null : id;

      // `Quantity Transacted` peut être signé (Send négatif) : le sens vient du Type, pas du signe.
      let qty: Big;
      try {
        qty = D(cell(quantityIdx) === '' ? '0' : cell(quantityIdx)).abs();
      } catch {
        issues.push({ lineNo, message: `Quantité illisible « ${cell(quantityIdx)} ».` });
        return;
      }
      if (qty.lte(ZERO)) {
        issues.push({ lineNo, message: `Quantité nulle ou illisible « ${cell(quantityIdx)} ».` });
        return;
      }
      const qtyAmount: PivotAmount = { amount: qty.toString(), currency: asset };

      // Montant « humain » (devise collée + virgules de milliers) : `Price Currency` sert de
      // repli quand le texte ne porte pas sa propre devise.
      const money = (raw: string, what: string, localIssues: string[]): PivotAmount | null => {
        const trimmed = raw.trim();
        if (trimmed === '') return null;
        const parsed = parseMoneyText(trimmed, priceCurrency);
        if (!parsed || parsed.currency === null) {
          localIssues.push(`${what} Coinbase illisible « ${trimmed} ».`);
          return null;
        }
        return { amount: parsed.amount, currency: parsed.currency };
      };
      const positiveOrNull = (a: PivotAmount | null): PivotAmount | null =>
        a && D(a.amount).gt(ZERO) ? a : null;

      const push = (
        sent: PivotAmount | null,
        received: PivotAmount | null,
        fee: PivotAmount | null,
        netWorth: PivotAmount | null,
        label: string | null,
        description: string | null,
      ): void => {
        drafts.push({
          lineNo,
          nativeContent: native,
          timeMs,
          sent,
          received,
          fee,
          netWorth,
          label,
          description,
          txHash,
        });
      };

      // --- Achat / vente -------------------------------------------------------------------
      if (BUY_TYPES.has(type) || SELL_TYPES.has(type)) {
        const localIssues: string[] = [];
        const subtotal = money(cell(subtotalIdx), 'Subtotal', localIssues);
        let cash: PivotAmount | null;
        let fee: PivotAmount | null;
        if (subtotal) {
          cash = subtotal;
          fee = positiveOrNull(money(cell(feesIdx), 'Fees', localIssues));
        } else {
          // Subtotal vide : repli sur Total, sans jambe de frais séparée (déjà incluse dedans).
          cash = money(cell(totalIdx), 'Total', localIssues);
          fee = null;
        }
        if (localIssues.length > 0) {
          issues.push({ lineNo, message: localIssues.join(' ') });
          return;
        }
        if (cash === null) {
          issues.push({
            lineNo,
            message: `${BUY_TYPES.has(type) ? 'Achat' : 'Vente'} Coinbase sans Subtotal ni Total exploitable.`,
          });
          return;
        }
        if (BUY_TYPES.has(type)) push(cash, qtyAmount, fee, null, null, null);
        else push(qtyAmount, cash, fee, null, null, null);
        return;
      }

      // --- Convert (Notes porte la jambe reçue) ---------------------------------------------
      if (type === 'convert') {
        const m = CONVERT_NOTES_RE.exec(notes);
        if (!m) {
          issues.push({
            lineNo,
            message: `Convert Coinbase : Notes illisibles « ${notes || '(vide)'} », ligne non importée.`,
          });
          return;
        }
        const localIssues: string[] = [];
        const total = money(cell(totalIdx), 'Total', localIssues);
        if (localIssues.length > 0) {
          issues.push({ lineNo, message: localIssues.join(' ') });
          return;
        }
        push(
          qtyAmount,
          { amount: m[1]!.replace(/,/g, ''), currency: m[2]!.toLowerCase() },
          null,
          total,
          null,
          null,
        );
        return;
      }

      // --- Envoi / réception simples ---------------------------------------------------------
      if (type === 'send') {
        push(qtyAmount, null, null, null, null, null);
        return;
      }
      if (type === 'receive') {
        const label = /referral|earn|reward/i.test(notes) ? 'reward' : null;
        push(null, qtyAmount, null, null, label, null);
        return;
      }

      // --- Revenus (staking, intérêts, remises…) ----------------------------------------------
      const rewardLabel = REWARD_TYPE_LABELS.get(type);
      if (rewardLabel) {
        const localIssues: string[] = [];
        const total = money(cell(totalIdx), 'Total', localIssues);
        if (localIssues.length > 0) {
          issues.push({ lineNo, message: localIssues.join(' ') });
          return;
        }
        push(null, qtyAmount, null, total, rewardLabel, null);
        return;
      }

      if (type === 'donation') {
        push(qtyAmount, null, null, null, 'donation', null);
        return;
      }

      if (type === 'card spend' || type === 'admin debit') {
        const localIssues: string[] = [];
        const total = money(cell(totalIdx), 'Total', localIssues);
        if (localIssues.length > 0) {
          issues.push({ lineNo, message: localIssues.join(' ') });
          return;
        }
        push(qtyAmount, null, null, total, 'spend', null);
        return;
      }

      if (INTERNAL_TYPES.has(type)) {
        skippedInternal++;
        return;
      }

      if (MIGRATION_TYPES.has(type)) {
        issues.push({
          lineNo,
          message: `Migration Coinbase (« ${cell(typeIdx)} ») non gérée : qualifiez la ligne à la main.`,
        });
        return;
      }

      issues.push({
        lineNo,
        message: `Type Coinbase inconnu « ${cell(typeIdx)} » : ligne non importée.`,
      });
    });

    return { drafts, issues, skippedInternal };
  },
};
