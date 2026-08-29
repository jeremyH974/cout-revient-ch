/**
 * Propriétés du second avis (fast-check). Elles portent sur la seule chose qui rend cette
 * fonctionnalité publiable : **jamais un « écart à examiner » là où une méthode différente
 * l'explique déjà**.
 *
 * 1. `unexplained` n'apparaît **jamais** sur une grandeur sensible quand la méthode diffère de la
 *    nôtre — quels que soient les chiffres, l'appariement des opérations et l'écart.
 * 2. Le classement est **déterministe** : deux appels sur la même entrée rendent la même cause.
 * 3. L'ordre de la cascade est **stable** : la cause rendue est exactement le PREMIER échelon
 *    satisfait, jamais un échelon plus bas — la propriété rejoue la cascade à côté, échelon par
 *    échelon, plutôt que de faire confiance à l'implémentation.
 * 4. `compareSecondOpinion` ne perd ni n'invente rien : toute réclamation ressort exactement une
 *    fois, en concordance, en divergence ou en non-comparaison.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { D } from './money';
import {
  classify,
  compareSecondOpinion,
  METRIC_CLASS,
  methodSensitive,
  ourMethodFor,
  roundingToleranceOf,
  theirMethodFor,
  type ClassifyInput,
  type ComparableMetric,
  type CostBasisMethod,
  type OperationMatchReport,
  type OurFigure,
  type SecondOpinionClaim,
} from './second-opinion';

const METRICS = Object.keys(METRIC_CLASS) as ComparableMetric[];
const METHODS: CostBasisMethod[] = ['wac', 'fifo', 'lifo', 'hifo', 'acb', 'opti', 'fr-global'];

const metricArb = fc.constantFrom(...METRICS);
const methodArb = fc.constantFrom(...METHODS);
/** Montants en centièmes : des entiers, jamais un flottant porteur d'un montant. */
const amountArb = fc
  .integer({ min: -5_000_000, max: 5_000_000 })
  .map((n) => D(String(n)).div('100'));
const matchArb: fc.Arbitrary<OperationMatchReport | null> = fc.option(
  fc.record({
    matched: fc.integer({ min: 0, max: 50 }),
    missingHere: fc.integer({ min: 0, max: 10 }),
    extraHere: fc.integer({ min: 0, max: 10 }),
    valuationMismatch: fc.integer({ min: 0, max: 10 }),
  }),
  { nil: null },
);

const inputArb: fc.Arbitrary<ClassifyInput> = fc
  .record({
    metric: metricArb,
    ours: amountArb,
    theirs: amountArb,
    declared: methodArb,
    operations: matchArb,
  })
  .map(({ metric, ours, theirs, declared, operations }) => ({
    metric,
    ours,
    theirs,
    ourMethod: ourMethodFor(metric),
    theirMethod: theirMethodFor(metric, declared),
    operations,
  }));

describe('propriétés du classement', () => {
  it('jamais « à examiner » sur une grandeur sensible quand la méthode diffère de la nôtre', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const cause = classify(input);
        if (methodSensitive(input.metric) && input.theirMethod !== input.ourMethod) {
          expect(cause).not.toBe('unexplained');
          // Et l'échelon qui l'explique est bien la méthode, sauf quand l'arrondi suffit déjà.
          expect(['method', 'rounding']).toContain(cause);
        }
      }),
      { numRuns: 2000 },
    );
  });

  it('le classement est déterministe', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        expect(classify(input)).toBe(classify(input));
      }),
      { numRuns: 500 },
    );
  });

  it('la cause est exactement le PREMIER échelon satisfait de la cascade', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        // La cascade rejouée à côté, dans son ordre déclaré : rounding → method → scope →
        // valuation → unexplained. Si l'implémentation change d'ordre, cette propriété tombe.
        const delta = input.ours.minus(input.theirs).abs();
        const ops = input.operations;
        const expected = delta.lt(D(roundingToleranceOf(input.metric)))
          ? 'rounding'
          : methodSensitive(input.metric) && input.theirMethod !== input.ourMethod
            ? 'method'
            : ops !== null && (ops.missingHere > 0 || ops.extraHere > 0)
              ? 'scope'
              : ops !== null && ops.valuationMismatch > 0
                ? 'valuation'
                : 'unexplained';
        expect(classify(input)).toBe(expected);
      }),
      { numRuns: 2000 },
    );
  });

  it('une grandeur imposée par la loi n’est jamais imputée à la méthode', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        if (METRIC_CLASS[input.metric] === 'statutory') expect(classify(input)).not.toBe('method');
      }),
      { numRuns: 1000 },
    );
  });
});

describe('propriétés de la comparaison complète', () => {
  const claimArb: fc.Arbitrary<SecondOpinionClaim> = fc
    .record({
      metric: metricArb,
      value: fc.option(amountArb, { nil: null }),
      line: fc.integer({ min: 2, max: 200 }),
      broken: fc.boolean(),
    })
    .map(({ metric, value, line, broken }) => ({
      metric,
      asset: null,
      at: null,
      value: broken || value === null ? null : value.toString(),
      currency: 'EUR',
      issue: broken ? ('value-unreadable' as const) : null,
      line,
      verbatim: `ligne ${line}`,
    }));

  it('aucune réclamation n’est perdue ni dupliquée', () => {
    fc.assert(
      fc.property(
        fc.array(claimArb, { maxLength: 30 }),
        methodArb,
        fc.boolean(),
        (claims, declared, sameScopeConfirmed) => {
          const ours: OurFigure[] = METRICS.map((metric) => ({
            metric,
            asset: null,
            at: null,
            value: '100',
            trace: null,
          }));
          const report = compareSecondOpinion({
            source: { tool: 'unknown', declaredMethod: declared, declaredBy: 'user', period: null },
            label: 'propriete.csv',
            importId: 'prop',
            claims,
            ours,
            operations: null,
            sameScopeConfirmed,
          });
          const total =
            report.divergences.length + report.agreed.length + report.inconclusive.length;
          expect(total).toBe(claims.length);
          expect(report.counts.read).toBe(claims.length);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('périmètre non confirmé ⟹ aucun écart, jamais', () => {
    fc.assert(
      fc.property(fc.array(claimArb, { maxLength: 20 }), methodArb, (claims, declared) => {
        const ours: OurFigure[] = METRICS.map((metric) => ({
          metric,
          asset: null,
          at: null,
          value: '1',
          trace: null,
        }));
        const report = compareSecondOpinion({
          source: { tool: 'unknown', declaredMethod: declared, declaredBy: 'user', period: null },
          label: 'propriete.csv',
          importId: 'prop',
          claims,
          ours,
          operations: null,
          sameScopeConfirmed: false,
        });
        expect(report.divergences).toEqual([]);
        expect(report.agreed).toEqual([]);
      }),
      { numRuns: 200 },
    );
  });

  it('une méthode non déclarée ne produit aucune divergence sur une grandeur sensible', () => {
    fc.assert(
      fc.property(fc.array(claimArb, { maxLength: 30 }), (claims) => {
        const ours: OurFigure[] = METRICS.map((metric) => ({
          metric,
          asset: null,
          at: null,
          value: '100',
          trace: null,
        }));
        const report = compareSecondOpinion({
          source: { tool: 'unknown', declaredMethod: 'unknown', declaredBy: 'user', period: null },
          label: 'propriete.csv',
          importId: 'prop',
          claims,
          ours,
          operations: null,
          sameScopeConfirmed: true,
        });
        expect(report.divergences.some((d) => methodSensitive(d.metric))).toBe(false);
      }),
      { numRuns: 300 },
    );
  });
});
