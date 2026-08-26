import { describe, expect, it } from 'vitest';
import { D, ONE, ZERO, type Big } from './money';
import { RISK_MIN_DAYS, YEAR_DAYS, riskMetrics } from './risk';
import { twrEur, type TwrDay, type TwrFlow, type TwrIndexPoint } from './twr';

/** Série d'indice à partir de valeurs brutes, un jour par valeur depuis le 2026-01-01. */
function index(values: readonly string[]): TwrIndexPoint[] {
  return values.map((value, i) => ({
    day: `2026-01-${String(i + 1).padStart(2, '0')}`,
    index: D(value),
  }));
}

const day = (i: number): string => `2026-01-${String(i).padStart(2, '0')}`;

describe('riskMetrics', () => {
  it('se tait sur une série trop courte', () => {
    expect(riskMetrics([])).toBeNull();
    expect(riskMetrics(index(['1']))).toBeNull();
  });

  it('mesure le repli du plus haut au creux, et la date où il est comblé', () => {
    // 1 → 1,2 (plus haut) → 0,9 (creux, −25 %) → 1,25 (plus haut retrouvé) → 1,1.
    const m = riskMetrics(index(['1', '1.2', '0.9', '1.25', '1.1']));
    expect(m).not.toBeNull();
    expect(m!.maxDrawdown).not.toBeNull();
    expect(m!.maxDrawdown!.depth.toString()).toBe('0.25');
    expect(m!.maxDrawdown!.peakDay).toBe(day(2));
    expect(m!.maxDrawdown!.troughDay).toBe(day(3));
    expect(m!.maxDrawdown!.recoveredDay).toBe(day(4));
    // Dernier point à 1,1 sous un plus haut de 1,25 : le repli en cours vaut 12 %.
    expect(m!.currentDrawdown.toString()).toBe('0.12');
  });

  it('laisse le repli ouvert tant que le plus haut n’est pas retrouvé', () => {
    const m = riskMetrics(index(['1', '2', '1', '1.5']))!;
    expect(m.maxDrawdown!.depth.toString()).toBe('0.5');
    expect(m.maxDrawdown!.recoveredDay).toBeNull();
    expect(m.currentDrawdown.toString()).toBe('0.25');
  });

  it('garde le repli le PLUS profond, pas le dernier', () => {
    // −40 % d'abord, puis −10 % après un nouveau plus haut.
    const m = riskMetrics(index(['1', '0.6', '1.2', '1.08']))!;
    expect(m.maxDrawdown!.depth.toString()).toBe('0.4');
    expect(m.maxDrawdown!.troughDay).toBe(day(2));
  });

  it('ne dit rien du repli d’un indice qui monte toujours', () => {
    const m = riskMetrics(index(['1', '1.1', '1.2', '1.3']))!;
    expect(m.maxDrawdown).toBeNull();
    expect(m.currentDrawdown.toString()).toBe('0');
    // Sans jour de baisse, pas de dénominateur : ni volatilité baissière, ni Sortino.
    expect(m.downsideAnnual).toBeNull();
    expect(m.sortino).toBeNull();
  });

  it('compte les jours gagnants et perdants et retient les extrêmes', () => {
    const m = riskMetrics(index(['1', '1.1', '1.045', '1.1495']))!;
    expect(m.days).toBe(3);
    expect(m.positiveDays).toBe(2);
    expect(m.negativeDays).toBe(1);
    expect(m.bestDay!.day).toBe(day(2));
    expect(m.bestDay!.ret.toString()).toBe('0.1');
    expect(m.worstDay!.day).toBe(day(3));
    // 1,045 / 1,1 − 1 = −0,05.
    expect(m.worstDay!.ret.round(10).toString()).toBe('-0.05');
  });

  it('n’annonce une volatilité qu’au-delà de 30 rendements quotidiens', () => {
    const short = riskMetrics(index(['1', '1.05', '0.99']))!;
    expect(short.volatilityDaily).toBeNull();
    expect(short.volatilityAnnual).toBeNull();
    // Le repli, lui, reste mesurable dès le premier recul.
    expect(short.maxDrawdown).not.toBeNull();

    // Série alternée assez longue : la volatilité apparaît.
    const values = ['1'];
    for (let i = 1; i <= RISK_MIN_DAYS; i++) {
      const previous = D(values[i - 1]!);
      values.push(previous.times(i % 2 === 0 ? '1.02' : '0.98').toString());
    }
    const long = riskMetrics(
      values.map((value, i) => ({ day: `2026-${i < 31 ? '01' : '02'}-01`, index: D(value) })),
    )!;
    expect(long.days).toBe(RISK_MIN_DAYS);
    expect(long.volatilityDaily!.gt(ZERO)).toBe(true);
    // Annualisation : × √365, à la précision d'arrondi près.
    const expected = long.volatilityDaily!.times(D(String(YEAR_DAYS)).sqrt());
    expect(long.volatilityAnnual!.minus(expected).abs().lt(D('0.000000001'))).toBe(true);
  });

  it('calcule le Sortino comme rendement annualisé ÷ volatilité baissière', () => {
    const values = ['1'];
    for (let i = 1; i <= 40; i++) {
      const previous = D(values[i - 1]!);
      values.push(previous.times(i % 3 === 0 ? '0.97' : '1.02').toString());
    }
    const series = values.map((value, i) => ({
      day: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
      index: D(value),
    }));
    const annualized = D('0.35');
    const m = riskMetrics(series, annualized)!;
    expect(m.downsideAnnual).not.toBeNull();
    const expected = annualized.div(m.downsideAnnual!);
    expect(m.sortino!.minus(expected).abs().lt(D('0.000001'))).toBe(true);
    // Sans rendement annualisé fourni (période trop courte pour annualiser), pas de Sortino.
    expect(riskMetrics(series)!.sortino).toBeNull();
  });
});

