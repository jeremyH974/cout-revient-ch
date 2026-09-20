/**
 * Second avis sur une annexe 2086 (P62), de bout en bout : le fichier est lu par la couche
 * d'import, nos chiffres sont assemblés depuis un `TaxLedger`, et les deux sont confrontés.
 *
 * C'est le cas le plus solide de la fonctionnalité : **la méthode y est imposée par la loi**
 * (article 150 VH bis, décision n° 43), donc le piège central du second avis — une divergence qui
 * n'est qu'une méthode différente — n'existe pas. Un écart y est réel, et l'app a le droit de le
 * dire.
 *
 * Les fixtures sont 100 % synthétiques (décision n° 17) et **internement cohérentes** : chaque
 * ligne y suit l'arithmétique du formulaire, jusqu'à la plus-value de la ligne 224 — et un test le
 * vérifie, parce que la première version de ces fixtures ne l'était pas. Nos chiffres, eux, sont à
 * pleine précision, et un autre test vérifie que ce sont bien **ceux du moteur** : sans lui, ce
 * fichier a continué de concorder avec une formule que le moteur n'appliquait plus (décision
 * n° 159), parce que les deux côtés la recopiaient.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { D } from '../../src/lib/domain/money';
import {
  compareSecondOpinion,
  ourFiguresFrom,
  type OurFigure,
  type SecondOpinionReport,
} from '../../src/lib/domain/second-opinion';
import type { PortfolioReport } from '../../src/lib/domain/engine/report';
import { computeFrenchTax, type TaxCession, type TaxLedger } from '../../src/lib/domain/tax-fr';
import type { LedgerEvent, TradeEvent } from '../../src/lib/domain/types';
import { cessionsToCsv } from '../../src/lib/export/csv-export';
import { parseCsvText } from '../../src/lib/import/csv';
import { parseAmount, readSecondOpinionClaims } from '../../src/lib/import/second-opinion/claims';
import { detectSecondOpinion } from '../../src/lib/import/second-opinion/detect';

const fixture = (name: string): string =>
  readFileSync(
    fileURLToPath(new URL(`../fixtures/second-opinion/${name}`, import.meta.url)),
    'utf8',
  );

/** Un rapport de portefeuille vide : ce test ne compare QUE les lignes de l'annexe. */
const EMPTY_REPORT = {
  positions: [],
  cashFlows: [],
  stablecoins: [],
  equities: [],
  closed: [],
  blocked: [],
  totals: {
    value: D('0'),
    costBasis: D('0'),
    unpricedCostBasis: D('0'),
    investedTotal: D('0'),
    proceedsTotal: D('0'),
    netInvested: D('0'),
    realized: D('0'),
    unrealized: D('0'),
    otherIncome: D('0'),
    total: D('0'),
    roiBase: D('0'),
    roi: null,
    cashIn: D('0'),
    cashOut: D('0'),
    netCash: D('0'),
    feesEur: D('0'),
    rebatesEur: D('0'),
    subscriptionsEur: D('0'),
    withheldEur: D('0'),
    accountIncomeEur: D('0'),
    unpricedAssets: [],
  },
  allocation: [],
  unqualified: [],
  pricedAt: null,
  warnings: [],
} satisfies PortfolioReport;

/**
 * Une cession à pleine précision, par la formule de la ligne 224 : le rapport sur le prix AVANT
 * frais (l. 217), la différence sur le prix APRÈS frais (l. 218) — ce que `computeFrenchTax`
 * produit, et le test « ce sont les chiffres du moteur » le vérifie.
 */
function cession(input: {
  id: string;
  at: string;
  /** Prix net des frais (l. 218). */
  proceeds: string;
  /** Frais (l. 214). */
  fees: string;
  globalValue: string;
  ptaBefore: string;
}): TaxCession {
  const beforeFees = D(input.proceeds).plus(D(input.fees));
  const share = D(input.ptaBefore).times(beforeFees).div(D(input.globalValue));
  return {
    eventId: input.id,
    at: input.at,
    year: Number(input.at.slice(0, 4)),
    proceedsEur: input.proceeds,
    feesEur: input.fees,
    globalValueEur: input.globalValue,
    ptaBefore: input.ptaBefore,
    acquisitionShareEur: share.toString(),
    gainEur: D(input.proceeds).minus(share).toString(),
    ptaAfter: D(input.ptaBefore).minus(share).toString(),
  };
}

