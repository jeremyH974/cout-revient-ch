/**
 * Relevé eToro (classeur) → brouillons de lignes pivot. Tout l'aval est le pipeline pivot commun :
 * la conversion USD → EUR au taux BCE **du jour de l'opération** y est déjà faite
 * (`pivot/events.ts`), ce qui est aussi la règle du Conseil d'État sur les plus-values en devises.
 *
 * **La source est le grand livre d'activité, pas la photo des positions.** La feuille « Holdings »
 * empile des instantanés périodiques : sur un relevé de vingt mois, le plus récent datait de huit
 * mois et ignorait trente et une positions ouvertes depuis — près d'un tiers du portefeuille, sans
 * le moindre signe. Elle ne sert plus qu'à deux choses : donner le nom et l'ISIN d'un instrument,
 * et **contrôler** les quantités à sa propre date.
 *
 * **L'identité d'un actif est son ticker.** Chaque feuille en désigne un autrement — Holdings donne
 * un nom et un ISIN, l'activité un couple `TICKER/DEVISE`, les positions fermées un
 * `Nom (TICKER)`. Le ticker est le seul présent partout, et le seul qu'un fournisseur de cours
 * sache interroger.
 *
 * Restent écartés avec un motif nommé : effet de levier et contrats pour différence — il n'y a pas
 * de quantité détenue derrière un CFD, et aucun moteur open source de référence n'en modélise une.
 */
import { equityCode, normalizeAssetCode } from '../../domain/assets';
import { D, isPositive, ZERO } from '../../domain/money';
import type { PivotIssue } from '../pivot/rows';
import type { PlatformDraft } from '../platforms/types';
import { excelSerialToNaive, type Workbook } from '../xlsx/index';
import { findSheet, reader, SHEET_ALIASES } from './sheets';

export interface EtoroConversion {
  drafts: PlatformDraft[];
  issues: PivotIssue[];
  /** Lignes volontairement hors modèle (levier, CFD) : comptées, jamais tues. */
  skipped: number;
  /** Nom commercial par code, pour l’affichage : un ticker seul ne dit pas grand-chose. */
  labels: Record<string, string>;
}

const EQUITY_TYPES = new Set(['stocks', 'actions', 'etf']);
const CRYPTO_TYPES = new Set(['crypto currencies', 'crypto-monnaies', 'cryptocurrencies']);

/** Devise du compte eToro : tous les montants du grand livre y sont exprimés. */
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

/** Ticker que les positions fermées accolent au nom : « Dogecoin (DOGE) ». */
const TICKER_SUFFIX = /[ ]*[(]([A-Za-z0-9.-]{1,16})[)][ ]*$/;

/** Ticker et devise de cotation du grand livre : « NOW/USD », « SPCX.24-7/USD ». */
const PAIR = /^([A-Za-z0-9.-]{1,16})[/]([A-Za-z]{3})$/;

function tickerOf(raw: string): string | null {
  const text = raw.trim();
  const pair = PAIR.exec(text);
  if (pair) return pair[1]!;
  const suffix = TICKER_SUFFIX.exec(text);
  return suffix ? suffix[1]! : null;
}

/** Nom d'affichage : le libellé débarrassé du ticker qu'il répète. */
function labelOf(raw: string): string {
  return raw.trim().replace(TICKER_SUFFIX, '').trim();
}

type Resolution = { ok: true; code: string } | { ok: false; message: string; outOfScope: boolean };

/**
 * Code interne d'un actif, depuis son **ticker** et la classe que la source déclare
 * (décision n° 103). Un titre est préfixé, une crypto garde son ticker nu — c'est celui qu'emploient
 * déjà les autres plateformes, donc les positions se rejoignent au lieu de se dédoubler.
 */
function resolveTicker(ticker: string, type: string): Resolution {
  const kind = type.trim().toLowerCase();
  if (EQUITY_TYPES.has(kind)) return { ok: true, code: equityCode(ticker) };
  if (CRYPTO_TYPES.has(kind)) return { ok: true, code: normalizeAssetCode(ticker) };
  return {
    ok: false,
    message: `Type d’actif « ${type} » hors périmètre (contrat pour différence ?).`,
    outOfScope: true,
  };
}

