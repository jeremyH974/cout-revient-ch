/**
 * Le noyau du service worker (public/sw-alerts-core.js) est un script classique hors module :
 * on le charge dans un bac à sable node:vm et on vérifie PAR PROPRIÉTÉS qu'il rend exactement
 * les mêmes verdicts que le moteur — comparaison décimale contre big.js, décision de
 * déclenchement contre `evaluateAlerts` (sur des règles armées : le service worker ne ré-arme
 * jamais, choix conservateur documenté dans la décision n° 38).
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MIN_TRIGGER_GAP_MS, evaluateAlerts, type AlertRule } from '../domain/alerts';
import { D } from '../domain/money';
import type { AlertWatchRule, AlertWatchSnapshot, SwAlertFire } from './background-sync';

interface AlertSyncCore {
  cmpDec(a: string, b: string): number;
  decideFires(
    snapshot: AlertWatchSnapshot,
    pricesById: Record<string, string>,
    nowMs: number,
  ): { fires: SwAlertFire[]; rules: AlertWatchRule[] };
}

const code = readFileSync(new URL('../../../public/sw-alerts-core.js', import.meta.url), 'utf8');
const sandbox: { self: { AlertSyncCore?: AlertSyncCore } } = { self: {} };
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const core = sandbox.self.AlertSyncCore;
if (!core) throw new Error('sw-alerts-core.js n’a pas exposé AlertSyncCore');

/** Chaîne décimale arbitraire (signe, mantisse, décalage décimal) — jamais de flottant. */
const decimal = fc
  .tuple(fc.boolean(), fc.bigInt({ min: 0n, max: 10n ** 24n }), fc.integer({ min: 0, max: 12 }))
  .map(([neg, mantissa, dp]) => {
    const digits = mantissa.toString().padStart(dp + 1, '0');
    const int = digits.slice(0, digits.length - dp) || '0';
    const frac = dp > 0 ? digits.slice(digits.length - dp) : '';
    return `${neg ? '-' : ''}${int}${frac ? `.${frac}` : ''}`;
  });

describe('cmpDec (comparaison décimale exacte du service worker)', () => {
  it('propriété : même verdict que big.js sur toute paire de décimaux', () => {
    fc.assert(
      fc.property(decimal, decimal, (a, b) => {
        expect(core.cmpDec(a, b)).toBe(D(a).cmp(b));
      }),
      { numRuns: 500 },
    );
  });

  it('cas limites : zéros signés, zéros de queue, longueurs d’entiers', () => {
    expect(core.cmpDec('-0', '0')).toBe(0);
    expect(core.cmpDec('1.50', '1.5')).toBe(0);
    expect(core.cmpDec('0060000', '60000.000')).toBe(0);
    expect(core.cmpDec('9.999999999', '10')).toBe(-1);
    expect(core.cmpDec('-2', '-10')).toBe(1);
    expect(core.cmpDec('0.000000001', '0')).toBe(1);
  });
});

