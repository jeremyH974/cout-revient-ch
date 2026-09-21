/**
 * La règle de présentation d'un rendement (P118) : annualisé à partir d'un an, rendement de la
 * période en deçà — GIPS 2020, 2.A.12 pour le TWR, 5.A.1.b pour le rendement pondéré par les flux.
 * Chaque exemple se vérifie de tête, et son commentaire dit comment.
 */
import { describe, expect, it } from 'vitest';
import { D, type Big } from '../domain/money';
import { twrEur, type TwrDay } from '../domain/twr';
import { XIRR_MIN_SPAN_DAYS, xirrEur } from '../domain/xirr';
import {
  ANNUALIZE_MIN_DAYS,
  DAYS_PER_YEAR,
  annualizedRate,
  periodRate,
  presentMoneyWeighted,
  presentReturn,
  presentTimeWeighted,
  type PresentedReturn,
  type ReturnFigure,
} from './presented-return';

const addDays = (day: string, n: number): string => {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const near = (value: Big | null, expected: number, tolerance = 1e-9): void => {
  expect(value).not.toBeNull();
  expect(Math.abs(Number(value!.toString()) - expected)).toBeLessThan(tolerance);
};
/** Le chiffre présenté, ou l'échec : `kind: 'none'` n'a pas de valeur. */
const shown = (presented: PresentedReturn): { kind: string; value: Big; spanDays: number } => {
  if (presented.kind === 'none') throw new Error(`rien de présenté : ${presented.reason}`);
  return presented;
};
const figure = (
  basis: ReturnFigure['basis'],
  value: string,
  since: string,
  spanDays: number,
): ReturnFigure => ({ basis, value: D(value), since, until: addDays(since, spanDays) });

describe('les deux seuils', () => {
  it('la règle de présentation est d’un an, le plancher de bruit du moteur de trente jours', () => {
    expect(ANNUALIZE_MIN_DAYS).toBe(365);
    expect(DAYS_PER_YEAR).toBe(365);
    // Deux questions distinctes : le moteur sait annualiser dès 30 jours, le rapport s'y refuse.
    expect(XIRR_MIN_SPAN_DAYS).toBe(30);
  });
});

describe('periodRate — taux annuel ramené à sa période', () => {
  it('3 100 % par an sur 73 jours (un cinquième d’année) : 32^(1/5) − 1 = +100 %', () => {
    near(periodRate(D('31'), 73), 1);
    // Deux cinquièmes d'année : 32^(2/5) − 1 = 4 − 1.
    near(periodRate(D('31'), 146), 3);
  });

  it('sur une année pile, le taux annuel est le rendement de la période', () => {
    near(periodRate(D('0.21'), 365), 0.21);
  });

  it('un taux nul reste nul, une perte totale reste totale', () => {
    near(periodRate(D('0'), 100), 0);
    near(periodRate(D('-1'), 100), -1);
  });

  it('au-delà de −100 %, aucune puissance réelle : pas de taux plutôt qu’un faux', () => {
    expect(periodRate(D('-1.5'), 100)).toBeNull();
  });
});

describe('annualizedRate — rendement cumulé porté à l’année', () => {
  it('+21 % en 730 jours : 1,21^(1/2) − 1 = +10 % par an', () => {
    near(annualizedRate(D('0.21'), 730), 0.1);
  });

  it('+1,5 % en 30 jours deviendrait 19,9 % « par an » (l’exemple de l’en-tête)', () => {
    near(annualizedRate(D('0.015'), 30), Math.pow(1.015, 365 / 30) - 1);
    near(annualizedRate(D('0.015'), 30), 0.1986, 1e-4);
  });

  it('au-delà de −100 %, pas de taux', () => {
    expect(annualizedRate(D('-1.5'), 400)).toBeNull();
  });
});

describe('presentReturn', () => {
  it('sous un an, un rendement cumulé est présenté tel quel', () => {
    const presented = presentReturn(figure('cumulative', '0.015', '2026-01-01', 30));
    expect(presented).toEqual({
      kind: 'cumulative',
      value: D('0.015'),
      spanDays: 30,
      since: '2026-01-01',
      until: '2026-01-31',
    });
  });

  it('à 364 jours, toujours pas annualisé ; à 365, annualisé — et identique, l’exposant vaut 1', () => {
    expect(presentReturn(figure('cumulative', '0.1', '2026-01-01', 364)).kind).toBe('cumulative');
    const year = shown(presentReturn(figure('cumulative', '0.1', '2026-01-01', 365)));
    expect(year.kind).toBe('annualized');
    expect(year.spanDays).toBe(365);
    near(year.value, 0.1);
  });

  it('au-delà d’un an, un rendement cumulé est annualisé (+21 % en deux ans → +10 %)', () => {
    const presented = shown(presentReturn(figure('cumulative', '0.21', '2024-01-01', 730)));
    expect(presented.kind).toBe('annualized');
    near(presented.value, 0.1);
  });

  it('au-delà d’un an, un taux annuel est présenté tel quel — jamais annualisé deux fois', () => {
    const presented = shown(presentReturn(figure('annual', '0.1', '2024-01-01', 730)));
    expect(presented.kind).toBe('annualized');
    expect(presented.value.eq(D('0.1'))).toBe(true);
  });

  it('sous un an, un taux annuel est ramené à sa période (3 100 %/an sur 73 jours → +100 %)', () => {
    const presented = shown(presentReturn(figure('annual', '31', '2026-01-01', 73)));
    expect(presented.kind).toBe('cumulative');
    expect(presented.spanDays).toBe(73);
    near(presented.value, 1);
  });

  it('une période d’un seul jour de clôture (zéro jour) reste une période : rien à annualiser', () => {
    const cumulative = shown(presentReturn(figure('cumulative', '0.02', '2026-03-01', 0)));
    expect(cumulative.kind).toBe('cumulative');
    expect(cumulative.spanDays).toBe(0);
    expect(cumulative.value.eq(D('0.02'))).toBe(true);
    // Un taux annuel sur zéro jour : (1 + r)^0 − 1 = 0.
    near(shown(presentReturn(figure('annual', '0.5', '2026-03-01', 0))).value, 0);
  });

  it('une année civile atteint le seuil, bissextile ou non ; un jour de moins ne l’atteint pas', () => {
    // De la clôture du 31 décembre à celle du 31 décembre suivant : 366 jours en 2024, 365 en 2025.
    const leap = presentReturn({
      basis: 'cumulative',
      value: D('0.1'),
      since: '2023-12-31',
      until: '2024-12-31',
    });
    expect(shown(leap).spanDays).toBe(366);
    expect(leap.kind).toBe('annualized');
    const plain = presentReturn({
      basis: 'cumulative',
      value: D('0.1'),
      since: '2024-12-31',
      until: '2025-12-31',
    });
    expect(shown(plain).spanDays).toBe(365);
    expect(plain.kind).toBe('annualized');
    const short = presentReturn({
      basis: 'cumulative',
      value: D('0.1'),
      since: '2025-01-01',
      until: '2025-12-31',
    });
    expect(shown(short).spanDays).toBe(364);
    expect(short.kind).toBe('cumulative');
  });

  it('une période illisible ou renversée ne présente rien', () => {
    const none = { kind: 'none', reason: 'invalid-period' };
    expect(
      presentReturn({ basis: 'cumulative', value: D('0.1'), since: 'jamais', until: '2026-01-01' }),
    ).toEqual(none);
    expect(
      presentReturn({ basis: 'cumulative', value: D('0.1'), since: '2026-01-01', until: 'jamais' }),
    ).toEqual(none);
    expect(
      presentReturn({
        basis: 'cumulative',
        value: D('0.1'),
        since: '2026-01-02',
        until: '2026-01-01',
      }),
    ).toEqual(none);
  });

  it('une fin illisible ne se lit jamais comme le 1er janvier 1970, même avec un début antérieur', () => {
    // En JavaScript, `null` vaut 0 dans une comparaison — le jour zéro de l'époque. Après 1970, la
    // garde « fin avant début » rattrape par chance une fin illisible ; avant 1970, plus rien ne la
    // rattraperait, et la période se lirait « du 31/12/1969 au 01/01/1970 ». Le test de mutation
    // l'a montré : la garde explicite était exécutée, jamais vérifiée.
    expect(
      presentReturn({ basis: 'cumulative', value: D('0.1'), since: '1969-12-31', until: 'jamais' }),
    ).toEqual({ kind: 'none', reason: 'invalid-period' });
  });

  it('une croissance négative ne se convertit pas : rien plutôt qu’un chiffre inventé', () => {
    const none = { kind: 'none', reason: 'invalid-rate' };
    expect(presentReturn(figure('annual', '-1.5', '2026-01-01', 100))).toEqual(none);
    expect(presentReturn(figure('cumulative', '-1.5', '2024-01-01', 400))).toEqual(none);
  });
});

describe('presentTimeWeighted', () => {
  const grid = (from: string, count: number): string[] =>
    Array.from({ length: count }, (_, i) => addDays(from, i));

  it('au-delà d’un an, le chiffre présenté EST l’annualisé du moteur, au dernier chiffre près', () => {
    // 1 000 € → 1 210 € en 730 jours, sans apport : +21 % cumulés, +10 % par an.
    const days = grid('2024-01-01', 731);
    const series: TwrDay[] = days.map((day, i) => ({
      day,
      value: D('1000').plus(D('210').times(String(i)).div('730')),
    }));
    const twr = twrEur(series, []);
    if (!twr.ok) throw new Error('TWR attendu');
    const presented = shown(presentTimeWeighted(twr));
    expect(presented.kind).toBe('annualized');
    expect(presented.spanDays).toBe(twr.days);
    // La même formule que `annualize` de `twr.ts` : aucune divergence avec le KPI existant.
    expect(presented.value.eq(twr.annualized!)).toBe(true);
    near(presented.value, 0.1);
  });

  it('entre 30 jours et un an, le moteur annualise et le rapport présente le cumulé', () => {
    const days = grid('2026-01-01', 61);
    const series: TwrDay[] = days.map((day, i) => ({
      day,
      value: D('1000').plus(D(String(i))),
    }));
    const twr = twrEur(series, []);
    if (!twr.ok) throw new Error('TWR attendu');
    expect(twr.annualized).not.toBeNull();
    const presented = shown(presentTimeWeighted(twr));
    expect(presented).toEqual({
      kind: 'cumulative',
      value: twr.cumulative,
      spanDays: 60,
      since: '2026-01-01',
      until: '2026-03-02',
    });
    near(presented.value, 0.06);
  });

  it('un TWR impossible ne présente rien, et dit pourquoi', () => {
    expect(presentTimeWeighted(twrEur([], []))).toEqual({
      kind: 'none',
      reason: 'insufficient-series',
    });
  });
});

describe('presentMoneyWeighted', () => {
  it('1 000 € devenus 2 000 € en 73 jours : +100 % sur la période, jamais 3 100 % « par an »', () => {
    const xirr = xirrEur([{ at: '2026-01-01', amountEur: D('-1000') }], {
      day: '2026-03-15',
      valueEur: D('2000'),
    });
    if (!xirr.ok) throw new Error('XIRR attendu');
    near(xirr.rate, 31, 1e-6); // 2^(365/73) − 1 = 2^5 − 1
    const presented = shown(presentMoneyWeighted(xirr));
    expect(presented.kind).toBe('cumulative');
    expect(presented.spanDays).toBe(73);
    near(presented.value, 1);
  });

  it('sur un an ou plus, le taux annuel du moteur est présenté tel quel', () => {
    // −1 000 € puis +1 100 € 365 jours plus tard : 10 % l'an, et 10 % sur la période.
    const xirr = xirrEur([{ at: '2025-01-01', amountEur: D('-1000') }], {
      day: '2026-01-01',
      valueEur: D('1100'),
    });
    if (!xirr.ok) throw new Error('XIRR attendu');
    const presented = shown(presentMoneyWeighted(xirr));
    expect(presented).toEqual({
      kind: 'annualized',
      value: xirr.rate,
      spanDays: 365,
      since: '2025-01-01',
      until: '2026-01-01',
    });
  });

  it('sur deux ans, le taux annuel n’est pas annualisé une seconde fois (10 %, pas 4,9 %)', () => {
    // −1 000 € puis +1 210 € 730 jours plus tard : 10 % l'an. L'annualiser à nouveau donnerait
    // 1,1^(1/2) − 1 ≈ 4,9 % — l'erreur qu'une année pile (exposant 1) ne peut pas montrer.
    const xirr = xirrEur([{ at: '2024-01-01', amountEur: D('-1000') }], {
      day: '2025-12-31',
      valueEur: D('1210'),
    });
    if (!xirr.ok) throw new Error('XIRR attendu');
    const presented = shown(presentMoneyWeighted(xirr));
    expect(presented.kind).toBe('annualized');
    expect(presented.spanDays).toBe(730);
    expect(presented.value.eq(xirr.rate)).toBe(true);
    near(presented.value, 0.1);
  });

  it('sous le plancher de bruit du moteur, rien — et la raison du moteur', () => {
    const xirr = xirrEur([{ at: '2026-01-01', amountEur: D('-1000') }], {
      day: '2026-01-11',
      valueEur: D('1010'),
    });
    expect(presentMoneyWeighted(xirr)).toEqual({ kind: 'none', reason: 'too-recent' });
  });
});
