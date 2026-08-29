import { describe, expect, it } from 'vitest';
import {
  classify,
  compareSecondOpinion,
  matchOperations,
  methodSensitive,
  ourMethodFor,
  theirMethodFor,
  type ComparableMetric,
  type ComparableOperation,
  type CostBasisMethod,
  type OurFigure,
  type SecondOpinionClaim,
  type SecondOpinionSource,
} from './second-opinion';
import { D } from './money';

// --- Fabriques de test ---------------------------------------------------------------------------

const source = (declaredMethod: CostBasisMethod): SecondOpinionSource => ({
  tool: 'cointracking',
  declaredMethod,
  declaredBy: 'user',
  period: null,
});

let nextLine = 2;
const claim = (
  metric: ComparableMetric,
  value: string | null,
  extra: Partial<SecondOpinionClaim> = {},
): SecondOpinionClaim => ({
  metric,
  asset: 'btc',
  at: null,
  value,
  currency: 'EUR',
  issue: null,
  line: nextLine++,
  verbatim: `ligne ${metric}`,
  ...extra,
});

const figure = (
  metric: ComparableMetric,
  value: string | null,
  extra: Partial<OurFigure> = {},
): OurFigure => ({ metric, asset: 'btc', at: null, value, trace: null, ...extra });

const op = (
  at: string,
  asset: string,
  qty: string,
  valueEur: string | null,
): ComparableOperation => ({
  at,
  asset,
  qty,
  valueEur,
});

const compare = (input: {
  method: CostBasisMethod;
  claims: SecondOpinionClaim[];
  ours: OurFigure[];
  operations?: { ours: ComparableOperation[]; theirs: ComparableOperation[] } | null;
  sameScopeConfirmed?: boolean;
}) =>
  compareSecondOpinion({
    source: source(input.method),
    label: 'export-de-test.csv',
    importId: 'test',
    claims: input.claims,
    ours: input.ours,
    operations: input.operations ?? null,
    sameScopeConfirmed: input.sameScopeConfirmed ?? true,
  });

const causesByMetric = (report: ReturnType<typeof compare>): Record<string, string> =>
  Object.fromEntries(report.divergences.map((d) => [d.metric, d.cause]));

// --- La partition --------------------------------------------------------------------------------

describe('partition des grandeurs', () => {
  it('les grandeurs invariantes ne sont jamais sensibles à la méthode', () => {
    for (const metric of [
      'qty-held',
      'proceeds-total',
      'acquisitions-total',
      'operation-count',
    ] as const) {
      expect(methodSensitive(metric)).toBe(false);
    }
  });

  it('PRU, coût des unités détenues, réalisé et latent sont sensibles à la méthode', () => {
    for (const metric of ['pru', 'cost-basis', 'realized', 'unrealized'] as const) {
      expect(methodSensitive(metric)).toBe(true);
    }
  });

  it('une ligne de l’annexe 2086 est comparable sans réserve : la loi impose la méthode des DEUX côtés', () => {
    for (const metric of [
      'tax-global-value',
      'tax-proceeds',
      'tax-acquisition',
      'tax-gain',
    ] as const) {
      expect(methodSensitive(metric)).toBe(false);
      expect(ourMethodFor(metric)).toBe('fr-global');
      // Même si l'utilisateur déclare FIFO, une case du 2086 se compare en méthode globale.
      expect(theirMethodFor(metric, 'fifo')).toBe('fr-global');
    }
  });
});

// --- Le cas fondateur ----------------------------------------------------------------------------

