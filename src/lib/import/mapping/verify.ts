/**
 * Le vérificateur d'un appariement (P64) — **c'est le moteur, pas un jugement**.
 *
 * On ne demande pas si l'appariement « a l'air bon ». On **rejoue l'import entier** avec lui, sans
 * rien écrire (`importAnyCsv` et tout le pipeline pivot sont purs — c'est ce qui rend ce contrôle
 * possible), et on regarde ce qu'il produit : des lignes lues, des formes conformes, un rapport
 * dont l'invariant tient, et **aucune position bloquée**.
 *
 * ## L'ordre est strict, et l'on s'arrête au premier échec
 *
 * | #  | Contrôle                                                             |
 * | -- | -------------------------------------------------------------------- |
 * | 0  | Conformité du JSON (hors de ce module : `src/lib/ai/mapping.ts`)     |
 * | 1  | Admissibilité : `date` + une paire complète                          |
 * | 2  | Analyse à blanc du fichier ENTIER : lignes retenues, anomalies        |
 * | 3  | Formes : dates lues, montants conformes, devises reconnues            |
 * | 4a | Invariant `total = valeur + Σ produits − Σ achats`, sur TOUT actif    |
 * | 4b | **Aucune position bloquée**                                          |
 * | 4c | Lignes non qualifiées                                                |
 * | 4d | Écart de solde — **seulement** si le fichier porte une colonne solde  |
 *
 * S'arrêter au premier échec n'est pas une économie : c'est ce qui rend le rapport lisible. Un
 * appariement qui échoue au contrôle 2 échouera mécaniquement aux suivants, et lire quatre échecs
 * dont un seul est la cause ne dit pas où est la cause.
 *
 * ## 4b est le contrôle le plus discriminant, et il faut comprendre pourquoi
 *
 * Une **survente** — céder plus d'un actif qu'on n'en a jamais acquis — est la signature d'un
 * `envoyé`/`reçu` inversé. Le fichier reste parfaitement lisible : les dates sont des dates, les
 * montants des montants, les devises des devises. Tous les contrôles de forme passent. Seul le
 * moteur, en essayant de consommer des lots qui n'existent pas, s'aperçoit que le sens des
 * opérations a été retourné. C'est la raison d'être de ce vérificateur : **rejouer plutôt que
 * juger**.
 *
 * ## 4d est déclaré INAPPLICABLE, jamais réputé vert
 *
 * Le pipeline pivot ne modélise aucun solde. Un fichier sans colonne de solde ne peut donc pas
 * être réconcilié — et l'annoncer « vert » serait annoncer une vérification qui n'a pas eu lieu.
 * Le statut existe pour ça : `not-applicable`, avec son code.
 *
 * ## Le rapport est CODÉ, jamais du français
 *
 * `rows-kept=0.87<0.90` se lit dans un test, se compare entre deux versions, et se traduit une
 * seule fois à l'écran (`src/lib/format/mapping.ts`). Une phrase française dans un vérificateur
 * finit par exister en trois variantes légèrement différentes.
 */
import { computePortfolio } from '../../domain/engine';
import { DEFAULT_ENGINE_SETTINGS } from '../../domain/types';
import { D, ZERO, type Big } from '../../domain/money';
import { isFiat, normalizeAssetCode } from '../../domain/assets';
import { tickerInfo } from '../../pricing/tickers';
import type { CsvTable } from '../csv';
import { draftsToPivotRows } from '../platforms/drafts';
import { pivotLedgerEvents, type UsdRate } from '../pivot/events';
import { mappedDrafts, readAmount, readInstant } from './apply';
import { isAdmissible, type ConfirmedMapping } from './schema';
import type { MappingProposal } from './propose';
import type { ShapeInfo } from './shape';

export type MappingCheckId =
  'admissible' | 'dry-run' | 'shapes' | 'invariant' | 'blocked' | 'unqualified' | 'balance';

export type MappingCheckStatus = 'pass' | 'fail' | 'not-applicable';

export interface MappingCheck {
  readonly id: MappingCheckId;
  readonly status: MappingCheckStatus;
  /** Diagnostic **codé** (`rows-kept=0.87<0.90`), jamais une phrase. */
  readonly code: string;
}

