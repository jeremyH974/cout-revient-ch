/**
 * Revolut — relevé crypto (`Symbol,Type,Quantity,Price,Value,Fees,Date`, virgule). `Value` EXCLUT
 * les frais (constat empirique : `Value ≈ Quantity × Price` sur échantillons réels) ; `Price` n'est
 * donc jamais utilisé pour reconstruire un montant, seul `Value` compte. Le fuseau de la colonne
 * `Date` n'est PAS documenté par Revolut : hypothèse assumée (utilisateur français de l'app) que
 * l'horodatage est en heure locale Europe/Paris, converti via `zonedNaiveToMs`. Sources : parseur
 * BittyTax et échantillons réels Export-To-Ghostfolio (lus le 24/08/2026).
 */
import { D, ZERO, type Big } from '../../domain/money';
import type { PivotAmount } from '../../domain/types';
import type { CsvTable } from '../csv';
import { zonedNaiveToMs } from '../time';
import type { PivotIssue } from '../pivot/rows';
import { canonHeader, type PlatformConverter, type PlatformDraft } from './types';
import { parseMoneyText } from './money-text';

const REQUIRED = ['symbol', 'type', 'quantity', 'price', 'value', 'fees', 'date'] as const;

const MONTHS: Record<string, string> = {
  jan: '01',
  feb: '02',
  mar: '03',
  apr: '04',
  may: '05',
  jun: '06',
  jul: '07',
  aug: '08',
  sep: '09',
  oct: '10',
  nov: '11',
  dec: '12',
};

const REVOLUT_DATE_RE =
  /^([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{4}),\s*(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)$/i;

/**
 * Date Revolut « MMM D, YYYY, h:mm:ss AM/PM » (anglais, espace parfois insécable avant AM/PM).
 * Fuseau non documenté par Revolut : interprétée comme heure locale Europe/Paris (hypothèse
 * assumée pour un export destiné à un utilisateur français). `null` si la forme est inconnue.
 */
export function parseRevolutDate(raw: string): number | null {
  const normalized = raw.replace(/[\u202f\u00a0]/g, ' ').trim();
  const m = REVOLUT_DATE_RE.exec(normalized);
  if (!m) return null;
  const [, monRaw, dayRaw, year, hourRaw, minute, second, meridiem] = m;
  const month = MONTHS[monRaw!.toLowerCase()];
  if (!month) return null;
  const day = dayRaw!.padStart(2, '0');
  let hour = Number(hourRaw);
  if (hour < 1 || hour > 12) return null;
  const isPm = meridiem!.toUpperCase() === 'PM';
  // 12 AM → minuit (0 h) ; 12 PM → midi (12 h) ; sinon +12 h l'après-midi.
  if (hour === 12) hour = isPm ? 12 : 0;
  else if (isPm) hour += 12;
  const hh = String(hour).padStart(2, '0');
  const naive = `${year}-${month}-${day}T${hh}:${minute}:${second}`;
  return zonedNaiveToMs('Europe/Paris', naive);
}

export const revolut: PlatformConverter = {
  id: 'revolut-crypto',
  label: 'Revolut — relevé crypto',
  detect(header) {
    const canonical = header.map(canonHeader);
    // Anti-collision avec Coinbase : Revolut n'a jamais de colonne « Transaction Type ».
    return (
      REQUIRED.every((name) => canonical.includes(name)) && !canonical.includes('transaction type')
    );
  },
  convert(table: CsvTable) {
    const canonical = table.header.map(canonHeader);
    const col = (name: string): number => canonical.indexOf(name);
    const c = {
      symbol: col('symbol'),
      type: col('type'),
      quantity: col('quantity'),
      value: col('value'),
      fees: col('fees'),
      date: col('date'),
    };
    const drafts: PlatformDraft[] = [];
    const issues: PivotIssue[] = [];
    let skippedInternal = 0;

    table.rows.forEach((cells, i) => {
      const lineNo = table.lineNumbers[i]!;
      const cell = (index: number): string => (index >= 0 ? (cells[index] ?? '').trim() : '');
      const native = cells.map((x) => (x ?? '').trim()).join('|');

      const rawDate = cell(c.date);
      const timeMs = parseRevolutDate(rawDate);
      if (timeMs === null) {
        issues.push({ lineNo, message: `Date Revolut illisible « ${rawDate} ».` });
        return;
      }

      const asset = cell(c.symbol).toLowerCase();
      if (asset === '') {
        issues.push({ lineNo, message: 'Symbole Revolut manquant.' });
        return;
      }
      const type = cell(c.type).toLowerCase();

      let qty: Big;
      try {
        qty = D(cell(c.quantity) === '' ? '0' : cell(c.quantity)).abs();
      } catch {
        issues.push({ lineNo, message: `Quantité illisible « ${cell(c.quantity)} ».` });
        return;
      }
      if (qty.lte(ZERO)) {
        issues.push({ lineNo, message: `Quantité nulle ou illisible « ${cell(c.quantity)} ».` });
        return;
      }
      const qtyAmount: PivotAmount = { amount: qty.toString(), currency: asset };

      // `Price`/`Value`/`Fees` sont des textes « humains » (symbole ou code, devise du compte —
      // souvent €) ; `Value` seul sert de contre-valeur, `Price` n'est jamais recalculé.
      const parseHuman = (raw: string): PivotAmount | null => {
        if (raw === '') return null;
        const parsed = parseMoneyText(raw, 'eur');
        if (!parsed || parsed.currency === null) return null;
        return { amount: parsed.amount, currency: parsed.currency };
      };

      const feeLeg = (): { fee: PivotAmount | null; note: string | null } => {
        const raw = cell(c.fees);
        if (raw === '') return { fee: null, note: null };
        const parsed = parseHuman(raw);
        if (!parsed) return { fee: null, note: `frais Revolut illisibles « ${raw} » ignorés` };
        if (D(parsed.amount).lte(ZERO)) return { fee: null, note: null };
        return { fee: parsed, note: null };
      };

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
          txHash: null,
        });
      };

      switch (type) {
        case 'buy': {
          const value = parseHuman(cell(c.value));
          if (!value) {
            issues.push({
              lineNo,
              message: `Montant Value Revolut illisible « ${cell(c.value)} ».`,
            });
            return;
          }
          const { fee, note } = feeLeg();
          push(value, qtyAmount, fee, null, null, note);
          break;
        }
        case 'sell': {
          const value = parseHuman(cell(c.value));
          if (!value) {
            issues.push({
              lineNo,
              message: `Montant Value Revolut illisible « ${cell(c.value)} ».`,
            });
            return;
          }
          const { fee, note } = feeLeg();
          push(qtyAmount, value, fee, null, null, note);
          break;
        }
        case 'send':
          // Pas de contre-valeur : candidat volontaire d'appariement de virement.
          push(qtyAmount, null, null, null, null, null);
          break;
        case 'receive':
          push(null, qtyAmount, null, null, null, null);
          break;
        case 'staking reward': {
          // `Value` est souvent vide pour une récompense de staking → netWorth reste null.
          const value = parseHuman(cell(c.value));
          push(null, qtyAmount, null, value, 'staking', null);
          break;
        }
        case 'learn reward':
          push(null, qtyAmount, null, null, 'reward', null);
          break;
        case 'stake':
        case 'unstake':
          // Mouvement interne spot ↔ staking Revolut, volontairement hors modèle.
          skippedInternal++;
          break;
        default:
          issues.push({
            lineNo,
            message: `Type Revolut inconnu « ${cell(c.type)} » : ligne non importée.`,
          });
      }
    });

    return { drafts, issues, skippedInternal };
  },
};