describe('cas fondateur : mêmes transactions, méthode déclarée FIFO', () => {
  const operations = {
    ours: [op('2026-03-15T10:00:00', 'btc', '0.5', '10000')],
    theirs: [op('2026-03-15T10:00:00', 'btc', '0.5', '10000')],
  };
  const report = compare({
    method: 'fifo',
    operations,
    claims: [
      claim('qty-held', '0.5'),
      claim('pru', '21500'),
      claim('realized', '800'),
      claim('cost-basis', '10750'),
      claim('unrealized', '1200'),
    ],
    ours: [
      figure('qty-held', '0.5'),
      figure('pru', '20000'),
      figure('realized', '500'),
      figure('cost-basis', '10000'),
      figure('unrealized', '900'),
    ],
  });

  it('classe PRU, coût, réalisé et latent en « method »', () => {
    expect(causesByMetric(report)).toEqual({
      pru: 'method',
      realized: 'method',
      'cost-basis': 'method',
      unrealized: 'method',
    });
  });

  it('ne produit AUCUN écart à examiner', () => {
    expect(report.counts.unexplained).toBe(0);
    expect(report.divergences.every((d) => d.cause !== 'unexplained')).toBe(true);
  });

  it('la quantité détenue, invariante, concorde', () => {
    expect(report.agreed.map((a) => a.metric)).toEqual(['qty-held']);
  });

  it('n’affiche AUCUN écart chiffré sur une grandeur expliquée par la méthode', () => {
    // Retrancher deux chiffres produits par deux méthodes différentes donne un nombre qui ne veut
    // rien dire : les deux valeurs sont énoncées, leur soustraction non.
    for (const d of report.divergences) {
      expect(d.gap.delta).toBeNull();
      expect(d.gap.ours).not.toBeNull();
      expect(d.gap.theirs).not.toBeNull();
    }
  });

  it('cite la méthode des deux côtés en preuve', () => {
    const evidence = report.divergences[0]!.evidence.find((e) => e.kind === 'declared-method');
    expect(evidence).toEqual({ kind: 'declared-method', ours: 'wac', theirs: 'fifo' });
  });
});

// --- Les autres scénarios exigés -----------------------------------------------------------------

describe('mêmes transactions et même méthode', () => {
  it('ne produit aucune divergence', () => {
    const report = compare({
      method: 'wac',
      claims: [claim('pru', '20000'), claim('qty-held', '0.5'), claim('realized', '500')],
      ours: [figure('pru', '20000'), figure('qty-held', '0.5'), figure('realized', '500')],
    });
    expect(report.divergences).toEqual([]);
    expect(report.counts.agreed).toBe(3);
  });
});

describe('une opération en trop chez eux', () => {
  const operations = {
    ours: [op('2026-03-15T10:00:00', 'btc', '0.5', '10000')],
    theirs: [
      op('2026-03-15T10:00:00', 'btc', '0.5', '10000'),
      op('2026-04-02T09:00:00', 'btc', '0.2', '4200'),
    ],
  };

  it('impute l’écart au périmètre', () => {
    const report = compare({
      method: 'wac',
      operations,
      claims: [claim('acquisitions-total', '14200')],
      ours: [figure('acquisitions-total', '10000')],
    });
    expect(report.divergences.map((d) => d.cause)).toEqual(['scope']);
  });

  it('cite l’appariement en preuve', () => {
    const report = compare({
      method: 'wac',
      operations,
      claims: [claim('acquisitions-total', '14200')],
      ours: [figure('acquisitions-total', '10000')],
    });
    expect(report.divergences[0]!.evidence).toContainEqual({
      kind: 'operations',
      match: { matched: 1, missingHere: 1, extraHere: 0, valuationMismatch: 0 },
    });
  });
});

describe('mêmes opérations, contre-valeurs différentes', () => {
  it('impute l’écart à la valorisation', () => {
    const report = compare({
      method: 'wac',
      operations: {
        ours: [op('2026-03-15T10:00:00', 'btc', '0.5', '10000')],
        theirs: [op('2026-03-15T10:00:00', 'btc', '0.5', '10420')],
      },
      claims: [claim('acquisitions-total', '10420')],
      ours: [figure('acquisitions-total', '10000')],
    });
    expect(report.divergences.map((d) => d.cause)).toEqual(['valuation']);
  });
});

