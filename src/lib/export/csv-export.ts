/** Export tableur : `;` + BOM UTF-8 + virgule décimale (s'ouvre directement dans Excel FR). */
import type { PortfolioReport, PositionReport } from '../domain/engine';
import { D, type Big } from '../domain/money';

const BOM = '﻿';
const cell = (value: Big | null | undefined, dp = 8): string =>
  value == null
    ? ''
    : value
        .toFixed(dp)
        .replace(/\.?0+$/, '')
        .replace('.', ',');
const text = (value: string): string => `"${value.replace(/"/g, '""')}"`;

export function positionsToCsv(report: PortfolioReport): string {
  const header = [
    'Actif',
    'Statut',
    'Quantité',
    'PRU (€)',
    'Investi (€)',
    'Prix (€)',
    'Valeur (€)',
    'Latent (€)',
    'Latent (%)',
    'Réalisé (€)',
    'Total (€)',
    'ROI (%)',
    'Net investi (€)',
    'Frais (€)',
    'Remises (€)',
  ];
  const rows: PositionReport[] = [
    ...report.positions,
    ...report.stablecoins,
    ...report.closed,
    ...report.blocked,
  ];
  const lines = rows.map((p) =>
    [
      text(p.asset.toUpperCase()),
      text(p.closed ? 'clôturée' : p.status),
      cell(p.qty),
      cell(p.pru, 6),
      cell(p.costBasis, 2),
      p.price ? cell(D(p.price.priceEur), 6) : '',
      cell(p.value, 2),
      cell(p.unrealized, 2),
      p.unrealizedPct ? cell(p.unrealizedPct.times('100'), 2) : '',
      cell(p.realized, 2),
      cell(p.total, 2),
      p.roi ? cell(p.roi.times('100'), 2) : '',
      cell(p.netInvested, 2),
      cell(p.feesEur, 2),
      cell(p.rebatesEur, 2),
    ].join(';'),
  );
  return BOM + [header.join(';'), ...lines].join('\r\n') + '\r\n';
}
