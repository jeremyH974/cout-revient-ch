/**
 * Kraken — `ledgers.csv` (le seul export qui couvre trades, dépôts/retraits ET staking).
 * Une opération d'échange = deux lignes (spend/receive ou trade) reliées par `refid` ; les codes
 * d'actifs historiques (XXBT, ZEUR…) et les suffixes staking/earn (.S, .M, 28.S…) sont traduits.
 * Frais : dans l'actif de sa ligne — reportés en frais pivot quand ils sont « cash » (EUR/USD/
 * stables, convertibles), sinon pliés dans la quantité de la jambe (le coût all-in EUR ne bouge
 * pas, la quantité créditée/débitée reflète le solde réel). Sources : doc Kraken + parseurs
 * BittyTax (en-têtes et types vérifiés le 24/08/2026).
 */
import { fiatEquivalent, isFiat } from '../../domain/assets';
import { D, ZERO, type Big } from '../../domain/money';
import type { PivotAmount } from '../../domain/types';
import type { CsvTable } from '../csv';
import { utcStringToMs } from '../time';
import type { PivotIssue } from '../pivot/rows';
import { canonHeader, type PlatformConverter, type PlatformDraft } from './types';

const REQUIRED = ['txid', 'refid', 'time', 'type', 'asset', 'amount', 'fee', 'balance'] as const;

/** Codes historiques Kraken → codes usuels (avant `normalizeAssetCode`). */
const ASSET_MAP: Record<string, string> = {
  xxbt: 'btc',
  xbt: 'btc',
  xeth: 'eth',
  xxrp: 'xrp',
  xltc: 'ltc',
  xxlm: 'xlm',
  xxmr: 'xmr',
  xzec: 'zec',
  xxdg: 'doge',
  xdg: 'doge',
  xrep: 'rep',
  xmln: 'mln',
  xetc: 'etc',
  eth2: 'eth',
  zeur: 'eur',
  zusd: 'usd',
  zgbp: 'gbp',
  zjpy: 'jpy',
  zcad: 'cad',
  zchf: 'chf',
  zaud: 'aud',
};

export function krakenAsset(raw: string): string {
  // Suffixes staking/earn : ADA.S, ETH2.S, XBT.M, DOT28.S, ATOM21.S…
  const stripped = raw.trim().replace(/(?:\d{2})?\.(?:HOLD|M|P|S|F|B)$/i, '');
  const lower = stripped.toLowerCase();
  return ASSET_MAP[lower] ?? lower;
}

/** Un frais « cash » (EUR/USD/stables) est convertible : il reste un frais pivot. */
const cashFee = (asset: string): boolean => fiatEquivalent(asset) !== null || isFiat(asset);

interface KrakenRow {
  lineNo: number;
  native: string;
  txid: string;
  refid: string;
  timeMs: number;
  type: string;
  subtype: string;
  asset: string;
  amount: Big;
  fee: Big;
}

const PAIRED_TYPES = new Set(['trade', 'spend', 'receive']);
const MARGIN_TYPES = new Set(['margin', 'rollover', 'settled']);