describe('risque et flux : la mesure porte sur l’indice, jamais sur la valeur brute', () => {
  const days: TwrDay[] = [
    { day: '2026-01-01', value: D('1000') },
    { day: '2026-01-02', value: D('1100') },
    // Retrait de 600 € : la VALEUR s'effondre de 45 %, la performance ne bouge pas.
    { day: '2026-01-03', value: D('500') },
    { day: '2026-01-04', value: D('550') },
  ];
  const flows: TwrFlow[] = [{ at: '2026-01-03T00:00:00', amountEur: D('-600') }];

  it('un retrait n’invente pas de repli', () => {
    const twr = twrEur(days, flows);
    expect(twr.ok).toBe(true);
    if (!twr.ok) return;
    // L'indice ne recule jamais : +10 %, puis stable, puis +10 %.
    const m = riskMetrics(twr.index)!;
    expect(m.maxDrawdown).toBeNull();
    expect(m.currentDrawdown.toString()).toBe('0');

    // Le même calcul sur la valeur brute verrait un « krach » de 55 % le jour du retrait.
    const naive = riskMetrics(days.map((d) => ({ day: d.day, index: d.value })))!;
    expect(naive.maxDrawdown).not.toBeNull();
    expect(naive.maxDrawdown!.depth.gt(D('0.5'))).toBe(true);
  });

  it('l’indice du TWR part de 1 et finit sur le rendement cumulé', () => {
    const twr = twrEur(days, flows);
    if (!twr.ok) throw new Error('TWR attendu');
    expect(twr.index).toHaveLength(days.length);
    expect(twr.index[0]!.index.eq(ONE)).toBe(true);
    expect(twr.index[0]!.day).toBe('2026-01-01');
    const lastIndex: Big = twr.index[twr.index.length - 1]!.index;
    expect(lastIndex.minus(ONE).minus(twr.cumulative).abs().lt(D('0.000000001'))).toBe(true);
  });
});
