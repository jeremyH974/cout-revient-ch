/**
 * SwissBorg — relevé de compte. En-tête à 11 colonnes : `Local time,Time in UTC,Type,Currency,
 * Gross amount,Gross amount (CCY),Fee,Fee (CCY),Net amount,Net amount (CCY),Note`, où `CCY` est le
 * code de la devise DU COMPTE et fait partie du nom de 3 colonnes (`Gross amount (CHF)` vs `(EUR)`
 * vs `(USD)`…) : la détection et l'accès aux colonnes utilisent donc un motif
 * (`/^gross amount \(([a-z]{3})\)$/` etc.) et jamais un nom fixe — `findAccountCcy`.
 *
 * Chaque ligne porte deux versions du même mouvement : `Gross/Fee/Net amount` dans la devise DE LA
 * LIGNE (`Currency`, ex. BTC), et `Gross/Fee/Net amount (CCY)` la même chose convertie dans la
 * devise du compte. `Net amount` sert de quantité de jambe (déjà net du frais, comme les frais
 * réseau pliés de Bitvavo/Kraken) : `Fee` n'est PAS reporté en jambe de frais séparée pour
 * Buy/Sell/Deposit/Withdrawal (il est déjà déduit de `Net amount`, dans le même actif — pas de
 * colonne « Fee Currency » distincte comme Bitvavo, donc rien n'indique un frais dans un autre
 * actif) ; une mention en description évite qu'il disparaisse silencieusement. `Fee Adjustment`
 * est différent : c'est un TYPE de ligne à part entière (un prélèvement de frais autonome, pas lié
 * à un trade), modélisé comme une jambe `fee` seule (`sent`/`received` null).
 *
 * `Buy` et `Sell` partageant le même `Time in UTC` forment UN SEUL échange (`Sell` = jambe envoyée,
 * `Buy` = jambe reçue) : appariées par horodatage exact (comme Kraken apparie par `refid`) plutôt
 * que par adjacence, puisque rien ne garantit que les deux lignes soient consécutives dans le
 * relevé.
 *
 * `netWorth` : la colonne `(CCY)` donne directement la contre-valeur en devise du compte. Utilisée
 * uniquement quand cette devise est EUR OU USD — la spec de cette tâche dit littéralement
 * « uniquement si la devise est EUR » puis, entre parenthèses, élargit explicitement à USD
 * (« l'aval convertit USD via la BCE ») et ne liste que CHF/autres comme exclusion : la clause
 * parenthétique est plus précise et opérationnelle (elle justifie le POURQUOI), donc c'est elle qui
 * est implémentée ; signalé ici comme une incohérence de rédaction de la spec, pas silencieusement
 * résolue dans un sens ou l'autre. Jamais posée sur les jambes Buy/Sell (qui portent déjà leur
 * propre contre-valeur via `sent`/`received`), ni quand la devise de la ligne EST déjà celle du
 * compte (redondant).
 *
 * `Payouts` : jambe reçue ; `label: 'reward'` uniquement si `Note` contient « yield » (insensible à
 * la casse), au pied de la lettre de la spec — un Payouts sans ce mot dans la note reste sans label
 * plutôt que d'inventer une classification.
 *
 * `Local time` est ignorée (redondante avec `Time in UTC`, qui est non ambiguë).
 *
 * CONFIANCE : les colonnes et leur sens sont confirmés par la recherche sourcée, mais le format
 * exact des dates de `Time in UTC` n'a PAS été observé sur un fichier réel. `parseSwissborgTime`
 * accepte donc trois formes tolérées (`YYYY-MM-DD HH:MM:SS`, `YYYY-MM-DDTHH:MM:SS` via
 * `utcStringToMs`, et `DD/MM/YYYY HH:MM` via un parseur dédié) et produit un `PivotIssue` explicite
 * pour toute autre forme plutôt que de deviner.
 */
import { D, ZERO, type Big } from '../../domain/money';
import type { PivotAmount } from '../../domain/types';
import type { CsvTable } from '../csv';
import { msToUtcString, utcStringToMs } from '../time';
import type { PivotIssue } from '../pivot/rows';
import { canonHeader, type PlatformConverter, type PlatformDraft } from './types';

const FIXED_REQUIRED = [
  'local time',
  'time in utc',
  'type',
  'currency',
  'gross amount',
  'fee',
  'net amount',
  'note',
];
const GROSS_CCY_RE = /^gross amount \(([a-z]{3})\)$/;

