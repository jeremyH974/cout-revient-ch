/**
 * Synthèse d'un compte de prêts : ce que l'utilisateur a APPORTÉ, ce que ça VAUT, et ce que ça a
 * RAPPORTÉ — dans la forme `apports nets + résultat = valeur` de la décision n° 51.
 *
 * LE PIÈGE QUE CE MODULE EXISTE POUR ÉVITER. Le capital prêté cumulé n'est PAS un apport : les
 * remboursements sont remis au travail, si bien qu'un compte alimenté de 11 500 € peut avoir prêté
 * 28 800 €. Rapporter le gain au capital prêté diviserait le rendement par le facteur de recyclage.
 * `principalLent` et `netContributions` sont donc deux champs distincts, et `recycling` nomme le
 * rapport entre les deux au lieu de le laisser deviner.
 *
 * LA TRÉSORERIE, ET POURQUOI LES LIGNES D'IMPÔT AUTONOMES EN SONT EXCLUES. Le solde disponible sur
 * la plateforme vaut `mouvements du portefeuille + encaissements nets − décaissements`. L'ancien
 * flux de BienPrêter créditait le NET ; le nouveau crédite le BRUT puis débite l'impôt sur une
 * ligne à part. Dans les deux cas l'effet net sur le solde est `capital + intérêts − prélèvements`
 * : compter EN PLUS les lignes d'impôt autonomes le retrancherait deux fois (voir le piège C du
 * convertisseur). Les deux totaux d'impôt restent exposés côte à côte pour que l'écart se voie.
 */
import { D, ZERO, divOrNull, max, toDecimalString, type Big } from '../money';
import type { DecimalString } from '../types';
import type { LendingReport, WalletMovement } from './types';

export interface LendingSummary {
  /** Σ dépôts (positifs). */
  deposits: DecimalString;
  /** Σ retraits, en valeur absolue. */
  withdrawals: DecimalString;
  /** `dépôts − retraits` : l'argent sorti de la poche de l'utilisateur, et rien d'autre. */
  netContributions: DecimalString;
  /** Primes versées par la plateforme : un gain, jamais un apport. */
  bonus: DecimalString;

  /** Capital prêté cumulé. **Ce n'est pas un apport** — c'est le même argent, plusieurs fois. */
  principalLent: DecimalString;
  /** `capital prêté ÷ apports nets` : combien de fois les apports ont été remis au travail. */
  recycling: DecimalString | null;

  /** Capital restant dû sur les prêts vivants. */
  outstanding: DecimalString;
  /** Intérêts courus non échus effectivement calculables (voir `accrualUnavailable`). */
  accrued: DecimalString;
  /** Solde disponible sur la plateforme, non prêté. */
  cash: DecimalString;
  /** `encours + courus + trésorerie` : ce que vaut le compte aujourd'hui. */
  value: DecimalString;

  interestGross: DecimalString;
  /** Prélèvements ventilés par prêt — c'est ce total qui fait foi. */
  withheld: DecimalString;
  interestNet: DecimalString;
  /** Impôt débité du portefeuille sur une ligne à part ; informatif, jamais additionné. */
  taxDebitedFromWallet: DecimalString;
  writtenOff: DecimalString;

  /** `valeur − apports nets`. Se décompose en intérêts nets + bonus − pertes. */
  result: DecimalString;
  /** `résultat ÷ apports nets` — rendement **cumulé**, jamais annualisé. */
  returnOnContributions: DecimalString | null;
}

const sum = (values: Iterable<Big>): Big => {
  let total = ZERO;
  for (const value of values) total = total.plus(value);
  return total;
};

export function lendingSummary(
  report: LendingReport,
  wallet: readonly WalletMovement[],
): LendingSummary {
  const of = (kind: WalletMovement['kind']): Big[] =>
    wallet.filter((w) => w.kind === kind).map((w) => D(w.amount));

  const deposits = sum(of('deposit').map((v) => v.abs()));
  const withdrawals = sum(of('withdrawal').map((v) => v.abs()));
  const bonus = sum(of('bonus').map((v) => v.abs()));
  const taxFromWallet = sum(of('tax').map((v) => v.abs()));
  const netContributions = deposits.minus(withdrawals);

  const t = report.totals;
  const principalLent = D(t.disbursed);
  const outstanding = D(t.outstanding);
  const accrued = D(t.accruedInterest);
  const interestGross = D(t.interestReceived);
  const withheld = D(t.withheld);

  // Les lignes d'impôt autonomes sont volontairement absentes : leur effet est déjà porté par
  // `withheld`, ventilé par prêt. Les ajouter retrancherait l'impôt deux fois.
  const cash = deposits
    .minus(withdrawals)
    .plus(bonus)
    .plus(D(t.principalRepaid))
    .plus(interestGross)
    .minus(withheld)
    .plus(D(t.saleProceeds))
    .minus(principalLent);

  const value = outstanding.plus(accrued).plus(cash);
  const result = value.minus(netContributions);

  return {
    deposits: toDecimalString(deposits),
    withdrawals: toDecimalString(withdrawals),
    netContributions: toDecimalString(netContributions),
    bonus: toDecimalString(bonus),
    principalLent: toDecimalString(principalLent),
    recycling: (() => {
      const ratio = divOrNull(principalLent, max(ZERO, netContributions));
      return ratio ? toDecimalString(ratio) : null;
    })(),
    outstanding: toDecimalString(outstanding),
    accrued: toDecimalString(accrued),
    cash: toDecimalString(cash),
    value: toDecimalString(value),
    interestGross: toDecimalString(interestGross),
    withheld: toDecimalString(withheld),
    interestNet: toDecimalString(interestGross.minus(withheld)),
    taxDebitedFromWallet: toDecimalString(taxFromWallet),
    writtenOff: toDecimalString(D(t.writtenOff)),
    result: toDecimalString(result),
    returnOnContributions: (() => {
      const ratio = divOrNull(result, netContributions);
      return ratio ? toDecimalString(ratio) : null;
    })(),
  };
}
