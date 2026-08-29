/**
 * Exports tableur : `;` + BOM UTF-8 + virgule décimale (s'ouvrent directement dans Excel FR).
 * Colonnes documentées dans docs/exports.md ; montants dans la devise d'affichage.
 */
import { concernedDeclarations, type DeclarationReport } from '../domain/declarations-fr';
import type { HistoryEntry, PortfolioReport, PositionReport } from '../domain/engine';
import { COINHOUSE_ACCOUNT_ID, MANUAL_ACCOUNT_ID, type AccountId } from '../domain/types';
import { D, type Big } from '../domain/money';
import type { TaxLedger } from '../domain/tax-fr';
import { countryName, STATUS_LABELS } from '../format/declarations-fr';
import { roundHalfUp } from '../format/fr';
import { CURRENCY_INFO, type Currency } from '../fx/types';
import type { MetricPoint } from '../history/metrics';

const BOM = '﻿';
const EOL = '\r\n';

// Arrondi half-up (comme à l'écran, via fr.ts) ; quantités à 9 décimales (précision de l'export
// Coinhouse), prix et PRU à 10 (4 chiffres significatifs même sous 1e-6), montants à 2.
const num = (value: Big | null | undefined, dp = 9): string =>
  value == null
    ? ''
    : roundHalfUp(value, dp)
        .toFixed(dp)
        .replace(/\.?0+$/, '')
        .replace(/^-0$/, '0')
        .replace('.', ',');
const text = (value: string): string => `"${value.replace(/"/g, '""')}"`;
const join = (cells: string[]): string => cells.join(';');
const file = (header: string[], rows: string[][]): string =>
  BOM + [join(header), ...rows.map(join)].join(EOL) + EOL;
/** Origine d'une ligne d'historique d'après le préfixe de son identifiant d'événement. */
const sourceLabel = (eventId: string): string =>
  eventId.startsWith('man:') ? 'Manuel' : eventId.startsWith('hl:') ? 'Hyperliquid' : 'Coinhouse';
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
    num(p.pru, 10),
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
/** Libellé d'un compte pour les exports ; les deux comptes implicites ont un nom fixe. */
export function accountLabel(accountId: AccountId, labels: Record<AccountId, string> = {}): string {
  if (labels[accountId]) return labels[accountId];
  if (accountId === COINHOUSE_ACCOUNT_ID) return 'Coinhouse';
  if (accountId === MANUAL_ACCOUNT_ID) return 'Manuel';
  return accountId;
}

export function operationsToCsv(
  report: PortfolioReport,
  currency: Currency = 'EUR',
  asset?: string,
  accountLabels: Record<AccountId, string> = {},
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
    'Compte',
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
          num(h.unitPrice, 10),
          text(h.counterAsset?.toUpperCase() ?? ''),
          h.quotePrice ? h.quotePrice.price.replace('.', ',') : '',
          text(h.quotePrice?.asset.toUpperCase() ?? ''),
          num(h.feeEur, 2),
          num(h.rebateEur, 2),
          num(h.realized, 2),
          num(h.pruAfter, 10),
          num(h.qtyAfter),
          text(sourceLabel(h.eventId)),
          text(accountLabel(h.accountId, accountLabels)),
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
        num(lot.unitCost, 10),
        num(lot.value, 2),
        num(lot.unrealized, 2),
        lot.unrealizedPct ? num(lot.unrealizedPct.times('100'), 2) : '',
      ]);
    }
  }
  return file(header, rows);
}

/**
 * Série d'évolution affichée (jour ou instant, valeur, investi, latent, quantité, prix, PRU).
 * Période 1J : instants ISO 8601 (UTC) sous l'en-tête « Instant » ; sinon jours « jj/mm/aaaa ».
 * Prix vide = aucune cotation ce jour-là (valeur estimée au coût).
 */
export function seriesToCsv(points: readonly MetricPoint[], currency: Currency = 'EUR'): string {
  const c = sym(currency);
  const intraday = (points[0]?.day.length ?? 0) > 10;
  const header = [
    intraday ? 'Instant' : 'Jour',
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
      num(p.price, 10),
      num(pru, 10),
    ];
  });
  return file(header, rows);
}

/**
 * Cessions imposables au format du formulaire **2086** (décision n° 50) : une ligne par cession,
 * dans l'ordre des colonnes du millésime 2026 (date, valeur globale du portefeuille, prix de
 * cession, prix total d'acquisition, plus-value). **Aide au report, pas une déclaration** : les
 * chiffres restent des estimations, à vérifier avec un professionnel.
 */
export function cessionsToCsv(ledger: TaxLedger, year?: number): string {
  const cessions =
    year === undefined ? ledger.cessions : ledger.cessions.filter((c) => c.year === year);
  const header = [
    'Date de la cession',
    'Prix de cession (€)',
    'Valeur globale du portefeuille (€)',
    "Prix total d'acquisition (€)",
    "Fraction du prix d'acquisition imputée (€)",
    'Plus ou moins-value (€)',
    'Estimation complète',
  ];
  const rows = cessions.map((c) => [
    text(day(c.at)),
    num(D(c.proceedsEur)),
    c.globalValueEur === null ? text('inconnue') : num(D(c.globalValueEur)),
    num(D(c.ptaBefore)),
    c.acquisitionShareEur === null ? text('—') : num(D(c.acquisitionShareEur)),
    c.gainEur === null ? text('—') : num(D(c.gainEur)),
    // Une cession sans valeur globale ne peut pas être chiffrée : la colonne le dit, ligne par ligne.
    text(c.gainEur === null ? 'non — valeur du portefeuille inconnue ce jour-là' : 'oui'),
  ]);
  return file(header, rows);
}

/**
 * Comptes à déclarer au formulaire **3916-bis** (P66) : une ligne par compte CONCERNÉ, c'est-à-dire
 * tout sauf ceux hors périmètre France d'office (Coinhouse, compte au pays `'FR'`). **Aide au
 * report, pas une déclaration** : à vérifier avec un professionnel avant tout report.
 */
export function accountDeclarationsToCsv(declarations: DeclarationReport): string {
  const header = [
    'Compte',
    'Statut',
    'Pays de l’organisme',
    'Utilisé dans l’année',
    'Détenu actuellement',
    'Peut-être clos dans l’année',
  ];
  const yesNo = (value: boolean): string => text(value ? 'oui' : 'non');
  const rows = concernedDeclarations(declarations).map((a) => [
    text(a.label),
    text(STATUS_LABELS[a.status]),
    text(a.country ? countryName(a.country) : 'inconnu'),
    yesNo(a.usedInYear),
    yesNo(a.currentlyHolds),
    yesNo(a.possiblyClosedInYear),
  ]);
  return file(header, rows);
}
