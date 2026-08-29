/**
 * Second avis sur une annexe 2086 (P62), de bout en bout : le fichier est lu par la couche
 * d'import, nos chiffres sont assemblés depuis un `TaxLedger`, et les deux sont confrontés.
 *
 * C'est le cas le plus solide de la fonctionnalité : **la méthode y est imposée par la loi**
 * (article 150 VH bis, décision n° 43), donc le piège central du second avis — une divergence qui
 * n'est qu'une méthode différente — n'existe pas. Un écart y est réel, et l'app a le droit de le
 * dire.
 *
 * Les fixtures sont 100 % synthétiques (décision n° 17) et **internement cohérentes** : leurs
 * cases 216 et 220 se déduisent des cases 212, 215 et du PTA de la ligne précédente par la formule
 * de l'article 150 VH bis. Nos chiffres, eux, sont à pleine précision — comme ceux du moteur.
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
import type { TaxCession, TaxLedger } from '../../src/lib/domain/tax-fr';
import { cessionsToCsv } from '../../src/lib/export/csv-export';
import { parseCsvText } from '../../src/lib/import/csv';
import { readSecondOpinionClaims } from '../../src/lib/import/second-opinion/claims';
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
    unpricedAssets: [],
  },
  allocation: [],
  unqualified: [],
  pricedAt: null,
  warnings: [],
} satisfies PortfolioReport;

/**
 * Le PTA et la plus-value de la formule légale, à pleine précision — exactement ce que
 * `computeFrenchTax` produit : `gain = cession − PTA × (cession ÷ valeur globale)`.
 */
function cession(input: {
  id: string;
  at: string;
  proceeds: string;
  globalValue: string;
  ptaBefore: string;
}): TaxCession {
  const share = D(input.ptaBefore).times(D(input.proceeds)).div(D(input.globalValue));
  return {
    eventId: input.id,
    at: input.at,
    year: Number(input.at.slice(0, 4)),
    proceedsEur: input.proceeds,
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
  globalValue: '12000',
  ptaBefore: '8000',
});
const SECOND = cession({
  id: 'demo-2',
  at: '2026-07-20T16:05:00',
  proceeds: '1495',
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
    // 996,67 côté fichier ; 996,6666… côté moteur : la même valeur au dernier chiffre affichable.
    expect(D(FIRST.gainEur!).toFixed(2)).toBe('996.67');
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
    expect(D(gap.ours!).toFixed(2)).toBe('549.74');
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