describe('méthode « je ne sais pas »', () => {
  const report = compare({
    method: 'unknown',
    claims: [claim('pru', '21500'), claim('realized', '800'), claim('qty-held', '0.4')],
    ours: [figure('pru', '20000'), figure('realized', '500'), figure('qty-held', '0.5')],
  });

  it('ne compare AUCUNE grandeur sensible', () => {
    expect(report.divergences.map((d) => d.metric)).toEqual(['qty-held']);
    expect(report.inconclusive.map((i) => i.metric).sort()).toEqual(['pru', 'realized']);
    expect(report.inconclusive.every((i) => i.reason === 'method-not-declared')).toBe(true);
  });

  it('compare quand même les grandeurs invariantes', () => {
    expect(report.divergences[0]!.cause).toBe('unexplained');
  });
});

describe('périmètre non confirmé', () => {
  it('n’affiche aucun écart, quelles que soient les valeurs', () => {
    const report = compare({
      method: 'wac',
      sameScopeConfirmed: false,
      claims: [claim('qty-held', '99'), claim('pru', '1')],
      ours: [figure('qty-held', '0.5'), figure('pru', '20000')],
    });
    expect(report.divergences).toEqual([]);
    expect(report.agreed).toEqual([]);
    expect(report.inconclusive.every((i) => i.reason === 'scope-not-confirmed')).toBe(true);
  });
});

describe('réclamations que le fichier n’a pas su livrer', () => {
  it('une devise non gérée n’est jamais convertie', () => {
    const report = compare({
      method: 'wac',
      claims: [claim('qty-held', null, { issue: 'currency-not-eur', currency: 'USD' })],
      ours: [figure('qty-held', '0.5')],
    });
    expect(report.inconclusive.map((i) => i.reason)).toEqual(['currency-not-eur']);
  });

  it('une valeur illisible n’est jamais devinée', () => {
    const report = compare({
      method: 'wac',
      claims: [claim('qty-held', null, { issue: 'value-unreadable' })],
      ours: [figure('qty-held', '0.5')],
    });
    expect(report.inconclusive.map((i) => i.reason)).toEqual(['value-unreadable']);
  });

  it('une grandeur que ce moteur ne produit pas reste non comparée', () => {
    const report = compare({ method: 'wac', claims: [claim('pru', '20000')], ours: [] });
    expect(report.inconclusive.map((i) => i.reason)).toEqual(['no-figure-of-ours']);
  });
});

// --- La cascade ----------------------------------------------------------------------------------

describe('cascade d’imputation', () => {
  const base = {
    ourMethod: 'wac' as CostBasisMethod,
    theirMethod: 'fifo' as CostBasisMethod,
    operations: { matched: 1, missingHere: 1, extraHere: 1, valuationMismatch: 1 },
  };

  it('l’arrondi passe AVANT la méthode', () => {
    expect(classify({ ...base, metric: 'pru', ours: D('100.004'), theirs: D('100') })).toBe(
      'rounding',
    );
  });

  it('la méthode passe avant le périmètre et la valorisation', () => {
    expect(classify({ ...base, metric: 'pru', ours: D('120'), theirs: D('100') })).toBe('method');
  });

  it('le périmètre passe avant la valorisation', () => {
    expect(classify({ ...base, metric: 'qty-held', ours: D('2'), theirs: D('1') })).toBe('scope');
  });

  it('la valorisation vient quand les opérations concordent', () => {
    expect(
      classify({
        ...base,
        metric: 'acquisitions-total',
        ours: D('120'),
        theirs: D('100'),
        operations: { matched: 2, missingHere: 0, extraHere: 0, valuationMismatch: 1 },
      }),
    ).toBe('valuation');
  });

  it('sans rien pour l’expliquer, l’écart est à examiner', () => {
    expect(
      classify({
        ...base,
        metric: 'acquisitions-total',
        ours: D('120'),
        theirs: D('100'),
        operations: { matched: 2, missingHere: 0, extraHere: 0, valuationMismatch: 0 },
      }),
    ).toBe('unexplained');
  });

  it('un dénombrement n’a pas de poussière d’arrondi', () => {
    expect(
      classify({
        ...base,
        metric: 'operation-count',
        ours: D('13'),
        theirs: D('12'),
        operations: null,
      }),
    ).toBe('unexplained');
  });
});