const ACTIVITY_COLUMNS = {
  date: ['date'],
  type: ['type'],
  details: ['détails', 'details'],
  amount: ['montant', 'amount'],
  units: ['unités', 'units'],
  positionId: ['identifiant de position', 'position id'],
  assetType: ['type d’actif', "type d'actif", 'asset type'],
};

const HOLDINGS_COLUMNS = {
  snapshot: ['snapshot date', 'date de l’instantané', "date de l'instantané"],
  asset: ['asset', 'actif'],
  positionId: ['position id', 'identifiant de position'],
  units: ['units', 'unités'],
  type: ['type', 'type d’actif', "type d'actif"],
  isin: ['isin'],
};

const CLOSED_COLUMNS = {
  positionId: ['identifiant de position', 'position id'],
  asset: ['action', 'asset'],
  units: ['unités', 'units'],
  amount: ['montant', 'amount'],
  closeDate: ['date de clôture', 'close date'],
  leverage: ['effet de levier', 'leverage'],
  profit: ['profit (usd)'],
  type: ['type'],
};

/** Étiquette des actions de société dans le grand livre : « corp action: Split ». */
const SPLIT_LABELS = /^corp action:[ ]*split$/i;

/**
 * Ratio d'un fractionnement, tel qu'eToro l'écrit dans le libellé : « HON/USD 1:2 ».
 *
 * **Le sens n'est documenté nulle part.** `a:b` est lu « a devient b », donc un multiplicateur
 * `b/a` — la lecture courante de « 1 pour 2 ». Un regroupement compris à l’envers diviserait une
 * position au lieu de la multiplier : l'opération est donc signalée à l'utilisateur, jamais
 * appliquée en silence.
 */
const SPLIT_RATIO = /([0-9]+(?:[.][0-9]+)?)[ ]*:[ ]*([0-9]+(?:[.][0-9]+)?)[ ]*$/;

export function splitRatioOf(details: string): string | null {
  const found = SPLIT_RATIO.exec(details.trim());
  if (!found) return null;
  const from = D(found[1]!);
  const to = D(found[2]!);
  if (!isPositive(from) || !isPositive(to)) return null;
  return to.div(from).toString();
}

const OPEN_LABELS = new Set(['position ouverte', 'open position']);

interface Collected {
  drafts: PlatformDraft[];
  issues: PivotIssue[];
  labels: Record<string, string>;
  /** Code d'actif par identifiant de position : le lien entre les trois feuilles. */
  codeByPosition: Map<string, string>;
  skipped: number;
}

/**
 * Fractionnement d'action. Le libellé porte le ticker et le ratio ; la classe vient de la colonne
 * de type, et l'identifiant de position rattache l'opération à un actif déjà connu.
 */
function collectSplit(
  row: readonly string[],
  lineNo: number,
  read: ReturnType<typeof reader>,
  out: Collected,
): void {
  const details = read.get(row, 'details');
  const ratio = splitRatioOf(details);
  if (ratio === null) {
    out.issues.push({ lineNo, message: `Fractionnement « ${details} » : ratio illisible.` });
    return;
  }
  const known = out.codeByPosition.get(read.get(row, 'positionId'));
  // « HON/USD 1:2 » : le couple précède le ratio, séparé par une espace.
  const ticker = tickerOf(details.split(' ')[0] ?? details);
  const resolved =
    known !== undefined
      ? ({ ok: true, code: known } as Resolution)
      : ticker !== null
        ? resolveTicker(ticker, read.get(row, 'assetType'))
        : ({
            ok: false,
            message: `Fractionnement « ${details} » : actif introuvable.`,
            outOfScope: false,
          } as Resolution);
  if (!resolved.ok) {
    out.issues.push({ lineNo, message: resolved.message });
    return;
  }
  const timeMs = etoroDateToMs(read.get(row, 'date'));
  if (timeMs === null) {
    out.issues.push({ lineNo, message: 'Fractionnement : date illisible.' });
    return;
  }
  out.issues.push({
    lineNo,
    message: `Fractionnement appliqué à ${resolved.code} : quantité multipliée par ${ratio} (« ${details} »). Vérifiez le sens, eToro ne le documente pas.`,
  });
  out.drafts.push({
    lineNo,
    nativeContent: `etoro:split:${read.get(row, 'positionId')}:${details}`,
    timeMs,
    sent: null,
    received: null,
    fee: null,
    netWorth: null,
    label: null,
    description: null,
    txHash: null,
    corporateAction: { kind: 'split', asset: resolved.code, ratio },
  });
}