const FIRST = cession({
  id: 'demo-1',
  // L'heure de l'opération n'est PAS dans l'annexe (qui ne date qu'au jour) : le rapprochement
  // doit tenir malgré cela.
  at: '2026-03-15T11:42:00',
  proceeds: '2990',
  fees: '10',
  globalValue: '12000',
  ptaBefore: '8000',
});
const SECOND = cession({
  id: 'demo-2',
  at: '2026-07-20T16:05:00',
  proceeds: '1495',
  fees: '5',
  globalValue: '9500',
  ptaBefore: FIRST.ptaAfter,
});

const ledger = (cessions: TaxCession[]): TaxLedger => ({
  cessions,
  years: [],
  ptaAfter: cessions[cessions.length - 1]?.ptaAfter ?? '0',
  unknownGlobalValue: 0,
  externalInflows: 0,
  externalOutflows: 0,
  rewards: 0,
});

function run(fixtureName: string, ours: OurFigure[]): SecondOpinionReport {
  const table = parseCsvText(fixture(fixtureName));
  const detection = detectSecondOpinion(table.header);
  const read = readSecondOpinionClaims(table, detection);
  return compareSecondOpinion({
    source: {
      tool: detection.ok ? detection.tool : 'unknown',
      declaredMethod: read.declaredMethod,
      declaredBy: 'file',
      period: read.period,
    },
    label: fixtureName,
    importId: 'test-2086',
    claims: read.claims,
    ours,
    operations: null,
    sameScopeConfirmed: true,
  });
}

const OURS = ourFiguresFrom({
  report: EMPTY_REPORT,
  tax: ledger([FIRST, SECOND]),
  operationCount: 2,
});

describe('annexe 2086 concordante', () => {
  const report = run('2086-concordant.csv', OURS);

  it('ne produit AUCUNE divergence', () => {
    expect(report.divergences).toEqual([]);
    expect(report.counts.unexplained).toBe(0);
  });

  it('compare bien les huit grandeurs des deux cessions', () => {
    expect(report.counts.read).toBe(8);
    expect(report.counts.agreed).toBe(8);
    expect(report.counts.inconclusive).toBe(0);
  });

  it('rapproche une ligne datée au jour d’une cession datée à l’heure', () => {
    expect(report.agreed.map((a) => a.at)).toContain('2026-03-15T00:00:00');
    expect(report.agreed.map((a) => a.at)).toContain('2026-07-20T00:00:00');
  });

  it('les deux décimales du fichier concordent avec nos chiffres à pleine précision', () => {
    // 547,63 côté fichier ; 547,6315… côté moteur : la même valeur au dernier chiffre affichable.
    expect(D(SECOND.gainEur!).toFixed(2)).toBe('547.63');
    expect(SECOND.gainEur).not.toBe('547.63');
  });
});

describe('annexe 2086 dont une ligne diverge', () => {
  const report = run('2086-divergent.csv', OURS);

  it('produit exactement un écart, et il est À EXAMINER', () => {
    expect(report.divergences).toHaveLength(1);
    const divergence = report.divergences[0]!;
    expect(divergence.metric).toBe('tax-gain');
    // La méthode est imposée par la loi sur cette ligne : l'écart ne peut pas être imputé à une
    // méthode différente, et il n'y a pas d'appariement d'opérations pour l'expliquer autrement.
    expect(divergence.cause).toBe('unexplained');
    expect(divergence.at).toBe('2026-07-20T00:00:00');
  });

  it('énonce les deux chiffres et l’écart, sans les masquer', () => {
    const gap = report.divergences[0]!.gap;
    // `ValueGap` porte des décimales CANONIQUES : « 612,40 » du fichier devient « 612.4 ».
    expect(gap.theirs).toBe('612.4');
    expect(D(gap.ours!).toFixed(2)).toBe('547.63');
    expect(gap.delta).not.toBeNull();
    expect(gap.source).toEqual({
      kind: 'external-export',
      label: '2086-divergent.csv',
      importId: 'test-2086',
    });
  });

  it('cite la ligne du fichier en preuve', () => {
    expect(report.divergences[0]!.evidence).toContainEqual({
      kind: 'their-line',
      line: 3,
      verbatim: expect.stringContaining('20/07/2026') as unknown as string,
    });
  });
});

