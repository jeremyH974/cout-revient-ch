/**
 * Relevé eToro (classeur) → brouillons de lignes pivot. Tout l'aval est le pipeline pivot commun :
 * la conversion USD → EUR au taux BCE **du jour de l'opération** y est déjà faite
 * (`pivot/events.ts`), ce qui est aussi la règle du Conseil d'État sur les plus-values en devises.
 *
 * Trois choix que le fichier réel a imposés, et qu'aucune documentation ne donnait :
 *
 * 1. **La feuille des positions ouvertes empile des instantanés.** Un relevé de dix-sept mois en
 *    contient quatre (01/01/2025, 30/06/2025, 31/12/2025, 01/01/2026) : lire toutes les lignes
 *    compterait le portefeuille trois fois, avec un résultat parfaitement plausible. Seul le
 *    dernier instantané est retenu.
 * 2. **`Open Rate` n'est pas en devise du compte.** Sur douze ETF de dix-huit, le rapport entre
 *    valeur et cours trahit une cotation en devise locale — l'un à un facteur cent, soit des
 *    centimes. Le coût vient donc de la feuille d'activité, seule à porter le montant réellement
 *    débité, joint par identifiant de position.
 * 3. **Le levier existe.** Les positions à effet de levier et les CFD sont écartés avec un motif
 *    nommé : il n'y a pas de quantité détenue derrière un contrat pour différence, et aucun moteur
 *    open source de référence n'en modélise une.
 */
import { equityCode, normalizeAssetCode } from '../../domain/assets';
import { D, ZERO } from '../../domain/money';
import type { PivotIssue } from '../pivot/rows';
import type { PlatformDraft } from '../platforms/types';
import type { Workbook } from '../xlsx/index';
import { findSheet, reader, SHEET_ALIASES } from './sheets';

export interface EtoroConversion {
  drafts: PlatformDraft[];
  issues: PivotIssue[];
  /** Lignes volontairement hors modèle (levier, CFD) : comptées, jamais tues. */
  skipped: number;
}

const EQUITY_TYPES = new Set(['stocks', 'actions', 'etf']);
const CRYPTO_TYPES = new Set(['crypto currencies', 'crypto-monnaies', 'cryptocurrencies']);

/** Devise du compte eToro : tous les montants d'activité y sont exprimés. */
const ACCOUNT_CURRENCY = 'usd';

/**
 * `dd/MM/yyyy HH:mm:ss` → millisecondes. **Le relevé est réputé en UTC** : eToro ne documente pas
 * le fuseau de ses horodatages, et l'écart possible d'une heure ne déplace un jour civil, donc un
 * taux de change, que pour une opération de fin de soirée.
 */
export function etoroDateToMs(raw: string): number | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const at = Date.UTC(
    Number(m[3]),
    Number(m[2]) - 1,
    Number(m[1]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6]),
  );
  return Number.isFinite(at) ? at : null;
}

/** `X1`, `1`, `2` → nombre. Une valeur absente vaut 1 : eToro n'omet le levier que sans levier. */
export function leverageOf(raw: string): number {
  const text = raw.trim().replace(/^x/i, '');
  if (text === '') return 1;
  const value = Number(text);
  return Number.isFinite(value) && value > 0 ? value : Number.NaN;
}

/** Code interne d'un actif selon la classe que la source déclare (décision n° 103). */
function assetCodeFor(symbol: string, type: string): string | null {
  const kind = type.trim().toLowerCase();
  if (EQUITY_TYPES.has(kind)) return equityCode(symbol);
  if (CRYPTO_TYPES.has(kind)) return normalizeAssetCode(symbol);
  return null;
}

const HOLDINGS_COLUMNS = {
  snapshot: ['snapshot date', 'date de l’instantané', "date de l'instantané"],
  asset: ['asset', 'actif'],
  positionId: ['position id', 'identifiant de position'],
  openDate: ['open date', 'date d’ouverture', "date d'ouverture"],
  leverage: ['leverage', 'effet de levier'],
  units: ['units', 'unités'],
  type: ['type', 'type d’actif', "type d'actif"],
};

const ACTIVITY_COLUMNS = {
  type: ['type'],
  amount: ['montant', 'amount'],
  positionId: ['identifiant de position', 'position id'],
};

const OPEN_LABELS = new Set(['position ouverte', 'open position']);

/** Coût réellement débité par position, lu dans le grand livre du compte. */
function costsByPosition(book: Workbook): Map<string, string> {
  const sheet = findSheet(book, SHEET_ALIASES.activity);
  const costs = new Map<string, string>();
  if (!sheet) return costs;
  const read = reader(sheet, ACTIVITY_COLUMNS);
  for (const row of sheet.rows) {
    if (!OPEN_LABELS.has(read.get(row, 'type').toLowerCase())) continue;
    const id = read.get(row, 'positionId');
    const amount = read.get(row, 'amount');
    if (id !== '' && amount !== '') costs.set(id, amount);
  }
  return costs;
}

const CLOSED_COLUMNS = {
  positionId: ['identifiant de position', 'position id'],
  asset: ['action', 'asset'],
  units: ['unités', 'units'],
  amount: ['montant', 'amount'],
  openDate: ['date d’ouverture', "date d'ouverture", 'open date'],
  closeDate: ['date de clôture', 'close date'],
  leverage: ['effet de levier', 'leverage'],
  profit: ['profit (usd)'],
  type: ['type'],
};

