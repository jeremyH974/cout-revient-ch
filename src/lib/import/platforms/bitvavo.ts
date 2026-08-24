/**
 * Bitvavo — historique de transactions (`Timezone,Date,Time,Type,Currency,Amount,Quote Currency,
 * Quote Price,Received / Paid Currency,Received / Paid Amount,Fee currency,Fee amount,Status,
 * Transaction ID,Address`). `Quote Currency`/`Quote Price`/`Address` ne sont jamais utilisés (non
 * nécessaires à la reconstruction des jambes). Frais de retrait : réutilise la même règle que
 * Kraken (`fiatEquivalent`/`isFiat` de `../../domain/assets`) — un frais réseau dans l'actif retiré
 * est plié dans la quantité envoyée (le solde réel débité), un frais « cash » (ou dans une autre
 * devise) reste une jambe de frais séparée. Source : docs Bitvavo (lues le 24/08/2026).
 */
import { fiatEquivalent, isFiat } from '../../domain/assets';
import { D, ZERO, type Big } from '../../domain/money';
import type { PivotAmount } from '../../domain/types';
import type { CsvTable } from '../csv';
import { zonedNaiveToMs } from '../time';
import type { PivotIssue } from '../pivot/rows';
import { canonHeader, type PlatformConverter, type PlatformDraft } from './types';

const REQUIRED_DETECT = ['timezone', 'received / paid amount'];

/** Un frais « cash » (EUR/USD/stables) est convertible : jamais plié dans une quantité crypto. */
const cashLike = (asset: string): boolean => fiatEquivalent(asset) !== null || isFiat(asset);

const TIME_RE = /^(\d{2}:\d{2}:\d{2})/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const bitvavo: PlatformConverter = {
  id: 'bitvavo',
  label: 'Bitvavo — historique de transactions',
  detect(header) {
    const canonical = header.map(canonHeader);
    return REQUIRED_DETECT.every((name) => canonical.includes(name));
  },
  convert(table: CsvTable) {
    const canonical = table.header.map(canonHeader);
    const col = (name: string): number => canonical.indexOf(name);
    const c = {
      timezone: col('timezone'),
      date: col('date'),
      time: col('time'),
      type: col('type'),
      currency: col('currency'),
      amount: col('amount'),
      rpCurrency: col('received / paid currency'),
      rpAmount: col('received / paid amount'),
      feeCurrency: col('fee currency'),
      feeAmount: col('fee amount'),
      status: col('status'),
      txId: col('transaction id'),
    };
    const drafts: PlatformDraft[] = [];
    const issues: PivotIssue[] = [];
    let skippedInternal = 0;

    table.rows.forEach((cells, i) => {
      const lineNo = table.lineNumbers[i]!;
      const cell = (index: number): string => (index >= 0 ? (cells[index] ?? '').trim() : '');
      const native = cells.map((x) => (x ?? '').trim()).join('|');

      const status = cell(c.status);
      if (!/^(completed|distributed)$/i.test(status)) {
        issues.push({
          lineNo,
          message: `Statut Bitvavo « ${status || '(vide)'} » : ligne ignorée.`,
        });
        return;
      }

      const dateRaw = cell(c.date);
      const timeMatch = TIME_RE.exec(cell(c.time));
      if (!DATE_RE.test(dateRaw) || !timeMatch) {
        issues.push({
          lineNo,
          message: `Date/heure Bitvavo illisible « ${dateRaw} ${cell(c.time)} ».`,
        });
        return;
      }
      const zone = cell(c.timezone) || 'Europe/Amsterdam';
      const timeMs = zonedNaiveToMs(zone, `${dateRaw}T${timeMatch[1]}`);
      if (timeMs === null) {
        issues.push({
          lineNo,
          message: `Fuseau ou date/heure Bitvavo invalide (« ${zone} », « ${dateRaw}T${timeMatch[1]} »).`,
        });
        return;
      }

      const type = cell(c.type).toLowerCase();
      const currency = cell(c.currency).toLowerCase();
      const rpCurrency = cell(c.rpCurrency).toLowerCase();
      const feeCurrency = cell(c.feeCurrency).toLowerCase();

      let amount: Big;
      let rpAmount: Big;
      let feeAmount: Big;
      try {
        amount = D(cell(c.amount) === '' ? '0' : cell(c.amount)).abs();
        rpAmount = D(cell(c.rpAmount) === '' ? '0' : cell(c.rpAmount)).abs();
        feeAmount = D(cell(c.feeAmount) === '' ? '0' : cell(c.feeAmount)).abs();
      } catch {
        issues.push({
          lineNo,
          message: `Montant Bitvavo illisible (Amount « ${cell(c.amount)} », Received/Paid « ${cell(c.rpAmount)} » ou Fee « ${cell(c.feeAmount)} »).`,
        });
        return;
      }

      const txHash = cell(c.txId) || null;
      const push = (
        sent: PivotAmount | null,
        received: PivotAmount | null,
        fee: PivotAmount | null,
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
          netWorth: null,
          label,
          description,
          txHash,
        });
      };
      const asAmount = (value: Big, curr: string): PivotAmount | null =>
        value.gt(ZERO) ? { amount: value.toString(), currency: curr } : null;
      const feeLeg = (): PivotAmount | null =>
        feeAmount.gt(ZERO) ? { amount: feeAmount.toString(), currency: feeCurrency } : null;

      switch (type) {
        case 'buy':
          push(asAmount(rpAmount, rpCurrency), asAmount(amount, currency), feeLeg(), null, null);
          break;
        case 'sell':
          push(asAmount(amount, currency), asAmount(rpAmount, rpCurrency), feeLeg(), null, null);
          break;
        case 'deposit':
          // L'EUR part en « ignoré cash » en aval (ligne 100 % fiat) : voulu.
          push(null, asAmount(amount, currency), null, null, null);
          break;
        case 'withdrawal': {
          let qty = amount;
          let fee: PivotAmount | null = null;
          let description: string | null = null;
          if (feeAmount.gt(ZERO)) {
            if (feeCurrency === currency && !cashLike(currency)) {
              // Frais réseau dans l'actif retiré : plié dans la quantité envoyée (solde réel).
              qty = qty.plus(feeAmount);
              description = `Bitvavo : frais réseau ${feeAmount.toString()} ${currency.toUpperCase()} inclus dans la quantité envoyée.`;
            } else {
              fee = { amount: feeAmount.toString(), currency: feeCurrency };
            }
          }
          push(asAmount(qty, currency), null, fee, null, description);
          break;
        }
        case 'staking':
          push(null, asAmount(amount, currency), null, 'staking', null);
          break;
        case 'rebate':
        case 'affiliate':
        case 'distribution':
          push(null, asAmount(amount, currency), null, 'reward', null);
          break;
        case 'internal_transfer':
          skippedInternal++;
          break;
        case 'withdrawal_cancelled':
          issues.push({
            lineNo,
            message: 'Retrait Bitvavo annulé (« withdrawal_cancelled ») : ligne non importée.',
          });
          break;
        default:
          issues.push({
            lineNo,
            message: `Type Bitvavo inconnu « ${type} » : ligne non importée.`,
          });
      }
    });

    return { drafts, issues, skippedInternal };
  },
};
