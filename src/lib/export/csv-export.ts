/**
 * Exports tableur : `;` + BOM UTF-8 + virgule décimale (s'ouvrent directement dans Excel FR).
 * Colonnes documentées dans docs/exports.md ; montants dans la devise d'affichage.
 */
import type { HistoryEntry, PortfolioReport, PositionReport } from '../domain/engine';
import type { Big } from '../domain/money';
import { CURRENCY_INFO, type Currency } from '../fx/types';
import type { MetricPoint } from '../history/metrics';

const BOM = '﻿';
const EOL = '\r\n';

const num = (value: Big | null | undefined, dp = 8): string =>
  value == null
    ? ''
    : value
        .toFixed(dp)
        .replace(/\.?0+$/, '')
        .replace(/^-0$/, '0')
        .replace('.', ',');
const text = (value: string): string => `"${value.replace(/"/g, '""')}"`;
const join = (cells: string[]): string => cells.join(';');
const file = (header: string[], rows: string[][]): string =>
  BOM + [join(header), ...rows.map(join)].join(EOL) + EOL;
const day = (naive: string): string => naive.slice(0, 10).split('-').reverse().join('/');
const time = (naive: string): string => naive.slice(11, 16);

const KIND_LABELS: Record<HistoryEntry['kind'], string> = {
  buy: 'Achat',
  sell: 'Vente',
  reward: 'Récompense',
  deposit: 'Dépôt',
  withdrawal: 'Retrait',
  'migration-in': 'Migration (entrée)',
  'migration-out': 'Migration (sortie)',
  'opening-balance': 'Solde initial',
};

const allPositions = (r: PortfolioReport): PositionReport[] => [
  ...r.positions,
  ...r.stablecoins,
  ...r.closed,
  ...r.blocked,
];
const sym = (currency: Currency): string => CURRENCY_INFO[currency].symbol;

export function positionsToCsv(report: PortfolioReport, currency: Currency = 'EUR'): string {
  const c = sym(currency);
  const header = [
    'Actif',
    'Statut',
    'Quantité',
    `PRU (${c})`,
    `Investi (${c})`,
    `Prix (${c})`,
    `Valeur (${c})`,
    `Latent (${c})`,
    'Latent (%)',
    `Réalisé (${c})`,
    `Total (${c})`,
    'ROI (%)',
    `Net investi (${c})`,
    `Frais (${c})`,
    `Remises (${c})`,
  ];
  const rows = allPositions(report).map((p) => [
    text(p.asset.toUpperCase()),
    text(p.closed ? 'clôturée' : p.status),
    num(p.qty),
    num(p.pru, 6),
    num(p.costBasis, 2),
    p.price ? p.price.priceEur.replace('.', ',') : '',
    num(p.value, 2),
    num(p.unrealized, 2),
    p.unrealizedPct ? num(p.unrealizedPct.times('100'), 2) : '',
    num(p.realized, 2),
    num(p.total, 2),
    p.roi ? num(p.roi.times('100'), 2) : '',
    num(p.netInvested, 2),
    num(p.feesEur, 2),
    num(p.rebatesEur, 2),
  ]);
  return file(header, rows);
}

/** Historique normalisé : une ligne par opération et par actif, PRU et quantité après chaque ligne. */
export function operationsToCsv(
  report: PortfolioReport,
  currency: Currency = 'EUR',
  asset?: string,
): string {
  const c = sym(currency);
  const header = [
    'Date',
    'Heure',
    'Actif',
    'Opération',
    'Quantité',
    `Montant all-in (${c})`,
    `Prix unitaire (${c})`,
    'Contrepartie',
    "Cours d'exécution",
    'Devise du cours',
    `Frais (${c})`,
    `Remise (${c})`,
    `Réalisé (${c})`,
    `PRU après (${c})`,
    'Quantité après',
    'Source',
    'Identifiant',
    'Avertissements',
  ];
  const rows: { at: string; cells: string[] }[] = [];
  for (const p of allPositions(report)) {
    if (asset && p.asset !== asset) continue;
    for (const h of p.history) {
      rows.push({
        at: h.at,
        cells: [
          day(h.at),
          time(h.at),
          text(p.asset.toUpperCase()),
          text(KIND_LABELS[h.kind] ?? h.kind),
          num(h.qty),
          num(h.valueEur, 2),
          num(h.unitPrice, 6),
          text(h.counterAsset?.toUpperCase() ?? ''),
          h.quotePrice ? h.quotePrice.price.replace('.', ',') : '',
          text(h.quotePrice?.asset.toUpperCase() ?? ''),
          num(h.feeEur, 2),
          num(h.rebateEur, 2),
          num(h.realized, 2),
          num(h.pruAfter, 6),
          num(h.qtyAfter),
          text(h.eventId.startsWith('man:') ? 'Manuel' : 'Coinhouse'),
          text(h.eventId.replace(/^(ch|man):/, '')),
          text(h.warnings.join(' | ')),
        ],
      });
    }
  }
  rows.sort((a, b) => a.at.localeCompare(b.at));
  return file(
    header,
    rows.map((r) => r.cells),
  );
}

export function lotsToCsv(report: PortfolioReport, currency: Currency = 'EUR'): string {
  const c = sym(currency);
  const header = [
    'Actif',
    'Ouvert le',
    'Origine',
    'Contrepartie',
    'Quantité initiale',
    'Quantité restante',
    `Coût initial (${c})`,
    `Coût restant (${c})`,
    `Prix all-in (${c})`,
    `Valeur (${c})`,
    `Latent (${c})`,
    'Latent (%)',
  ];
  const rows: string[][] = [];
  for (const p of allPositions(report)) {
    for (const lot of p.lots) {
      rows.push([
        text(p.asset.toUpperCase()),
        day(lot.openedAt) + ' ' + time(lot.openedAt),
        text(lot.origin),
        text(lot.counterAsset?.toUpperCase() ?? ''),
        num(lot.qtyInitial),
        num(lot.qtyRemaining),
        num(lot.costInitial, 2),
        num(lot.costRemaining, 2),
        num(lot.unitCost, 6),
        num(lot.value, 2),
        num(lot.unrealized, 2),
        lot.unrealizedPct ? num(lot.unrealizedPct.times('100'), 2) : '',
      ]);
    }
  }
  return file(header, rows);
}

/** Série d'évolution affichée (jour, valeur, investi, latent, quantité, prix, PRU). */
export function seriesToCsv(points: readonly MetricPoint[], currency: Currency = 'EUR'): string {
  const c = sym(currency);
  const header = [
    'Jour',
    `Valeur (${c})`,
    `Investi (${c})`,
    `Latent (${c})`,
    'Latent (%)',
    'Quantité',
    `Prix (${c})`,
    `PRU (${c})`,
  ];
  const rows = points.map((p) => {
    const latent = p.value.minus(p.cost);
    const pru = p.qty !== null && p.qty.gt('0') ? p.cost.div(p.qty) : null;
    return [
      p.day.length > 10 ? text(p.day) : day(p.day),
      num(p.value, 2),
      num(p.cost, 2),
      num(latent, 2),
      p.cost.gt('0') ? num(latent.div(p.cost).times('100'), 2) : '',
      num(p.qty),
      num(p.price, 6),
      num(pru, 6),
    ];
  });
  return file(header, rows);
}