export interface MappingVerdict {
  readonly ok: boolean;
  readonly checks: readonly MappingCheck[];
  /** Lignes effectivement écrites par l'analyse à blanc : utile à l'écran, jamais bloquant. */
  readonly parsedRows: number;
  readonly totalRows: number;
}

/** Les seuils, déclarés en un seul endroit — les changer se voit dans le diff. */
export const THRESHOLDS = {
  rowsKept: 0.9,
  issues: 0.1,
  datesRead: 0.99,
  amountsRead: 1,
  currenciesKnown: 0.95,
  unqualified: 0.05,
  /** Invariant comptable : la même tolérance que les auto-vérifications de l'app. */
  invariant: '0.000001',
  balance: '0.000001',
} as const;

const pass = (id: MappingCheckId, code: string): MappingCheck => ({ id, status: 'pass', code });
const fail = (id: MappingCheckId, code: string): MappingCheck => ({ id, status: 'fail', code });
const skip = (id: MappingCheckId, code: string): MappingCheck => ({
  id,
  status: 'not-applicable',
  code,
});

const ratio = (part: number, whole: number): number => (whole === 0 ? 1 : part / whole);
const round2 = (value: number): string => value.toFixed(2);

/**
 * Prix fictif d'une unité, injecté pour rendre l'invariant CALCULABLE.
 *
 * Sans prix, `value` et `total` valent `null` pour toute position, et le contrôle 4a serait vrai
 * par vacuité — c'est-à-dire faux comme garantie. L'invariant `total = valeur + Σ produits −
 * Σ achats` tient pour **n'importe quel** prix : en injecter un uniforme ne fabrique donc aucun
 * chiffre, il ouvre seulement la branche du moteur qui le vérifie. Aucun montant issu de ce prix
 * n'est lu, affiché, ni conservé.
 */
const PROBE_PRICE = '1';

export interface VerifyContext {
  readonly table: CsvTable;
  readonly shapes: readonly ShapeInfo[];
  /** Colonne de solde du fichier, ou `null` : décide du statut du contrôle 4d. */
  readonly balanceColumn: number | null;
  readonly usdRate: UsdRate;
}

export function contextOf(
  table: CsvTable,
  proposal: MappingProposal,
  usdRate: UsdRate,
): VerifyContext {
  return {
    table,
    shapes: proposal.shapes,
    balanceColumn: proposal.balanceColumn,
    usdRate,
  };
}

/** Contrôle 3 : les formes, lues sur le fichier ENTIER (l'inférence, elle, échantillonne). */
function checkShapes(mapping: ConfirmedMapping, ctx: VerifyContext): MappingCheck {
  const { table, shapes } = ctx;
  const dateIndex = mapping.columns.date;
  let dates = 0;
  let datesRead = 0;
  let amounts = 0;
  let amountsRead = 0;
  let currencies = 0;
  let currenciesKnown = 0;
  const amountFields = ['sentAmount', 'receivedAmount', 'feeAmount', 'netWorthAmount'] as const;
  const currencyFields = [
    'sentCurrency',
    'receivedCurrency',
    'feeCurrency',
    'netWorthCurrency',
  ] as const;

  for (const row of table.rows) {
    if (dateIndex !== undefined) {
      const raw = (row[dateIndex] ?? '').trim();
      if (raw !== '') {
        dates += 1;
        if (readInstant(raw, shapes[dateIndex]?.shape ?? 'free-text') !== null) datesRead += 1;
      }
    }
    for (const field of amountFields) {
      const index = mapping.columns[field];
      if (index === undefined) continue;
      const raw = (row[index] ?? '').trim();
      if (raw === '') continue;
      amounts += 1;
      if (readAmount(raw, shapes[index]?.shape ?? 'free-text') !== null) amountsRead += 1;
    }
    for (const field of currencyFields) {
      const index = mapping.columns[field];
      if (index === undefined) continue;
      const raw = (row[index] ?? '').trim();
      if (raw === '') continue;
      currencies += 1;
      const code = normalizeAssetCode(raw);
      if (isFiat(code) || tickerInfo(code) !== null) currenciesKnown += 1;
    }
  }

  const dateRatio = ratio(datesRead, dates);
  if (dateRatio < THRESHOLDS.datesRead)
    return fail('shapes', `dates-read=${round2(dateRatio)}<${THRESHOLDS.datesRead}`);
  const amountRatio = ratio(amountsRead, amounts);
  if (amountRatio < THRESHOLDS.amountsRead)
    return fail('shapes', `amounts-read=${round2(amountRatio)}<${THRESHOLDS.amountsRead}`);
  const currencyRatio = ratio(currenciesKnown, currencies);
  if (currencyRatio < THRESHOLDS.currenciesKnown)
    return fail(
      'shapes',
      `currencies-known=${round2(currencyRatio)}<${THRESHOLDS.currenciesKnown}`,
    );
  return pass(
    'shapes',
    `dates-read=${round2(dateRatio)} amounts-read=${round2(amountRatio)} currencies-known=${round2(currencyRatio)}`,
  );
}