/**
 * Aller-retour sur NOTRE propre export. L'écran Rapport exporte déjà les cessions « au format
 * 2086 » (décision n° 50) : ce fichier, redéposé dans le second avis, doit être reconnu et
 * concorder en tout point. C'est la garde la plus utile de toutes — elle relie deux
 * fonctionnalités qui ont toutes les raisons de dériver l'une de l'autre (un libellé de colonne
 * changé d'un côté, une orthographe non prévue de l'autre), et elle échoue au premier écart.
 */
describe('aller-retour : notre propre export 2086, relu par le second avis', () => {
  const csv = cessionsToCsv(ledger([FIRST, SECOND]));
  const table = parseCsvText(csv);
  const detection = detectSecondOpinion(table.header);

  it('est reconnu comme une annexe 2086, sans colonne inconnue', () => {
    expect(detection.ok).toBe(true);
    if (!detection.ok) return;
    expect(detection.format).toBe('waltio-2086');
    expect(detection.unknownColumns).toEqual([]);
  });

  it('porte les lignes qui distinguent le brut du net, et ne passe donc par aucun repli', () => {
    expect(detection.ok).toBe(true);
    if (!detection.ok) return;
    // Sans colonne de frais, la 213 serait relue comme notre prix NET — ce que l'export écrivait
    // vraiment, et ce qu'il faisait recopier dans le formulaire (décision n° 166). La concordance
    // ci-dessous resterait verte : c'est cette assertion-ci qui rougit.
    expect(detection.columns.fees).toBeDefined();
    expect(detection.columns.netProceeds).toBeDefined();
    expect(detection.columns.capitalFraction).toBeDefined();
    expect(detection.columns.netAcquisition).toBeDefined();
  });

  it('concorde en tout point avec les chiffres dont il est issu', () => {
    const read = readSecondOpinionClaims(table, detection);
    const report = compareSecondOpinion({
      source: {
        tool: 'unknown',
        declaredMethod: read.declaredMethod,
        declaredBy: 'file',
        period: read.period,
      },
      label: 'notre-export-2086.csv',
      importId: 'roundtrip',
      claims: read.claims,
      ours: OURS,
      operations: null,
      sameScopeConfirmed: true,
    });
    expect(report.divergences).toEqual([]);
    expect(report.counts.agreed).toBe(8);
    expect(report.counts.inconclusive).toBe(0);
  });
});

describe('deux cessions le même jour', () => {
  it('ne rattache aucune ligne au hasard : la comparaison est déclarée non concluante', () => {
    const twiceSameDay = ourFiguresFrom({
      report: EMPTY_REPORT,
      tax: ledger([
        FIRST,
        cession({
          id: 'demo-1-bis',
          at: '2026-03-15T18:00:00',
          proceeds: '500',
          fees: '0',
          globalValue: '11000',
          ptaBefore: FIRST.ptaAfter,
        }),
        SECOND,
      ]),
      operationCount: 3,
    });
    const report = run('2086-concordant.csv', twiceSameDay);
    const ambiguous = report.inconclusive.filter((i) => i.reason === 'ambiguous-line');
    expect(ambiguous).toHaveLength(4);
    expect(ambiguous.every((i) => i.at === '2026-03-15T00:00:00')).toBe(true);
    // La cession du 20 juillet, elle, reste comparable.
    expect(report.counts.agreed).toBe(4);
  });
});

/**
 * Les chiffres « de notre côté » de ce fichier sont écrits par `cession()`, pas par le moteur. Ce
 * test les rend au moteur : quand la formule du moteur a été corrigée (décision n° 159), ce fichier
 * a continué de concorder avec l'ancienne, parce que `cession()` la recopiait. Il ne le pourra plus.
 */