/**
 * Ouvertures de position, depuis le grand livre. C'est **la** source des acquisitions : la photo
 * des positions n'en couvre qu'une partie, et jamais les plus récentes.
 */
function collectOpenings(book: Workbook, out: Collected): void {
  const sheet = findSheet(book, SHEET_ALIASES.activity);
  if (!sheet) {
    out.issues.push({ lineNo: 0, message: 'Feuille d’activité absente du relevé.' });
    return;
  }
  const read = reader(sheet, ACTIVITY_COLUMNS);
  if (read.missing.length > 0) {
    out.issues.push({
      lineNo: 1,
      message: `Activité, colonnes introuvables : ${read.missing.join(', ')}.`,
    });
    return;
  }
  sheet.rows.forEach((row, i) => {
    const lineNo = i + 2;
    const kind = read.get(row, 'type');
    if (SPLIT_LABELS.test(kind)) {
      collectSplit(row, lineNo, read, out);
      return;
    }
    if (!OPEN_LABELS.has(kind.toLowerCase())) return;

    const details = read.get(row, 'details');
    const ticker = tickerOf(details);
    if (ticker === null) {
      out.issues.push({ lineNo, message: `Ouverture « ${details} » : ticker illisible.` });
      return;
    }
    const resolved = resolveTicker(ticker, read.get(row, 'assetType'));
    if (!resolved.ok) {
      out.issues.push({ lineNo, message: resolved.message });
      if (resolved.outOfScope) out.skipped += 1;
      return;
    }
    const units = read.get(row, 'units');
    const amount = read.get(row, 'amount');
    const timeMs = etoroDateToMs(read.get(row, 'date'));
    if (units === '' || amount === '' || timeMs === null) {
      out.issues.push({ lineNo, message: 'Ouverture : quantité, montant ou date illisible.' });
      return;
    }
    const positionId = read.get(row, 'positionId');
    if (positionId !== '') out.codeByPosition.set(positionId, resolved.code);
    out.labels[resolved.code] ??= ticker;
    out.drafts.push({
      lineNo,
      nativeContent: `etoro:open:${positionId}`,
      timeMs,
      sent: { amount, currency: ACCOUNT_CURRENCY },
      received: { amount: units, currency: resolved.code },
      fee: null,
      netWorth: null,
      label: null,
      description: null,
      txHash: null,
    });
  });
}

/**
 * Clôtures : **la vente seulement**. L'achat correspondant est déjà dans le grand livre — le
 * produire ici aussi doublerait chaque position revendue.
 *
 * Le produit de la vente est le montant investi augmenté du profit : c'est la définition même de
 * la colonne, et cela évite de reconstruire un cours de clôture dont la devise n'est pas fiable.
 */
function collectClosings(book: Workbook, out: Collected): void {
  const sheet = findSheet(book, SHEET_ALIASES.closed);
  if (!sheet) return;
  const read = reader(sheet, CLOSED_COLUMNS);
  if (read.missing.length > 0) {
    out.issues.push({
      lineNo: 1,
      message: `Positions fermées, colonnes introuvables : ${read.missing.join(', ')}.`,
    });
    return;
  }
  sheet.rows.forEach((row, i) => {
    const lineNo = i + 2;
    const leverage = leverageOf(read.get(row, 'leverage'));
    if (!Number.isFinite(leverage) || leverage !== 1) {
      out.issues.push({
        lineNo,
        message: `Position fermée à effet de levier (${leverage}×) : hors périmètre.`,
      });
      out.skipped += 1;
      return;
    }
    const positionId = read.get(row, 'positionId');
    const asset = read.get(row, 'asset');
    const ticker = tickerOf(asset);
    const known = out.codeByPosition.get(positionId);
    const resolved =
      known !== undefined
        ? ({ ok: true, code: known } as Resolution)
        : ticker !== null
          ? resolveTicker(ticker, read.get(row, 'type'))
          : ({
              ok: false,
              message: `Position fermée « ${asset} » : ticker illisible.`,
              outOfScope: false,
            } as Resolution);
    if (!resolved.ok) {
      out.issues.push({ lineNo, message: resolved.message });
      if (resolved.outOfScope) out.skipped += 1;
      return;
    }
    // Le nom complet des positions fermées est plus parlant qu'un ticker : il l'emporte.
    const label = labelOf(asset);
    if (label !== '') out.labels[resolved.code] = label;

    const units = read.get(row, 'units');
    const amount = read.get(row, 'amount');
    const closeMs = etoroDateToMs(read.get(row, 'closeDate'));
    if (units === '' || amount === '' || closeMs === null) {
      out.issues.push({
        lineNo,
        message: 'Position fermée : quantité, montant ou date illisible.',
      });
      return;
    }
    const profit = read.get(row, 'profit');
    const proceeds = D(amount).plus(profit === '' ? ZERO : D(profit));
    out.drafts.push({
      lineNo,
      nativeContent: `etoro:closed:sell:${positionId}`,
      timeMs: closeMs,
      sent: { amount: units, currency: resolved.code },
      received: { amount: proceeds.toString(), currency: ACCOUNT_CURRENCY },
      fee: null,
      netWorth: null,
      label: null,
      description: null,
      txHash: null,
    });
  });
}