export const krakenLedgers: PlatformConverter = {
  id: 'kraken-ledgers',
  label: 'Kraken — ledgers.csv',
  detect(header) {
    const canonical = header.map(canonHeader);
    return REQUIRED.every((name) => canonical.includes(name));
  },
  convert(table: CsvTable) {
    const canonical = table.header.map(canonHeader);
    const col = (name: string): number => canonical.indexOf(name);
    const c = {
      txid: col('txid'),
      refid: col('refid'),
      time: col('time'),
      type: col('type'),
      subtype: col('subtype'),
      asset: col('asset'),
      amount: col('amount'),
      fee: col('fee'),
    };
    const drafts: PlatformDraft[] = [];
    const issues: PivotIssue[] = [];
    let skippedInternal = 0;

    const rows: KrakenRow[] = [];
    table.rows.forEach((cells, i) => {
      const lineNo = table.lineNumbers[i]!;
      const cell = (index: number): string => (index >= 0 ? (cells[index] ?? '').trim() : '');
      const rawTime = cell(c.time);
      const timeMs = utcStringToMs(rawTime);
      if (timeMs === null) {
        issues.push({ lineNo, message: `Date illisible « ${rawTime} » (attendu UTC Kraken).` });
        return;
      }
      let amount: Big;
      let fee: Big;
      try {
        amount = D(cell(c.amount) === '' ? '0' : cell(c.amount));
        fee = D(cell(c.fee) === '' ? '0' : cell(c.fee)).abs();
      } catch {
        issues.push({ lineNo, message: `Montant illisible « ${cell(c.amount)} ».` });
        return;
      }
      rows.push({
        lineNo,
        native: cells.map((x) => (x ?? '').trim()).join('|'),
        txid: cell(c.txid),
        refid: cell(c.refid),
        timeMs,
        type: cell(c.type).toLowerCase(),
        subtype: cell(c.subtype).toLowerCase(),
        asset: krakenAsset(cell(c.asset)),
        amount,
        fee,
      });
    });

    /** Jambe d'une opération : quantité ajustée des frais non-cash, frais cash reporté. */
    const legOf = (
      row: KrakenRow,
      direction: 'sent' | 'received',
      notes: string[],
    ): { amount: PivotAmount | null; fee: PivotAmount | null } => {
      let qty = row.amount.abs();
      let fee: PivotAmount | null = null;
      if (row.fee.gt(ZERO)) {
        if (cashFee(row.asset)) {
          fee = { amount: row.fee.toString(), currency: row.asset };
        } else {
          qty = direction === 'sent' ? qty.plus(row.fee) : qty.minus(row.fee);
          notes.push(
            `frais ${row.fee.toString()} ${row.asset.toUpperCase()} ${
              direction === 'sent' ? 'ajoutés à la sortie' : 'déduits de la quantité reçue'
            }`,
          );
        }
      }
      if (qty.lte(ZERO)) return { amount: null, fee };
      return { amount: { amount: qty.toString(), currency: row.asset }, fee };
    };

    const single = (
      row: KrakenRow,
      direction: 'sent' | 'received',
      label: string | null,
      extraNote?: string,
    ): void => {
      const notes: string[] = extraNote ? [extraNote] : [];
      const { amount, fee } = legOf(row, direction, notes);
      drafts.push({
        lineNo: row.lineNo,
        nativeContent: row.native,
        timeMs: row.timeMs,
        sent: direction === 'sent' ? amount : null,
        received: direction === 'received' ? amount : null,
        fee,
        netWorth: null,
        label,
        description: notes.length > 0 ? `Kraken : ${notes.join(' ; ')}.` : null,
        txHash: null,
      });
    };

    // Paires trade/spend/receive par refid, dans l'ordre d'apparition.
    const pairs = new Map<string, KrakenRow[]>();
    for (const row of rows) {
      if (!PAIRED_TYPES.has(row.type)) continue;
      const list = pairs.get(row.refid) ?? [];
      list.push(row);
      pairs.set(row.refid, list);
    }
    const handledPairs = new Set<string>();

    for (const row of rows) {
      if (PAIRED_TYPES.has(row.type)) {
        if (handledPairs.has(row.refid)) continue;
        handledPairs.add(row.refid);
        const group = pairs.get(row.refid)!;
        const sentRow = group.find((r) => r.amount.lt(ZERO));
        const receivedRow = group.find((r) => r.amount.gt(ZERO));
        if (group.length !== 2 || !sentRow || !receivedRow) {
          for (const r of group)
            issues.push({
              lineNo: r.lineNo,
              message: `Échange incomplet (refid ${r.refid} : ${group.length} jambe(s)) : qualifiez l'opération à la main.`,
            });
          continue;
        }
        const notes: string[] = [];
        const sentLeg = legOf(sentRow, 'sent', notes);
        const receivedLeg = legOf(receivedRow, 'received', notes);
        // Un seul frais pivot : le frais cash (converti en aval) ; s'il y en a deux, le second
        // est signalé (jamais tu).
        let fee = sentLeg.fee ?? receivedLeg.fee;
        if (sentLeg.fee && receivedLeg.fee) {
          fee = sentLeg.fee;
          notes.push(
            `second frais ${receivedLeg.fee.amount} ${receivedLeg.fee.currency.toUpperCase()} non déduit`,
          );
        }
        const ordered = [sentRow, receivedRow].sort((a, b) => a.txid.localeCompare(b.txid));
        drafts.push({
          lineNo: Math.min(sentRow.lineNo, receivedRow.lineNo),
          nativeContent: `${ordered[0]!.native}||${ordered[1]!.native}`,
          timeMs: Math.min(sentRow.timeMs, receivedRow.timeMs),
          sent: sentLeg.amount,
          received: receivedLeg.amount,
          fee,
          netWorth: null,
          label: null,
          description: notes.length > 0 ? `Kraken : ${notes.join(' ; ')}.` : null,
          txHash: null,
        });
        continue;
      }
      switch (row.type) {
        case 'deposit':
          if (row.amount.gte(ZERO)) single(row, 'received', null);
          else single(row, 'sent', null, 'correction de dépôt');
          break;
        case 'withdrawal':
          single(row, 'sent', null);
          break;
        case 'staking':
        case 'earn':
          if (row.amount.gt(ZERO)) single(row, 'received', 'staking');
          else single(row, 'sent', null);
          break;
        case 'dividend':
        case 'invite bonus':
          single(row, 'received', 'reward');
          break;
        case 'adjustment':
          if (row.amount.gt(ZERO)) single(row, 'received', 'airdrop');
          else single(row, 'sent', null);
          break;
        case 'transfer':
          if (row.subtype === 'airdrop') single(row, 'received', 'airdrop');
          else skippedInternal++;
          break;
        default:
          if (MARGIN_TYPES.has(row.type)) {
            issues.push({
              lineNo: row.lineNo,
              message: `Ligne de marge Kraken (« ${row.type} ») : hors périmètre spot, non importée.`,
            });
          } else {
            issues.push({
              lineNo: row.lineNo,
              message: `Type Kraken inconnu « ${row.type} » : ligne non importée.`,
            });
          }
      }
    }
    return { drafts, issues, skippedInternal };
  },
};