describe('les chiffres de ce test sont ceux du moteur', () => {
  it('computeFrenchTax retrouve chaque montant des deux cessions', () => {
    let rank = 0;
    const trade = (
      at: string,
      out: TradeEvent['out'],
      into: TradeEvent['in'],
      valueEur: string,
      fee: TradeEvent['fee'],
    ): TradeEvent => ({
      id: `second-opinion-2086:${++rank}`,
      source: 'manual',
      scope: 'coinhouse',
      accountId: 'ch:main',
      rowKeys: [],
      warnings: [],
      kind: 'trade',
      at,
      out,
      in: into,
      valueEur,
      valueEurSource: 'manual',
      fee,
      quotePrice: null,
    });
    const sell = (ours: TaxCession): TradeEvent =>
      trade(
        ours.at,
        { asset: 'btc', qty: '0.1' },
        { asset: 'eur', qty: ours.proceedsEur },
        ours.proceedsEur,
        { asset: 'eur', gross: ours.feesEur, rebate: '0', grossEur: ours.feesEur, rebateEur: '0' },
      );
    const events: LedgerEvent[] = [
      trade(
        '2026-01-10T10:00:00',
        { asset: 'eur', qty: '8000' },
        { asset: 'btc', qty: '1' },
        '8000',
        null,
      ),
      sell(FIRST),
      sell(SECOND),
    ];
    const annotations = {
      [events[1]!.id]: FIRST.globalValueEur!,
      [events[2]!.id]: SECOND.globalValueEur!,
    };

    const engine = computeFrenchTax({ events, annotations }).cessions;
    expect(engine).toHaveLength(2);
    [FIRST, SECOND].forEach((ours, i) => {
      const theirs = engine[i]!;
      for (const key of [
        'proceedsEur',
        'feesEur',
        'globalValueEur',
        'ptaBefore',
        'acquisitionShareEur',
        'gainEur',
        'ptaAfter',
      ] as const) {
        expect(
          D(theirs[key]!).eq(D(ours[key]!)),
          `${ours.eventId}, ${key} : moteur ${theirs[key]}, test ${ours[key]}`,
        ).toBe(true);
      }
    });
  });
});

/**
 * Une fixture « concordante » n'a de valeur que si elle suit elle-même le formulaire. La première
 * version de ces fichiers calculait sa plus-value avec le prix net dans le rapport : elle ne
 * concordait qu'avec un moteur qui avait la même erreur.
 */
describe('la fixture suit l’arithmétique du formulaire, ligne par ligne', () => {
  it('2086-concordant.csv : chaque ligne se recalcule, jusqu’à la plus-value', () => {
    const table = parseCsvText(fixture('2086-concordant.csv'));
    let imputed = D('0');
    table.rows.forEach((row, i) => {
      const l = (line: string) => D(parseAmount(row[table.header.indexOf(line)]!)!);
      const at = `ligne ${i + 2}`;
      // Aucune soulte : l. 217 = l. 213 et l. 218 = l. 215.
      expect(l('216').eq(D('0')) && l('222').eq(D('0')), `${at} : sans soulte`).toBe(true);
      expect(l('215').eq(l('213').minus(l('214'))), `${at} : l. 215 = l. 213 − l. 214`).toBe(true);
      expect(l('217').eq(l('213')), `${at} : l. 217 = l. 213 ± l. 216`).toBe(true);
      expect(l('218').eq(l('215')), `${at} : l. 218 = l. 213 − l. 214 ± l. 216`).toBe(true);
      expect(l('221').eq(imputed.round(2)), `${at} : l. 221 = fractions déjà imputées`).toBe(true);
      const net = l('220').minus(l('221')).minus(l('222'));
      expect(l('223').eq(net), `${at} : l. 223 = l. 220 − l. 221 − l. 222`).toBe(true);
      // La colonne « 224 » d'un fichier à une ligne par cession porte la plus-value de la ligne : sur
      // le formulaire, c'est la ligne de formule sans numéro, et la 224 en fait la somme.
      const share = l('223').times(l('217')).div(l('212'));
      const gain = l('218').minus(share);
      expect(
        gain.round(2).eq(l('224')),
        `${at} : plus-value = l. 218 − [l. 223 × (l. 217 / l. 212)] = ${gain.toFixed(2)}, le fichier dit ${l('224').toString()}`,
      ).toBe(true);
      imputed = imputed.plus(share);
    });
  });
});