describe('decideFires (décision du service worker) ≡ evaluateAlerts (moteur)', () => {
  interface Scenario {
    threshold: string;
    price: string;
    direction: 'below' | 'above';
    lastTriggeredAtMs: number | null;
    triggerCount: number;
  }
  const scenario: fc.Arbitrary<Scenario> = fc.record({
    threshold: decimal.map((d) => d.replace('-', '')),
    price: decimal.map((d) => d.replace('-', '')),
    direction: fc.constantFrom<'below' | 'above'>('below', 'above'),
    lastTriggeredAtMs: fc.option(fc.integer({ min: 0, max: 10_000_000 }), { nil: null }),
    triggerCount: fc.integer({ min: 0, max: 5 }),
  });

  it('propriété : mêmes déclenchements, mêmes états, sur des règles armées', () => {
    const NOW = 10_000_000 + MIN_TRIGGER_GAP_MS;
    fc.assert(
      fc.property(fc.array(scenario, { minLength: 1, maxLength: 8 }), (scenarios) => {
        const rules: AlertRule[] = scenarios.map((s, i) => ({
          id: `al:${i}`,
          asset: `a${i}`,
          direction: s.direction,
          threshold: { kind: 'price', priceEur: s.threshold },
          repeat: 'once',
          enabled: true,
          note: '',
          createdAt: '',
        }));
        const engine = evaluateAlerts({
          rules,
          states: Object.fromEntries(
            scenarios.map((s, i) => [
              `al:${i}`,
              { armed: true, lastTriggeredAtMs: s.lastTriggeredAtMs, triggerCount: s.triggerCount },
            ]),
          ),
          pricesEur: Object.fromEntries(scenarios.map((s, i) => [`a${i}`, s.price])),
          positions: {},
          nowMs: NOW,
        });
        const snapshot: AlertWatchSnapshot = {
          v: 1,
          updatedAtMs: 0,
          minGapMs: MIN_TRIGGER_GAP_MS,
          notifUrl: 'https://example.test/#/invest/alerts',
          icon: 'https://example.test/icon.png',
          coingeckoDemoKey: null,
          rules: scenarios.map((s, i) => ({
            id: `al:${i}`,
            asset: `a${i}`,
            coingeckoId: `id${i}`,
            direction: s.direction,
            thresholdEur: s.threshold,
            pruEur: null,
            armed: true,
            lastTriggeredAtMs: s.lastTriggeredAtMs,
            triggerCount: s.triggerCount,
          })),
        };
        const sw = core.decideFires(
          snapshot,
          Object.fromEntries(scenarios.map((s, i) => [`id${i}`, s.price])),
          NOW,
        );
        // Mêmes règles déclenchées, même prix et même seuil — à la forme près : le moteur
        // canonise via big.js (« 0.0 » → « 0 »), le service worker relaie la chaîne reçue.
        const canon = (v: string): string => D(v).toString();
        expect(sw.fires.map((f) => [f.ruleId, canon(f.priceEur), canon(f.thresholdEur)])).toEqual(
          engine.fired.map((f) => [f.rule.id, canon(f.priceEur), canon(f.thresholdEur)]),
        );
        // Mêmes états après coup : armement, horodatage, compteur.
        for (const rule of sw.rules) {
          const engineState = engine.states[rule.id];
          expect(rule.armed).toBe(engineState?.armed);
          expect(rule.lastTriggeredAtMs).toBe(engineState?.lastTriggeredAtMs ?? null);
          expect(rule.triggerCount).toBe(engineState?.triggerCount);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('ne déclenche jamais une règle désarmée ni sans prix, et respecte le délai minimal', () => {
    const base: AlertWatchRule = {
      id: 'al:0',
      asset: 'btc',
      coingeckoId: 'bitcoin',
      direction: 'below',
      thresholdEur: '60000',
      pruEur: '70000',
      armed: true,
      lastTriggeredAtMs: null,
      triggerCount: 0,
    };
    const snapshot = (rule: AlertWatchRule): AlertWatchSnapshot => ({
      v: 1,
      updatedAtMs: 0,
      minGapMs: MIN_TRIGGER_GAP_MS,
      notifUrl: 'u',
      icon: 'i',
      coingeckoDemoKey: null,
      rules: [rule],
    });
    // Désarmée : rien, même condition remplie.
    expect(
      core.decideFires(snapshot({ ...base, armed: false }), { bitcoin: '50000' }, 1).fires,
    ).toEqual([]);
    // Sans prix (ou prix illisible) : rien.
    expect(core.decideFires(snapshot(base), {}, 1).fires).toEqual([]);
    expect(core.decideFires(snapshot(base), { bitcoin: 'NaN' }, 1).fires).toEqual([]);
    // Délai minimal : un déclenchement trop récent bloque, la règle RESTE armée (différé).
    const recent = { ...base, lastTriggeredAtMs: 1_000 };
    const blocked = core.decideFires(snapshot(recent), { bitcoin: '50000' }, 2_000);
    expect(blocked.fires).toEqual([]);
    expect(blocked.rules[0]).toEqual(recent);
    // Après le délai : déclenche, désarme, horodate, incrémente.
    const after = core.decideFires(
      snapshot(recent),
      { bitcoin: '50000' },
      1_000 + MIN_TRIGGER_GAP_MS,
    );
    expect(after.fires).toHaveLength(1);
    expect(after.fires[0]).toMatchObject({
      ruleId: 'al:0',
      priceEur: '50000',
      thresholdEur: '60000',
      pruEur: '70000',
    });
    expect(after.rules[0]).toMatchObject({
      armed: false,
      lastTriggeredAtMs: 1_000 + MIN_TRIGGER_GAP_MS,
      triggerCount: 1,
    });
  });
});