/**
 * Positions fermées → un achat daté de l'ouverture, puis une vente datée de la clôture. Le produit
 * de la vente est le montant investi augmenté du profit : c'est la définition même de la colonne,
 * et cela évite de reconstruire un cours de clôture dont la devise n'est pas fiable (§ 2).
 */
function closedDrafts(book: Workbook, drafts: PlatformDraft[], issues: PivotIssue[]): number {
  const sheet = findSheet(book, SHEET_ALIASES.closed);
  if (!sheet) return 0;
  const read = reader(sheet, CLOSED_COLUMNS);
  if (read.missing.length > 0) {
    issues.push({
      lineNo: 1,
      message: `Positions fermées, colonnes introuvables : ${read.missing.join(', ')}.`,
    });
    return 0;
  }
  let skipped = 0;
  sheet.rows.forEach((row, i) => {
    const lineNo = i + 2;
    const type = read.get(row, 'type');
    const leverage = leverageOf(read.get(row, 'leverage'));
    if (!Number.isFinite(leverage) || leverage !== 1) {
      issues.push({
        lineNo,
        message: `Position fermée à effet de levier (${leverage}×) : hors périmètre.`,
      });
      skipped += 1;
      return;
    }
    const code = assetCodeFor(read.get(row, 'asset'), type);
    if (code === null) {
      issues.push({ lineNo, message: `Position fermée de type « ${type} » : hors périmètre.` });
      skipped += 1;
      return;
    }
    const units = read.get(row, 'units');
    const amount = read.get(row, 'amount');
    const openMs = etoroDateToMs(read.get(row, 'openDate'));
    const closeMs = etoroDateToMs(read.get(row, 'closeDate'));
    if (units === '' || amount === '' || openMs === null || closeMs === null) {
      issues.push({ lineNo, message: 'Position fermée : quantité, montant ou date illisible.' });
      return;
    }
    const profit = read.get(row, 'profit');
    const proceeds = D(amount).plus(profit === '' ? ZERO : D(profit));
    const id = read.get(row, 'positionId');
    drafts.push({
      lineNo,
      nativeContent: `etoro:closed:buy:${id}`,
      timeMs: openMs,
      sent: { amount, currency: ACCOUNT_CURRENCY },
      received: { amount: units, currency: code },
      fee: null,
      netWorth: null,
      label: null,
      description: null,
      txHash: null,
    });
    drafts.push({
      lineNo,
      nativeContent: `etoro:closed:sell:${id}`,
      timeMs: closeMs,
      sent: { amount: units, currency: code },
      received: { amount: proceeds.toString(), currency: ACCOUNT_CURRENCY },
      fee: null,
      netWorth: null,
      label: null,
      description: null,
      txHash: null,
    });
  });
  return skipped;
}

export function convertEtoroWorkbook(book: Workbook): EtoroConversion {
  const drafts: PlatformDraft[] = [];
  const issues: PivotIssue[] = [];
  let skipped = 0;

  const holdings = findSheet(book, SHEET_ALIASES.holdings);
  if (!holdings) {
    return {
      drafts,
      issues: [{ lineNo: 0, message: 'Feuille des positions absente du relevé.' }],
      skipped,
    };
  }
  const read = reader(holdings, HOLDINGS_COLUMNS);
  if (read.missing.length > 0) {
    const names = read.missing.join(', ');
    return {
      drafts,
      issues: [{ lineNo: 1, message: `Colonnes introuvables : ${names}.` }],
      skipped,
    };
  }

  // Un relevé empile plusieurs photos du portefeuille : seule la plus récente décrit ce qui est détenu.
  const serials = holdings.rows
    .map((row) => Number(read.get(row, 'snapshot')))
    .filter((n) => Number.isFinite(n));
  const latest = serials.length > 0 ? Math.max(...serials) : Number.NaN;

  const costs = costsByPosition(book);
  holdings.rows.forEach((row, i) => {
    const lineNo = i + 2;
    if (Number(read.get(row, 'snapshot')) !== latest) return;

    const type = read.get(row, 'type');
    const leverage = leverageOf(read.get(row, 'leverage'));
    if (!Number.isFinite(leverage) || leverage !== 1) {
      issues.push({
        lineNo,
        message: `Position à effet de levier (${leverage}×) : hors périmètre.`,
      });
      skipped += 1;
      return;
    }
    const code = assetCodeFor(read.get(row, 'asset'), type);
    if (code === null) {
      issues.push({
        lineNo,
        message: `Type d’actif « ${type} » hors périmètre (contrat pour différence ?).`,
      });
      skipped += 1;
      return;
    }
    const units = read.get(row, 'units');
    const timeMs = etoroDateToMs(read.get(row, 'openDate'));
    if (units === '' || timeMs === null) {
      issues.push({ lineNo, message: 'Quantité ou date d’ouverture illisible.' });
      return;
    }
    const positionId = read.get(row, 'positionId');
    const cost = costs.get(positionId);
    if (cost === undefined) {
      issues.push({
        lineNo,
        message: `Coût introuvable pour la position ${positionId} : ouverte avant le début du relevé.`,
      });
      return;
    }
    drafts.push({
      lineNo,
      nativeContent: `etoro:open:${positionId}`,
      timeMs,
      sent: { amount: cost, currency: ACCOUNT_CURRENCY },
      received: { amount: units, currency: code },
      fee: null,
      netWorth: null,
      label: null,
      description: null,
      txHash: null,
    });
  });

  skipped += closedDrafts(book, drafts, issues);
  return { drafts, issues, skipped };
}