// --- Les deux seuils -----------------------------------------------------------------------------

describe('concordance et arrondi : deux seuils, deux sens', () => {
  const gapFor = (theirs: string) =>
    compare({
      method: 'wac',
      claims: [claim('acquisitions-total', theirs)],
      ours: [figure('acquisitions-total', '1000')],
    });

  it('sous le demi-centime, il n’y a pas d’écart du tout : personne ne saurait le montrer', () => {
    const report = gapFor('1000.005');
    expect(report.divergences).toEqual([]);
    expect(report.counts.agreed).toBe(1);
  });

  it('entre le demi-centime et le centime, l’écart existe et il est imputé à l’arrondi', () => {
    expect(gapFor('1000.007').divergences.map((d) => d.cause)).toEqual(['rounding']);
  });

  it('au-delà du centime, la cascade cherche vraiment', () => {
    expect(gapFor('1000.02').divergences.map((d) => d.cause)).toEqual(['unexplained']);
  });

  it('un écart d’arrondi n’est JAMAIS présenté comme un écart à examiner', () => {
    expect(gapFor('1000.007').counts.unexplained).toBe(0);
  });
});

// --- Appariement ---------------------------------------------------------------------------------

describe('matchOperations', () => {
  it('apparie par jour + actif + quantité, jamais par identifiant', () => {
    const match = matchOperations(
      [op('2026-03-15T10:00:00', 'BTC', '0.50000000', '10000')],
      [op('2026-03-15T23:59:00', 'btc', '0.5', '10000')],
    );
    expect(match).toEqual({ matched: 1, missingHere: 0, extraHere: 0, valuationMismatch: 0 });
  });

  it('compte séparément ce qui manque ici et ce qui est en trop ici', () => {
    const match = matchOperations(
      [op('2026-03-15T10:00:00', 'btc', '1', null), op('2026-04-01T10:00:00', 'eth', '2', null)],
      [op('2026-03-15T10:00:00', 'btc', '1', null), op('2026-05-01T10:00:00', 'sol', '3', null)],
    );
    expect(match).toEqual({ matched: 1, missingHere: 1, extraHere: 1, valuationMismatch: 0 });
  });

  it('une contre-valeur absente d’un côté n’est pas une divergence de valorisation', () => {
    const match = matchOperations(
      [op('2026-03-15T10:00:00', 'btc', '1', null)],
      [op('2026-03-15T10:00:00', 'btc', '1', '30000')],
    );
    expect(match.valuationMismatch).toBe(0);
  });

  it('deux opérations identiques le même jour sont appariées deux à deux', () => {
    const twice = [
      op('2026-03-15T10:00:00', 'btc', '1', '100'),
      op('2026-03-15T11:00:00', 'btc', '1', '100'),
    ];
    expect(matchOperations(twice, twice)).toEqual({
      matched: 2,
      missingHere: 0,
      extraHere: 0,
      valuationMismatch: 0,
    });
  });
});

// --- Ordre de sortie -----------------------------------------------------------------------------

describe('ordre de sortie', () => {
  it('les écarts à examiner sont en tête, les arrondis en queue', () => {
    const report = compare({
      method: 'fifo',
      operations: {
        ours: [op('2026-03-15T10:00:00', 'btc', '1', '100')],
        theirs: [op('2026-03-15T10:00:00', 'btc', '1', '100')],
      },
      claims: [
        claim('pru', '21500'),
        claim('acquisitions-total', '10.007', { asset: 'eth' }),
        claim('qty-held', '2'),
      ],
      ours: [
        figure('pru', '20000'),
        figure('acquisitions-total', '10', { asset: 'eth' }),
        figure('qty-held', '1'),
      ],
    });
    expect(report.divergences.map((d) => d.cause)).toEqual(['unexplained', 'method', 'rounding']);
  });
});