interface BalancePoint {
  readonly asset: string;
  readonly expected: Big;
  readonly running: Big;
}

/**
 * Contrôle 4d, restreint aux points où il a un SENS : une ligne à une seule jambe, dont la devise
 * nomme sans ambiguïté l'actif dont le fichier annonce le solde. Une ligne à deux jambes en
 * touche deux, et rien ne dit lequel la colonne décrit — la compter reviendrait à inventer une
 * lecture. Sans aucun point comparable, le contrôle est `not-applicable`, pas vert.
 */
function checkBalance(
  ctx: VerifyContext,
  drafts: ReturnType<typeof mappedDrafts>['drafts'],
): MappingCheck {
  if (ctx.balanceColumn === null) return skip('balance', 'no-balance-column');
  const index = ctx.balanceColumn;
  const shape = ctx.shapes[index]?.shape ?? 'free-text';
  const running = new Map<string, Big>();
  const points: BalancePoint[] = [];
  const byLine = new Map<number, (typeof drafts)[number]>();
  for (const draft of drafts) byLine.set(draft.lineNo, draft);

  ctx.table.rows.forEach((row, i) => {
    const lineNo = ctx.table.lineNumbers[i] ?? i + 2;
    const draft = byLine.get(lineNo);
    if (draft === undefined) return;
    const move = (asset: string, qty: Big): void => {
      const code = normalizeAssetCode(asset);
      running.set(code, (running.get(code) ?? ZERO).plus(qty));
    };
    if (draft.sent) move(draft.sent.currency, D(draft.sent.amount).abs().neg());
    if (draft.received) move(draft.received.currency, D(draft.received.amount).abs());
    const single = draft.sent === null || draft.received === null;
    const leg = draft.sent ?? draft.received;
    const raw = (row[index] ?? '').trim();
    if (!single || leg === null || raw === '') return;
    const expected = readAmount(raw, shape);
    if (expected === null) return;
    const code = normalizeAssetCode(leg.currency);
    points.push({ asset: code, expected: D(expected), running: running.get(code) ?? ZERO });
  });

  if (points.length === 0) return skip('balance', 'balance-ambiguous');
  const off = points.filter((p) => !p.running.minus(p.expected).abs().lte(THRESHOLDS.balance));
  return off.length === 0
    ? pass('balance', `balance-points=${points.length} off=0`)
    : fail('balance', `balance-off=${off.length}/${points.length}`);
}

/**
 * Rejoue l'import entier avec cet appariement et rend le verdict. **Aucun effet** : rien n'est
 * écrit, rien n'est persisté, aucun réseau n'est touché.
 */