/** Devise du compte (3 lettres) déduite du nom des colonnes `(CCY)`, cohérente sur les 3. */
function findAccountCcy(canonical: readonly string[]): string | null {
  for (const name of canonical) {
    const m = GROSS_CCY_RE.exec(name);
    if (!m) continue;
    const ccy = m[1]!;
    if (canonical.includes(`fee (${ccy})`) && canonical.includes(`net amount (${ccy})`)) return ccy;
  }
  return null;
}

const DMY_RE = /^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{2}):(\d{2})$/;

/** `YYYY-MM-DD[T ]HH:MM(:SS)` (via `utcStringToMs`) ou `DD/MM/YYYY HH:MM` ; `null` sinon. */
export function parseSwissborgTime(raw: string): number | null {
  const viaIso = utcStringToMs(raw);
  if (viaIso !== null) return viaIso;
  const m = DMY_RE.exec(raw.trim());
  if (!m) return null;
  const [, d, mo, y, h, mi] = m;
  const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), 0);
  return new Date(ms).toISOString().slice(0, 10) === `${y}-${mo}-${d}` ? ms : null;
}

interface SbRow {
  lineNo: number;
  native: string;
  timeMs: number;
  type: string;
  currency: string;
  net: Big;
  netCcy: Big | null;
  fee: Big;
  note: string;
}

