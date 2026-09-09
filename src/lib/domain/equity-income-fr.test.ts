/**
 * Dividendes : crédit d'impôt conventionnel, tel que le formulaire 2047 le calcule.
 *
 * Les chiffres attendus viennent de la mécanique imprimée sur le cadre 20 (203 → 208), pas du code.
 */
import { describe, expect, it } from 'vitest';
import {
  dividendTaxFr,
  NOTICE_RATES,
  TREATY_DIVIDEND_RATES,
  type DividendTaxInput,
} from './equity-income-fr';
import type { CountryCode, IncomeEvent, LedgerEvent } from './types';

let seq = 0;
const dividend = (at: string, asset: string, gross: string, withheld: string): IncomeEvent => ({
  id: `e${++seq}`,
  source: 'manual',
  scope: 'coinhouse',
  accountId: 'ch:main',
  rowKeys: [],
  warnings: [],
  kind: 'income',
  at,
  asset,
  grossEur: gross,
  withheldEur: withheld,
  nature: 'dividend',
  label: 'Dividende',
});

const ledger = (events: LedgerEvent[], pays: Record<string, CountryCode>, throughYear = 2025) =>
  dividendTaxFr({
    events,
    countryOf: (asset) => pays[asset] ?? null,
    throughYear,
  } satisfies DividendTaxInput);
const yearOf = (l: ReturnType<typeof ledger>, year: number) => l.years.find((y) => y.year === year);
const countryOf = (l: ReturnType<typeof ledger>, year: number, code: string | null) =>
  yearOf(l, year)!.countries.find((c) => c.country === code);

describe('le crédit est plafonné au taux conventionnel', () => {
  it('une retenue japonaise de 20,42 % n’est imputable qu’à hauteur de 11,1 % du net', () => {
    // Ligne 203 = 79,58 ; ligne 205 = 79,58 × 0,111 = 8,83338 ; ligne 206 = 20,42.
    // Ligne 207 = min(205, 206) = 8,83338. Ligne 208 = 203 + 207 = 88,41338.
    const l = ledger([dividend('2025-04-02T00:00:00', 'eq:mufg', '100', '20.42')], {
      'eq:mufg': 'JP',
    });
    const jp = countryOf(l, 2025, 'JP')!;
    expect([jp.netEur, jp.cappedAtEur, jp.creditEur]).toEqual(['79.58', '8.83338', '8.83338']);
    expect(jp.declaredEur).toBe('88.41338');
    // Ce qui dépasse le plafond est perdu côté français, et l'application le chiffre.
    expect(jp.excessEur).toBe('11.58662');
  });

  it('le taux s’applique au NET, jamais au brut', () => {
    // Sur le brut, 100 × 0,111 donnerait 11,10 au lieu de 8,83 — 26 % de trop. La notice est
    // explicite : « le montant net de ces revenus, déduction faite de l'impôt étranger ».
    const l = ledger([dividend('2025-04-02T00:00:00', 'eq:mufg', '100', '20.42')], {
      'eq:mufg': 'JP',
    });
    expect(countryOf(l, 2025, 'JP')!.creditEur).not.toBe('11.1');
  });

  it('une retenue au taux conventionnel s’impute presque entièrement', () => {
    // 15 % retenus, taux notice 17,6 % : 85 × 0,176 = 14,96, et le crédit vaut min(14,96 ; 15).
    // La déclaration rend donc 99,96 et non 100 — le taux de la notice est arrondi au dixième,
    // et 15/85 vaut 17,647 %. L'écart est celui de l'arrondi officiel, pas une erreur de calcul.
    const l = ledger([dividend('2025-04-02T00:00:00', 'eq:aapl', '100', '15')], {
      'eq:aapl': 'US',
    });
    const us = countryOf(l, 2025, 'US')!;
    expect([us.creditEur, us.declaredEur]).toEqual(['14.96', '99.96']);
    expect(us.excessEur).toBe('0.04');
  });
});

