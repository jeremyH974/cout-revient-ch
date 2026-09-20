/**
 * Propriétés de l'addition (fast-check, décision n° 173).
 *
 * Elles portent sur ce qu'un lecteur tient pour acquis en regardant une facture, et qu'un exemple
 * ne prouve que pour un jeu de chiffres :
 *
 * 1. **La somme des lignes vaut le solde.** C'est la seule raison de montrer des lignes : qu'on
 *    puisse les additionner soi-même et retomber dessus.
 * 2. **Le total affiché ne s'écarte de l'exact que d'un demi-centime par ligne.** C'est la borne
 *    de l'arrondi d'affichage, et elle empêche qu'une « amélioration » y glisse autre chose.
 * 3. **Le défaut ne coûte jamais plus cher qu'un choix imposé.** L'écran annonce suivre la voie la
 *    moins chère ; si un jour il ne le faisait plus, cette propriété rougirait avant l'utilisateur.
 * 4. **Un crédit non restituable ne creuse jamais un remboursement.** Seul l'acompte le peut.
 * 5. **L'étalement suit exactement le seuil affiché**, dans les deux sens.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Big, D, ZERO } from '../domain/money';
import { SPREAD_INSTALMENTS, SPREAD_THRESHOLD_EUR } from './tax-calendar';
import { taxBill, type BillOption, type Withheld } from './tax-bill';
import type { TaxChoice, TaxSide } from './tax-choice';
import type { TaxOption } from './pfu-vs-bareme';

const YEAR = 2026;

const side = (key: TaxSide['key'], income: Big, social: Big): TaxSide => ({
  key,
  label: key,
  incomeTaxEur: income.toString(),
  socialTaxEur: social.toString(),
  totalEur: income.plus(social).toString(),
});

function option(code: TaxOption, flatIncome: Big, scaleIncome: Big, social: Big): BillOption {
  const flat = side('flat', flatIncome, social);
  const scale = side('scale', scaleIncome, social);
  const cheaper: TaxChoice['cheaper'] = flatIncome.eq(scaleIncome)
    ? 'equal'
    : flatIncome.lt(scaleIncome)
      ? 'flat'
      : 'scale';
  return {
    option: code,
    choice: {
      option: code,
      year: YEAR,
      basis: 'bracket',
      flat,
      scale,
      cheaper,
      gapEur: '0',
      totalTaxableEur: '0',
      flatRateOnBase: '0',
      scaleRateOnBase: '0',
      marginalRateBefore: '0.3',
      marginalRateAfter: '0.3',
      crossesBracket: false,
      scaleYear: YEAR,
      scaleIsFallback: false,
      ladder: [],
    },
  };
}

/** Un montant au centime, de zéro à cent mille euros. */
const eur = fc.integer({ min: 0, max: 10_000_000 }).map((c) => D(String(c)).div(D('100')));

/** Deux options complètes, avec leurs deux voies et leur part sociale. */
const options = fc
  .tuple(eur, eur, eur, eur, eur, eur)
  .map(([a, b, c, d, e, f]) => [option('3CN', a, b, c), option('2OP', d, e, f)]);

const withheld = fc.tuple(eur, eur, eur).map(([advance, social, credit]): Withheld => ({
  advanceEur: advance.toString(),
  socialEur: social.toString(),
  foreignCreditEur: credit.toString(),
  unsplit: false,
  dividendsWithoutAdvanceEur: '0',
}));

describe('propriétés de l’addition', () => {
  it('la somme des lignes vaut toujours le solde, et le solde vaut le brut moins l’imputé', () => {
    fc.assert(
      fc.property(options, withheld, (opts, paid) => {
        const bill = taxBill({ year: YEAR, options: opts, withheld: paid });
        if (bill === null) return;
        const summed = bill.lines.reduce((acc, l) => acc.plus(D(l.amountEur)), ZERO);
        expect(summed.eq(D(bill.dueEur))).toBe(true);
        expect(D(bill.dueEur).eq(D(bill.grossEur).minus(D(bill.settledEur)))).toBe(true);
      }),
    );
  });

  it('le total affiché ne s’écarte de l’exact que d’un demi-centime par ligne', () => {
    fc.assert(
      fc.property(options, withheld, (opts, paid) => {
        const bill = taxBill({ year: YEAR, options: opts, withheld: paid });
        if (bill === null) return;
        const drift = D(bill.displayDueEur).minus(D(bill.dueEur)).abs();
        expect(drift.lte(D(String(bill.lines.length)).times(D('0.005')))).toBe(true);
      }),
    );
  });

  it('le défaut ne coûte jamais plus cher en impôt sur le revenu qu’une voie imposée', () => {
    fc.assert(
      fc.property(options, (opts) => {
        const byDefault = taxBill({ year: YEAR, options: opts });
        const forced = [
          taxBill({ year: YEAR, options: opts, sides: { '3CN': 'flat', '2OP': 'flat' } }),
          taxBill({ year: YEAR, options: opts, sides: { '3CN': 'scale', '2OP': 'scale' } }),
          taxBill({ year: YEAR, options: opts, sides: { '3CN': 'flat', '2OP': 'scale' } }),
          taxBill({ year: YEAR, options: opts, sides: { '3CN': 'scale', '2OP': 'flat' } }),
        ];
        for (const other of forced)
          expect(D(byDefault?.incomeTaxEur ?? '0').lte(D(other?.incomeTaxEur ?? '0'))).toBe(true);
      }),
    );
  });

  it('un crédit conventionnel seul ne creuse jamais un remboursement', () => {
    // 8VL n'est pas restituable : sans acompte ni prélèvement social retenu, le solde reste dû.
    fc.assert(
      fc.property(options, eur, (opts, credit) => {
        const bill = taxBill({
          year: YEAR,
          options: opts,
          withheld: {
            advanceEur: '0',
            socialEur: '0',
            foreignCreditEur: credit.toString(),
            unsplit: false,
            dividendsWithoutAdvanceEur: '0',
          },
        });
        if (bill === null) return;
        expect(D(bill.dueEur).gte(ZERO)).toBe(true);
      }),
    );
  });

  it('l’étalement suit exactement le seuil affiché, dans les deux sens', () => {
    fc.assert(
      fc.property(options, withheld, (opts, paid) => {
        const bill = taxBill({ year: YEAR, options: opts, withheld: paid });
        if (bill === null) return;
        const spread = D(bill.displayDueEur).gt(D(SPREAD_THRESHOLD_EUR));
        expect(bill.settlement.instalments === SPREAD_INSTALMENTS).toBe(spread);
      }),
    );
  });
});
