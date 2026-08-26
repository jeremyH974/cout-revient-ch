import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  MIN_TRIGGER_GAP_MS,
  alertConditionMet,
  alertDistance,
  alertThresholdEur,
  evaluateAlerts,
  gateSatisfied,
  initialAlertState,
  isAlertExpired,
  type AlertPositionInput,
  type AlertRule,
  type AlertRuleState,
} from './alerts';
import { COINHOUSE_FEES } from './fees';
import { D } from './money';

const rule = (over: Partial<AlertRule> = {}): AlertRule => ({
  id: 'al:1',
  asset: 'btc',
  direction: 'below',
  threshold: { kind: 'pru-pct', percent: '10' },
  repeat: 'recurring',
  enabled: true,
  note: '',
  createdAt: '2026-08-25T08:00:00.000Z',
  ...over,
});

const pos = (pruEur: string | null, qty = '1'): AlertPositionInput => ({ pruEur, qty });

const armed: AlertRuleState = { armed: true, lastTriggeredAtMs: null, triggerCount: 0 };

const evaluate = (
  r: AlertRule,
  state: AlertRuleState | undefined,
  price: string | undefined,
  position: AlertPositionInput | null,
  nowMs = 1_000_000_000,
) =>
  evaluateAlerts({
    rules: [r],
    states: state ? { [r.id]: state } : {},
    pricesEur: price === undefined ? {} : { [r.asset]: price },
    positions: position === null ? {} : { [r.asset]: position },
    nowMs,
  });

describe('alertThresholdEur', () => {
  it('calcule le seuil relatif au PRU des deux côtés', () => {
    expect(alertThresholdEur(rule(), pos('100'))?.toString()).toBe('90');
    expect(
      alertThresholdEur(
        rule({ direction: 'above', threshold: { kind: 'pru-pct', percent: '25' } }),
        pos('100'),
      )?.toString(),
    ).toBe('125');
    // 0 % : « passe sous le PRU » exactement.
    expect(
      alertThresholdEur(rule({ threshold: { kind: 'pru-pct', percent: '0' } }), pos('61234.56')),
    ).toEqual(D('61234.56'));
  });

  it('suit le PRU : la même règle donne un autre seuil quand le PRU change', () => {
    const r = rule();
    expect(alertThresholdEur(r, pos('100'))?.toString()).toBe('90');
    expect(alertThresholdEur(r, pos('80'))?.toString()).toBe('72');
  });

  it('est dormant sans PRU, fixe pour un seuil en prix, jamais négatif', () => {
    expect(alertThresholdEur(rule(), pos(null))).toBeNull();
    expect(alertThresholdEur(rule(), null)).toBeNull();
    expect(
      alertThresholdEur(
        rule({ threshold: { kind: 'price', priceEur: '50000' } }),
        null,
      )?.toString(),
    ).toBe('50000');
    expect(
      alertThresholdEur(
        rule({ threshold: { kind: 'pru-pct', percent: '150' } }),
        pos('100'),
      )?.toString(),
    ).toBe('0');
  });

  it('seuil net de frais : vendre au seuil dégage exactement l’objectif net', () => {
    // PRU 100, 1 unité, vente en euros 1,29 % + 0,12 € fixe, objectif 0 % net :
    // P = (100 + 0,12) ÷ (1 − 0,0129).
    const r = rule({
      direction: 'above',
      threshold: { kind: 'pru-net-pct', percent: '0', fee: COINHOUSE_FEES['sell-eur'] },
    });
    const threshold = alertThresholdEur(r, pos('100'));
    expect(threshold?.round(9).toString()).toBe(
      D('100.12')
        .div(D('1').minus(D('0.0129')))
        .round(9)
        .toString(),
    );
    // Au seuil : produit net − coût = 0 (à l'arrondi de division près).
    const net = threshold!.times(D('1').minus('0.0129')).minus('0.12');
    expect(net.minus('100').abs().lte('0.000000001')).toBe(true);
    // Sans quantité, pas de seuil (le frais fixe ne peut pas être réparti).
    expect(alertThresholdEur(r, pos('100', '0'))).toBeNull();
  });
});