export function verifyMapping(mapping: ConfirmedMapping, ctx: VerifyContext): MappingVerdict {
  const checks: MappingCheck[] = [];
  const totalRows = ctx.table.rows.length;

  // 1 — Admissibilité.
  if (!isAdmissible(mapping.columns)) {
    checks.push(fail('admissible', 'missing-date-or-pair'));
    return { ok: false, checks, parsedRows: 0, totalRows };
  }
  checks.push(pass('admissible', 'date+pair'));

  // 2 — Analyse à blanc du fichier ENTIER.
  const conversion = mappedDrafts(ctx.table, mapping, ctx.shapes);
  const parsed = draftsToPivotRows(conversion.drafts, 'dry-run', 'csv:dry-run');
  const issues = conversion.issues.length + parsed.issues.length;
  const kept = ratio(parsed.rows.length, totalRows);
  const anomalies = ratio(issues, totalRows);
  if (kept < THRESHOLDS.rowsKept) {
    checks.push(fail('dry-run', `rows-kept=${round2(kept)}<${THRESHOLDS.rowsKept}`));
    return { ok: false, checks, parsedRows: parsed.rows.length, totalRows };
  }
  if (anomalies > THRESHOLDS.issues) {
    checks.push(fail('dry-run', `issues=${round2(anomalies)}>${THRESHOLDS.issues}`));
    return { ok: false, checks, parsedRows: parsed.rows.length, totalRows };
  }
  checks.push(pass('dry-run', `rows-kept=${round2(kept)} issues=${round2(anomalies)}`));

  // 3 — Formes.
  const shapeCheck = checkShapes(mapping, ctx);
  checks.push(shapeCheck);
  if (shapeCheck.status === 'fail')
    return { ok: false, checks, parsedRows: parsed.rows.length, totalRows };

  // 4 — Le rapport du moteur.
  const { events } = pivotLedgerEvents(parsed.rows, {}, ctx.usdRate);
  const prices = Object.fromEntries(
    [...new Set(parsed.rows.flatMap((r) => [r.sent?.currency, r.received?.currency]))]
      .filter((asset): asset is string => asset !== undefined)
      .map((asset) => [
        asset,
        {
          asset,
          priceEur: PROBE_PRICE,
          at: '1970-01-01T00:00:00.000Z',
          source: 'dry-run',
          stale: true,
        },
      ]),
  );
  const report = computePortfolio({ events, prices, settings: DEFAULT_ENGINE_SETTINGS });

  // 4a — Invariant comptable, actif par actif.
  const priced = [...report.positions, ...report.stablecoins, ...report.closed].filter(
    (p) => p.total !== null && p.value !== null,
  );
  const broken = priced.filter(
    (p) =>
      !p
        .total!.minus(p.value!.plus(p.proceedsTotal).minus(p.investedTotal))
        .abs()
        .lte(THRESHOLDS.invariant),
  );
  if (broken.length > 0) {
    checks.push(fail('invariant', `invariant-off=${broken.map((p) => p.asset).join(',')}`));
    return { ok: false, checks, parsedRows: parsed.rows.length, totalRows };
  }
  checks.push(pass('invariant', `invariant-checked=${priced.length}`));

  // 4b — Aucune position bloquée. Le contrôle le plus discriminant : une survente est la
  //      signature d'un `envoyé`/`reçu` inversé, que rien d'autre ne détecte.
  if (report.blocked.length > 0) {
    checks.push(fail('blocked', `blocked=${report.blocked.map((p) => p.asset).join(',')}`));
    return { ok: false, checks, parsedRows: parsed.rows.length, totalRows };
  }
  checks.push(pass('blocked', 'blocked=0'));

  // 4c — Lignes non qualifiées.
  const unqualified = ratio(report.unqualified.length, parsed.rows.length);
  if (unqualified > THRESHOLDS.unqualified) {
    checks.push(
      fail('unqualified', `unqualified=${round2(unqualified)}>${THRESHOLDS.unqualified}`),
    );
    return { ok: false, checks, parsedRows: parsed.rows.length, totalRows };
  }
  checks.push(pass('unqualified', `unqualified=${round2(unqualified)}`));

  // 4d — Écart de solde, ou inapplicable. Jamais réputé vert.
  const balance = checkBalance(ctx, conversion.drafts);
  checks.push(balance);
  if (balance.status === 'fail')
    return { ok: false, checks, parsedRows: parsed.rows.length, totalRows };

  return { ok: true, checks, parsedRows: parsed.rows.length, totalRows };
}

/** Le premier contrôle en échec, s'il y en a un : ce qu'on affiche, et rien de plus. */
export const firstFailure = (verdict: MappingVerdict): MappingCheck | null =>
  verdict.checks.find((c) => c.status === 'fail') ?? null;
