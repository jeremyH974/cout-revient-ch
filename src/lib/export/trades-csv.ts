/**
 * Export CSV des trades et de leur journal (P22) : colonnes lisibles par un tableur français
 * (`;`, virgule décimale, BOM) et par les journaux du marché (TradesViz et consorts acceptent un
 * CSV générique). Les montants sont dans la devise de cotation du trade (USD/USDC ou EUR), jamais
 * convertis : un export doit être rejouable, pas dépendant du taux du jour.
 */
import type { Big } from '../domain/money';
import type { JournaledTrip } from '../domain/trading/journal';

const BOM = '﻿';
const EOL = '\r\n';

const num = (value: Big | null, dp = 9): string =>
  value === null
    ? ''
    : value
        .toFixed(dp)
        .replace(/\.?0+$/, '')
        .replace(/^-0$/, '0')
        .replace('.', ',');
const text = (value: string): string => `"${value.replace(/"/g, '""')}"`;
const naive = (value: string | null): string =>
  value === null
    ? ''
    : `${value.slice(0, 10).split('-').reverse().join('/')} ${value.slice(11, 16)}`;

export const TRADES_CSV_HEADER = [
  'Ouvert le',
  'Clos le',
  'Statut',
  'Compte',
  'Symbole',
  'Sens',
  'Taille max',
  'Entrée moyenne',
  'Sortie moyenne',
  'Devise',
  'P&L brut',
  'Frais',
  'Funding',
  'P&L net',
  'R',
  'Durée (s)',
  'Liquidation',
  'Historique partiel',
  'Setup',
  'Tags',
  'Erreurs',
  'Note /5',
  'Thèse',
  'Revue',
  'Source',
];

export function tradesToCsv(
  trips: readonly JournaledTrip[],
  accountLabels: Readonly<Record<string, string>> = {},
): string {
  const rows = trips.map((t) => {
    const trip = t.trip;
    const journal = t.journal;
    return [
      naive(trip.openedAt),
      naive(trip.closedAt),
      trip.status === 'closed' ? 'clos' : 'ouvert',
      text(accountLabels[trip.accountId] ?? trip.accountId),
      text(trip.symbol),
      trip.direction === 'long' ? 'long' : 'short',
      num(trip.qtyMax),
      num(trip.avgEntry, 10),
      num(trip.avgExit, 10),
      trip.quote,
      num(trip.grossPnl, 2),
      num(trip.fees, 2),
      num(trip.funding, 2),
      num(trip.netPnl, 2),
      num(t.r, 2),
      trip.holdSeconds === null ? '' : String(trip.holdSeconds),
      trip.liquidated ? 'oui' : '',
      trip.incomplete ? 'oui' : '',
      text(journal?.setup ?? ''),
      text((journal?.tags ?? []).join(', ')),
      text((journal?.mistakes ?? []).join(', ')),
      journal?.rating === null || journal === null ? '' : String(journal.rating),
      text(journal?.thesis ?? ''),
      text(journal?.review ?? ''),
      trip.source === 'manual' ? 'Manuel' : 'Hyperliquid',
    ];
  });
  return (
    BOM + [TRADES_CSV_HEADER.join(';'), ...rows.map((cells) => cells.join(';'))].join(EOL) + EOL
  );
}