describe('seuil ancré en dollars (price-usd)', () => {
  const usd = (priceUsd: string): AlertRule => rule({ threshold: { kind: 'price-usd', priceUsd } });

  it('convertit au taux BCE du jour et reste dormant sans taux', () => {
    expect(alertThresholdEur(usd('110'), null, '1.1')?.toString()).toBe('100');
    expect(alertThresholdEur(usd('110'), null)).toBeNull();
    expect(alertThresholdEur(usd('110'), null, null)).toBeNull();
    expect(alertThresholdEur(usd('110'), null, '0')).toBeNull();
  });

  it('propriété : évaluer un seuil $ au taux r ≡ évaluer le seuil € correspondant (€ = $ ÷ r)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10_000_000 }),
        fc.integer({ min: 1, max: 10_000_000 }),
        fc.integer({ min: 101, max: 300 }),
        fc.constantFrom<'below' | 'above'>('below', 'above'),
        (usdCents, spotCents, rateCents, direction) => {
          const priceUsd = D(String(usdCents)).div('100').toString();
          const spot = D(String(spotCents)).div('100').toString();
          const rate = D(String(rateCents)).div('100').toString();
          const rUsd = rule({ direction, threshold: { kind: 'price-usd', priceUsd } });
          const rEur = rule({
            direction,
            threshold: { kind: 'price', priceEur: D(priceUsd).div(rate).toString() },
          });
          const evalUsd = evaluateAlerts({
            rules: [rUsd],
            states: { [rUsd.id]: armed },
            pricesEur: { btc: spot },
            positions: {},
            usdPerEur: rate,
            nowMs: 1_000_000,
          });
          const evalEur = evaluateAlerts({
            rules: [rEur],
            states: { [rEur.id]: armed },
            pricesEur: { btc: spot },
            positions: {},
            nowMs: 1_000_000,
          });
          expect(evalUsd.fired.length).toBe(evalEur.fired.length);
          expect(evalUsd.states[rUsd.id]?.armed).toBe(evalEur.states[rEur.id]?.armed);
          if (evalUsd.fired[0])
            expect(evalUsd.fired[0].thresholdEur).toBe(evalEur.fired[0]!.thresholdEur);
        },
      ),
    );
  });

  it('sans taux, la règle dollar est ignorée par l’évaluation (état inchangé)', () => {
    const r = usd('110');
    const result = evaluateAlerts({
      rules: [r],
      states: { [r.id]: armed },
      pricesEur: { btc: '50' },
      positions: {},
      nowMs: 1_000_000,
    });
    expect(result.fired).toEqual([]);
    expect(result.states[r.id]).toEqual(armed);
  });
});

describe('alertConditionMet / alertDistance', () => {
  it('teste le bon côté, seuil inclus', () => {
    expect(alertConditionMet('below', D('90'), D('90'))).toBe(true);
    expect(alertConditionMet('below', D('90.01'), D('90'))).toBe(false);
    expect(alertConditionMet('above', D('125'), D('125'))).toBe(true);
    expect(alertConditionMet('above', D('124.99'), D('125'))).toBe(false);
  });

  it('mesure l’écart relatif au seuil', () => {
    expect(alertDistance(D('99'), D('90'))?.toString()).toBe('0.1');
    expect(alertDistance(D('81'), D('90'))?.toString()).toBe('-0.1');
    expect(alertDistance(D('10'), D('0'))).toBeNull();
  });
});

describe('evaluateAlerts', () => {
  it('déclenche au franchissement puis se désarme', () => {
    const first = evaluate(rule(), armed, '89', pos('100'));
    expect(first.fired).toHaveLength(1);
    expect(first.fired[0]?.thresholdEur).toBe('90');
    expect(first.fired[0]?.priceEur).toBe('89');
    expect(first.fired[0]?.pruEur).toBe('100');
    expect(first.states['al:1']).toEqual({
      armed: false,
      lastTriggeredAtMs: 1_000_000_000,
      triggerCount: 1,
    });
    // Même prix ensuite : désarmée, plus aucun déclenchement (franchissement, pas niveau).
    const second = evaluate(rule(), first.states['al:1'], '85', pos('100'));
    expect(second.fired).toHaveLength(0);
    expect(second.states['al:1']?.armed).toBe(false);
  });

  it('ne déclenche jamais à la création, même condition déjà remplie', () => {
    expect(initialAlertState(true).armed).toBe(false);
    // Règle sans état connu (sauvegarde importée) : initialisée sans déclenchement.
    const result = evaluate(rule(), undefined, '80', pos('100'));
    expect(result.fired).toHaveLength(0);
    expect(result.states['al:1']).toEqual(initialAlertState(true));
  });

  it('se réarme après un retour au-delà de la marge — règles récurrentes seulement', () => {
    const disarmed: AlertRuleState = { armed: false, lastTriggeredAtMs: 1, triggerCount: 1 };
    // 90 × 1,01 = 90,9 : en dessous, pas de ré-armement ; au-dessus, oui.
    expect(evaluate(rule(), disarmed, '90.89', pos('100')).states['al:1']?.armed).toBe(false);
    expect(evaluate(rule(), disarmed, '90.9', pos('100')).states['al:1']?.armed).toBe(true);
    expect(
      evaluate(rule({ repeat: 'once' }), disarmed, '95', pos('100')).states['al:1']?.armed,
    ).toBe(false);
    // Côté « above » : ré-armement quand le prix redescend sous seuil × 0,99.
    const above = rule({ direction: 'above', threshold: { kind: 'price', priceEur: '100' } });
    expect(evaluate(above, disarmed, '99.01', null).states['al:1']?.armed).toBe(false);
    expect(evaluate(above, disarmed, '99', null).states['al:1']?.armed).toBe(true);
  });

  it('diffère un déclenchement trop rapproché sans le perdre', () => {
    const rearmed: AlertRuleState = { armed: true, lastTriggeredAtMs: 0, triggerCount: 1 };
    const early = evaluate(rule(), rearmed, '89', pos('100'), MIN_TRIGGER_GAP_MS - 1);
    expect(early.fired).toHaveLength(0);
    expect(early.states['al:1']?.armed).toBe(true);
    const late = evaluate(rule(), rearmed, '89', pos('100'), MIN_TRIGGER_GAP_MS);
    expect(late.fired).toHaveLength(1);
    expect(late.states['al:1']?.triggerCount).toBe(2);
  });

  it('laisse dormir les règles désactivées, sans prix ou sans PRU', () => {
    expect(evaluate(rule({ enabled: false }), armed, '80', pos('100')).fired).toHaveLength(0);
    expect(evaluate(rule(), armed, undefined, pos('100')).fired).toHaveLength(0);
    expect(evaluate(rule(), armed, '80', pos(null)).fired).toHaveLength(0);
    // L'état existant traverse l'évaluation inchangé.
    expect(evaluate(rule(), armed, '80', pos(null)).states['al:1']).toEqual(armed);
  });

  it('propriété : un déclenchement exige une règle armée et la condition remplie', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 0, max: 99 }),
        fc.boolean(),
        fc.constantFrom<'below' | 'above'>('below', 'above'),
        (priceCents, pruCents, pct, isArmed, direction) => {
          const price = D(String(priceCents)).div('100');
          const pru = D(String(pruCents)).div('100').toString();
          const r = rule({ direction, threshold: { kind: 'pru-pct', percent: String(pct) } });
          const state: AlertRuleState = {
            armed: isArmed,
            lastTriggeredAtMs: null,
            triggerCount: 0,
          };
          const threshold = alertThresholdEur(r, pos(pru));
          const { fired } = evaluate(r, state, price.toString(), pos(pru));
          const expected =
            isArmed && threshold !== null && alertConditionMet(direction, price, threshold);
          expect(fired.length).toBe(expected ? 1 : 0);
          // Le seuil relatif est toujours du bon côté du PRU.
          if (threshold !== null) {
            if (direction === 'below') expect(threshold.lte(pru)).toBe(true);
            else expect(threshold.gte(pru)).toBe(true);
          }
        },
      ),
    );
  });
});