describe('ce que l’application refuse de calculer', () => {
  it('sans pays désigné, AUCUN crédit — le montant reste visible', () => {
    // L'arbitrage de l'utilisateur : montrer ce qui est certain, ne rien déduire de l'ISIN.
    const l = ledger([dividend('2025-04-02T00:00:00', 'eq:mufg', '100', '20.42')], {});
    const y = yearOf(l, 2025)!;
    expect([y.creditEur, y.declaredEur]).toEqual(['0', '0']);
    expect(y.grossEur).toBe('100');
    expect(y.undesignated).toEqual(['eq:mufg']);
    expect(l.hasUndesignated).toBe(true);
    expect(countryOf(l, 2025, null)!.outcome).toBe('rate-unknown');
  });

  it('un pays absent de la table curée ne reçoit aucun crédit', () => {
    // Le Brésil relève d'un régime que la notice décrit en toutes lettres plutôt qu'en taux :
    // l'inventer serait pire que l'avouer.
    const l = ledger([dividend('2025-04-02T00:00:00', 'eq:vale', '100', '15')], {
      'eq:vale': 'BR',
    });
    const br = countryOf(l, 2025, 'BR')!;
    expect([br.outcome, br.creditEur, br.rate]).toEqual(['rate-unknown', '0', null]);
  });

  it('l’Irlande (« /c ») ne donne aucun crédit, mais le net se déclare', () => {
    // Imposition exclusive en France : il n'y a pas de double imposition à éliminer.
    const l = ledger([dividend('2025-04-02T00:00:00', 'eq:crh', '100', '0')], { 'eq:crh': 'IE' });
    const ie = countryOf(l, 2025, 'IE')!;
    expect([ie.outcome, ie.creditEur, ie.declaredEur]).toEqual(['no-treaty-credit', '0', '100']);
  });

  it('un dividende de source FRANÇAISE reste hors du mécanisme 2047', () => {
    // Le cadre 20 ne traite que l'impôt ÉTRANGER. Une retenue française n'y a pas sa place, et
    // l'application ne tranche pas son sort.
    const l = ledger([dividend('2025-04-02T00:00:00', 'eq:mc.pa', '100', '25')], {
      'eq:mc.pa': 'FR',
    });
    const fr = countryOf(l, 2025, 'FR')!;
    expect([fr.outcome, fr.creditEur, fr.declaredEur]).toEqual(['domestic', '0', '0']);
    // Elle figure tout de même dans le brut et la retenue de l'année : rien n'est caché.
    expect([yearOf(l, 2025)!.grossEur, yearOf(l, 2025)!.withheldEur]).toEqual(['100', '25']);
    expect(yearOf(l, 2025)!.creditEur).toBe('0');
  });

  it('ni les intérêts ni les frais de conversion ne sont des dividendes', () => {
    const autres: LedgerEvent[] = [
      { ...dividend('2025-03-01T00:00:00', 'eq:a', '50', '0'), nature: 'interest' },
      { ...dividend('2025-03-02T00:00:00', 'eq:a', '-30', '0'), nature: 'conversion-fee' },
      { ...dividend('2025-03-03T00:00:00', 'eq:a', '10', '1.5'), asset: null },
    ];
    expect(ledger(autres, { 'eq:a': 'US' }).years).toEqual([]);
  });
});

describe('le regroupement suit le formulaire', () => {
  it('agrège par PAYS et par ANNÉE, comme les colonnes du cadre 20', () => {
    // Deux titres américains font une seule colonne ; le plafond s'applique au cumul, pas ligne
    // à ligne — c'est ainsi que le formulaire est bâti.
    const l = ledger(
      [
        dividend('2025-04-02T00:00:00', 'eq:aapl', '60', '9'),
        dividend('2025-07-02T00:00:00', 'eq:msft', '40', '6'),
        dividend('2026-04-02T00:00:00', 'eq:aapl', '20', '3'),
      ],
      { 'eq:aapl': 'US', 'eq:msft': 'US' },
      2026,
    );
    expect(l.years.map((y) => y.year)).toEqual([2025, 2026]);
    const us = countryOf(l, 2025, 'US')!;
    expect([us.grossEur, us.netEur, us.assets.length]).toEqual(['100', '85', 2]);
    expect(yearOf(l, 2026)!.grossEur).toBe('20');
  });

  it('reproduit la forme d’un relevé réel : quatre pays, un seul crédité au plafond', () => {
    const l = ledger(
      [
        dividend('2025-04-02T00:00:00', 'eq:aapl', '10.53', '1.58'),
        dividend('2025-04-03T00:00:00', 'eq:mufg', '42.21', '8.62'),
        dividend('2025-04-04T00:00:00', 'eq:race', '13.34', '5.47'),
        dividend('2025-04-05T00:00:00', 'eq:mc.pa', '23.57', '5.89'),
      ],
      { 'eq:aapl': 'US', 'eq:mufg': 'JP', 'eq:race': 'NL', 'eq:mc.pa': 'FR' },
    );
    const y = yearOf(l, 2025)!;
    expect(y.grossEur).toBe('89.65');
    // Le Japon et les Pays-Bas sont sur-retenus : leur excédent n'est pas imputable.
    expect(Number(y.excessEur)).toBeGreaterThan(8);
    // La France ne contribue ni au crédit ni au 2DC.
    expect(countryOf(l, 2025, 'FR')!.declaredEur).toBe('0');
    expect(Number(y.creditEur)).toBeLessThan(Number(y.withheldEur));
  });
});

describe('la table des taux', () => {
  it('ne contient que des valeurs employées par la notice', () => {
    // Un « 0.716 » au lieu de « 0.176 » se lirait mal et se verrait ici.
    const inconnus = Object.entries(TREATY_DIVIDEND_RATES)
      .filter(([, rate]) => rate !== null && !NOTICE_RATES.includes(rate))
      .map(([code, rate]) => `${code}=${rate}`);
    expect(inconnus, `taux absents des valeurs de la notice : ${inconnus.join(', ')}`).toEqual([]);
  });

  it('garde au moins un pays « /c », sinon la branche sans crédit ne serait jamais prise', () => {
    expect(Object.values(TREATY_DIVIDEND_RATES).filter((r) => r === null).length).toBeGreaterThan(
      0,
    );
  });
});