export const swissborg: PlatformConverter = {
  id: 'swissborg',
  label: 'SwissBorg — relevé de compte',
  // SwissBorg SA, Lausanne (Suisse) : entité unique, hors UE — organisme étranger sans ambiguïté
  // au sens de l'art. 1649 bis C (P66, docs/declarations-fr.md).
  country: 'CH',
  detect(header) {
    const canonical = header.map(canonHeader);
    if (!FIXED_REQUIRED.every((n) => canonical.includes(n))) return false;
    return findAccountCcy(canonical) !== null;
  },
  convert(table: CsvTable) {
    const canonical = table.header.map(canonHeader);
    const ccy = findAccountCcy(canonical);
    if (ccy === null) {
      return {
        drafts: [],
        issues: [
          { lineNo: 1, message: 'SwissBorg : colonnes « (CCY) » introuvables ou incohérentes.' },
        ],
        skippedInternal: 0,
      };
    }
    const col = (name: string): number => canonical.indexOf(name);
    const c = {
      timeUtc: col('time in utc'),
      type: col('type'),
      currency: col('currency'),
      net: col('net amount'),
      netCcy: col(`net amount (${ccy})`),
      fee: col('fee'),
      note: col('note'),
    };

    const drafts: PlatformDraft[] = [];
    const issues: PivotIssue[] = [];
    const rows: SbRow[] = [];

    table.rows.forEach((cells, i) => {
      const lineNo = table.lineNumbers[i]!;
      const cell = (index: number): string => (index >= 0 ? (cells[index] ?? '').trim() : '');
      const native = cells.map((x) => (x ?? '').trim()).join('|');

      const rawTime = cell(c.timeUtc);
      const timeMs = parseSwissborgTime(rawTime);
      if (timeMs === null) {
        issues.push({
          lineNo,
          message: `Date SwissBorg illisible « ${rawTime} » (Time in UTC).`,
        });
        return;
      }
      const type = cell(c.type).toLowerCase();
      const currency = cell(c.currency).toLowerCase();
      const note = cell(c.note);

      let net: Big;
      let netCcyAmount: Big | null;
      let fee: Big;
      try {
        net = D(cell(c.net) === '' ? '0' : cell(c.net)).abs();
        const rawNetCcy = cell(c.netCcy);
        netCcyAmount = rawNetCcy === '' ? null : D(rawNetCcy).abs();
        fee = D(cell(c.fee) === '' ? '0' : cell(c.fee)).abs();
      } catch {
        issues.push({
          lineNo,
          message: `Montant SwissBorg illisible (Net amount « ${cell(c.net)} » ou Fee « ${cell(c.fee)} »).`,
        });
        return;
      }
      rows.push({ lineNo, native, timeMs, type, currency, net, netCcy: netCcyAmount, fee, note });
    });

    // --- Buy + Sell au même Time in UTC = un seul échange -----------------------------------
    const tradeRows = rows.filter((r) => r.type === 'buy' || r.type === 'sell');
    const otherRows = rows.filter((r) => r.type !== 'buy' && r.type !== 'sell');

    const pairs = new Map<number, SbRow[]>();
    for (const r of tradeRows) {
      const list = pairs.get(r.timeMs) ?? [];
      list.push(r);
      pairs.set(r.timeMs, list);
    }
    for (const group of pairs.values()) {
      const buyRow = group.find((r) => r.type === 'buy');
      const sellRow = group.find((r) => r.type === 'sell');
      if (group.length !== 2 || !buyRow || !sellRow) {
        for (const r of group) {
          issues.push({
            lineNo: r.lineNo,
            message: `Échange SwissBorg incomplet (${group.length} jambe(s) à ${msToUtcString(r.timeMs)} UTC) : qualifiez l'opération à la main.`,
          });
        }
        continue;
      }
      const notes: string[] = [];
      if (sellRow.fee.gt(ZERO))
        notes.push(
          `frais ${sellRow.fee.toString()} ${sellRow.currency.toUpperCase()} déjà déduits du montant vendu`,
        );
      if (buyRow.fee.gt(ZERO))
        notes.push(
          `frais ${buyRow.fee.toString()} ${buyRow.currency.toUpperCase()} déjà déduits du montant reçu`,
        );
      const ordered = [sellRow, buyRow].sort((a, b) => a.lineNo - b.lineNo);
      drafts.push({
        lineNo: Math.min(sellRow.lineNo, buyRow.lineNo),
        nativeContent: `${ordered[0]!.native}||${ordered[1]!.native}`,
        timeMs: Math.min(sellRow.timeMs, buyRow.timeMs),
        sent: { amount: sellRow.net.toString(), currency: sellRow.currency },
        received: { amount: buyRow.net.toString(), currency: buyRow.currency },
        fee: null,
        netWorth: null,
        label: null,
        description: notes.length > 0 ? `SwissBorg : ${notes.join(' ; ')}.` : null,
        txHash: null,
      });
    }

    // --- Deposit / Withdrawal / Payouts / Fee Adjustment -------------------------------------
    for (const r of otherRows) {
      const netWorth: PivotAmount | null =
        (ccy === 'eur' || ccy === 'usd') && r.currency !== ccy && r.netCcy
          ? { amount: r.netCcy.toString(), currency: ccy }
          : null;
      const description =
        r.fee.gt(ZERO) && r.type !== 'fee adjustment'
          ? `SwissBorg : frais ${r.fee.toString()} ${r.currency.toUpperCase()} déjà déduits du montant net.`
          : null;

      if (r.net.lte(ZERO)) {
        issues.push({
          lineNo: r.lineNo,
          message: `Ligne SwissBorg « ${r.type} » de montant nul (Net amount) : ligne ignorée.`,
        });
        continue;
      }
      const leg: PivotAmount = { amount: r.net.toString(), currency: r.currency };

      switch (r.type) {
        case 'deposit':
          drafts.push({
            lineNo: r.lineNo,
            nativeContent: r.native,
            timeMs: r.timeMs,
            sent: null,
            received: leg,
            fee: null,
            netWorth,
            label: null,
            description,
            txHash: null,
          });
          break;
        case 'withdrawal':
          drafts.push({
            lineNo: r.lineNo,
            nativeContent: r.native,
            timeMs: r.timeMs,
            sent: leg,
            received: null,
            fee: null,
            netWorth,
            label: null,
            description,
            txHash: null,
          });
          break;
        case 'payouts':
          drafts.push({
            lineNo: r.lineNo,
            nativeContent: r.native,
            timeMs: r.timeMs,
            sent: null,
            received: leg,
            fee: null,
            netWorth,
            label: /yield/i.test(r.note) ? 'reward' : null,
            description,
            txHash: null,
          });
          break;
        case 'fee adjustment':
          drafts.push({
            lineNo: r.lineNo,
            nativeContent: r.native,
            timeMs: r.timeMs,
            sent: null,
            received: null,
            fee: leg,
            netWorth,
            label: null,
            description: null,
            txHash: null,
          });
          break;
        default:
          issues.push({
            lineNo: r.lineNo,
            message: `Type SwissBorg inconnu « ${r.type} » : ligne non importée.`,
          });
      }
    }

    return { drafts, issues, skippedInternal: 0 };
  },
};