describe('expiration et conditions composées (décision n° 44)', () => {
  const NOW = 1_800_000_000_000;
  const evaluateWith = (r: AlertRule, fearGreed: number | null = null, nowMs = NOW) =>
    evaluateAlerts({
      rules: [r],
      states: { [r.id]: armed },
      pricesEur: { btc: '80' },
      positions: { btc: pos('100') },
      fearGreed,
      nowMs,
    });

  it('une règle sans date d’expiration ne se périme jamais', () => {
    expect(isAlertExpired(rule(), NOW)).toBe(false);
    expect(evaluateWith(rule()).fired).toHaveLength(1);
  });

  it('une règle expirée ne se déclenche plus, et son état reste intact', () => {
    const expired = rule({ expiresAt: new Date(NOW - 1000).toISOString() });
    expect(isAlertExpired(expired, NOW)).toBe(true);
    const result = evaluateWith(expired);
    expect(result.fired).toHaveLength(0);
    // L'état est conservé : retirer l'expiration ne doit pas ré-armer par surprise.
    expect(result.states[expired.id]).toEqual(armed);
  });

  it('une règle qui expire dans le futur se déclenche normalement', () => {
    const later = rule({ expiresAt: new Date(NOW + 86_400_000).toISOString() });
    expect(evaluateWith(later).fired).toHaveLength(1);
  });

  it('la condition composée bloque le déclenchement sans désarmer la règle', () => {
    const gated = rule({ gate: { kind: 'fear-greed', direction: 'below', value: 20 } });
    // Indice à 50 : le seuil de prix est franchi, mais pas la seconde condition.
    const blocked = evaluateWith(gated, 50);
    expect(blocked.fired).toHaveLength(0);
    expect(blocked.states[gated.id]!.armed).toBe(true);
    // Indice à 15 : les deux conditions sont vraies.
    expect(evaluateWith(gated, 15).fired).toHaveLength(1);
  });

  it('sans contexte de marché, une règle conditionnée reste dormante', () => {
    const gated = rule({ gate: { kind: 'fear-greed', direction: 'above', value: 70 } });
    expect(evaluateWith(gated, null).fired).toHaveLength(0);
    expect(evaluateWith(gated, 75).fired).toHaveLength(1);
  });

  it('gateSatisfied : bornes incluses, et faux dès que le contexte manque', () => {
    const below = { kind: 'fear-greed', direction: 'below', value: 20 } as const;
    expect(gateSatisfied(below, 20)).toBe(true);
    expect(gateSatisfied(below, 21)).toBe(false);
    const above = { kind: 'fear-greed', direction: 'above', value: 70 } as const;
    expect(gateSatisfied(above, 70)).toBe(true);
    expect(gateSatisfied(above, 69)).toBe(false);
    expect(gateSatisfied(above, null)).toBe(false);
    expect(gateSatisfied(above, Number.NaN)).toBe(false);
    // Sans condition, rien ne bloque.
    expect(gateSatisfied(null, null)).toBe(true);
  });
});