/**
 * La photo des positions ne produit plus rien : elle **nomme** les instruments (son libellé est
 * plus lisible qu'un ticker) et **contrôle** les quantités à sa propre date. Un écart signale que
 * le grand livre ne raconte pas la même histoire que le courtier.
 */
function auditAgainstSnapshot(book: Workbook, out: Collected): void {
  const sheet = findSheet(book, SHEET_ALIASES.holdings);
  if (!sheet) return;
  const read = reader(sheet, HOLDINGS_COLUMNS);
  if (read.missing.length > 0) return;

  const serials = sheet.rows
    .map((row) => Number(read.get(row, 'snapshot')))
    .filter((n) => Number.isFinite(n));
  if (serials.length === 0) return;
  const latest = Math.max(...serials);
  const naive = excelSerialToNaive(latest);
  if (naive === null) return;
  // La photo est datée du jour : tout ce qui la précède doit s'y retrouver.
  const cutoff = Date.parse(`${naive}Z`) + 86_400_000;

  const expected = new Map<string, ReturnType<typeof D>>();
  for (const row of sheet.rows) {
    if (Number(read.get(row, 'snapshot')) !== latest) continue;
    const positionId = read.get(row, 'positionId');
    const code = out.codeByPosition.get(positionId);
    const units = read.get(row, 'units');
    if (code === undefined || units === '') continue;
    const label = labelOf(read.get(row, 'asset'));
    if (label !== '') out.labels[code] = label;
    expected.set(code, (expected.get(code) ?? ZERO).plus(D(units)));
  }
  if (expected.size === 0) return;

  const actual = new Map<string, ReturnType<typeof D>>();
  for (const draft of out.drafts) {
    if (draft.timeMs > cutoff) continue;
    if (draft.received && draft.received.currency !== ACCOUNT_CURRENCY) {
      const code = draft.received.currency;
      actual.set(code, (actual.get(code) ?? ZERO).plus(D(draft.received.amount)));
    }
    if (draft.sent && draft.sent.currency !== ACCOUNT_CURRENCY) {
      const code = draft.sent.currency;
      actual.set(code, (actual.get(code) ?? ZERO).minus(D(draft.sent.amount)));
    }
  }
  const drifted: string[] = [];
  for (const [code, qty] of expected) {
    const got = actual.get(code) ?? ZERO;
    // Tolérance : eToro arrondit ses quantités affichées à six décimales.
    if (qty.minus(got).abs().gt(D('0.000001'))) drifted.push(code);
  }
  if (drifted.length > 0) {
    out.issues.push({
      lineNo: 0,
      message: `Contrôle du ${naive.slice(0, 10)} : ${drifted.length} actif(s) dont la quantité reconstituée diffère de celle du relevé (${drifted.slice(0, 5).join(', ')}).`,
    });
  }
}

export function convertEtoroWorkbook(book: Workbook): EtoroConversion {
  const out: Collected = {
    drafts: [],
    issues: [],
    labels: {},
    codeByPosition: new Map(),
    skipped: 0,
  };
  collectOpenings(book, out);
  collectClosings(book, out);
  auditAgainstSnapshot(book, out);
  return { drafts: out.drafts, issues: out.issues, skipped: out.skipped, labels: out.labels };
}
