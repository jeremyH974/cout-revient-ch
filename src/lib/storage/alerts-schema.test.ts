/** Persistance des alertes de prix : défauts, assainissement, fusion de sauvegardes. */
import { describe, expect, it } from 'vitest';
import type { AlertEvent, AlertRule, AlertRuleState } from '../domain/alerts';
import { mergeStates, parseBackup, serializeBackup } from './json-io';
import {
  DEFAULT_ALERTS_SETTINGS,
  MAX_ALERT_EVENTS,
  emptyAlertsState,
  emptyState,
  sanitizeState,
  withDefaults,
  type StoredStateV1,
} from './schema';

const rule = (id: string, over: Partial<AlertRule> = {}): AlertRule => ({
  id,
  asset: 'btc',
  direction: 'below',
  threshold: { kind: 'pru-pct', percent: '10' },
  repeat: 'recurring',
  enabled: true,
  note: '',
  createdAt: '2026-08-25T08:00:00.000Z',
  ...over,
});

const armedState = (): AlertRuleState => ({
  armed: true,
  lastTriggeredAtMs: null,
  triggerCount: 0,
});

const event = (id: string, at: string): AlertEvent => ({
  id,
  ruleId: 'al:1',
  asset: 'btc',
  direction: 'below',
  thresholdEur: '90',
  priceEur: '89',
  pruEur: '100',
  at,
  read: false,
});

function withAlerts(patch: Partial<StoredStateV1['alerts']>): StoredStateV1 {
  const base = emptyState();
  return { ...base, alerts: { ...base.alerts, ...patch } };
}

describe('withDefaults / sanitizeState (alerts)', () => {
  it('complète une sauvegarde antérieure aux alertes', () => {
    const legacy = emptyState() as Partial<StoredStateV1>;
    delete legacy.alerts;
    const completed = withDefaults(legacy as StoredStateV1);
    expect(completed.alerts.rules).toEqual({});
    expect(completed.alerts.settings).toEqual(DEFAULT_ALERTS_SETTINGS);
    expect(sanitizeState(completed).dropped).toBe(0);
  });

  it('écarte les règles corrompues, garde les saines', () => {
    const good = rule('al:1');
    const netFee = rule('al:2', {
      direction: 'above',
      threshold: { kind: 'pru-net-pct', percent: '25', fee: { pctFee: '1.29', fixedEur: '0.12' } },
    });
    const usdAnchored = rule('al:3', { threshold: { kind: 'price-usd', priceUsd: '110000' } });
    const input = withAlerts({
      rules: {
        'al:1': good,
        'al:2': netFee,
        'al:3': usdAnchored,
        'al:bad-dir': { ...rule('al:bad-dir'), direction: 'sideways' } as unknown as AlertRule,
        'al:bad-pct': rule('al:bad-pct', {
          threshold: { kind: 'pru-pct', percent: '-5' },
        }),
        'al:bad-fee': {
          ...rule('al:bad-fee'),
          threshold: { kind: 'pru-net-pct', percent: '10', fee: { pctFee: 'x', fixedEur: '0' } },
        } as unknown as AlertRule,
        'al:bad-usd': {
          ...rule('al:bad-usd'),
          threshold: { kind: 'price-usd', priceUsd: '-1' },
        } as unknown as AlertRule,
      },
      states: {
        'al:1': armedState(),
        'al:orphan': armedState(),
        'al:2': { armed: 'yes' } as unknown as AlertRuleState,
      },
    });
    const { state: sane, dropped } = sanitizeState(input);
    expect(Object.keys(sane.alerts.rules).sort()).toEqual(['al:1', 'al:2', 'al:3']);
    expect(sane.alerts.rules['al:2']?.threshold).toEqual(netFee.threshold);
    expect(sane.alerts.rules['al:3']?.threshold).toEqual(usdAnchored.threshold);
    // États : l'orphelin part sans compter, l'état lisible reste, l'illisible est réparé a minima.
    expect(sane.alerts.states['al:1']).toEqual(armedState());
    expect('al:orphan' in sane.alerts.states).toBe(false);
    expect(sane.alerts.states['al:2']).toEqual({
      armed: false,
      lastTriggeredAtMs: null,
      triggerCount: 0,
    });
    expect(dropped).toBe(4);
  });

  it('borne le journal, le trie du plus récent au plus ancien, répare les réglages', () => {
    const events = Array.from({ length: MAX_ALERT_EVENTS + 20 }, (_, i) =>
      event(`al:e${i}`, `2026-08-${String(1 + (i % 25)).padStart(2, '0')}T00:00:0${i % 10}`),
    );
    const input = withAlerts({
      events,
      settings: { watch: true, watchMinutes: 999, systemNotifications: 'on' } as never,
    });
    const { state: sane } = sanitizeState(input);
    expect(sane.alerts.events).toHaveLength(MAX_ALERT_EVENTS);
    const ats = sane.alerts.events.map((e) => e.at);
    expect([...ats].sort((a, b) => b.localeCompare(a))).toEqual(ats);
    expect(sane.alerts.settings).toEqual({
      watch: true,
      watchMinutes: 60,
      systemNotifications: false,
    });
  });

  it('survit à un aller-retour de sauvegarde JSON', () => {
    const input = withAlerts({
      rules: { 'al:1': rule('al:1') },
      states: { 'al:1': { armed: false, lastTriggeredAtMs: 123, triggerCount: 2 } },
      events: [event('al:e1', '2026-08-25T08:00:00.000Z')],
      settings: { watch: true, watchMinutes: 5, systemNotifications: true },
    });
    const parsed = parseBackup(serializeBackup(input, '2026-08-25T09:00:00.000Z'));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.state.alerts).toEqual(input.alerts);
  });
});

describe('mergeStates (alerts)', () => {
  it('unit les règles et le journal, garde les réglages courants', () => {
    const current = withAlerts({
      rules: { 'al:1': rule('al:1', { note: 'à moi' }) },
      states: { 'al:1': { armed: false, lastTriggeredAtMs: 1, triggerCount: 1 } },
      events: [event('al:e1', '2026-08-25T08:00:00.000Z')],
      settings: { watch: true, watchMinutes: 5, systemNotifications: true },
    });
    const incoming = withAlerts({
      rules: { 'al:1': rule('al:1', { note: 'importée' }), 'al:2': rule('al:2') },
      states: { 'al:2': armedState() },
      events: [
        event('al:e1', '2026-08-25T08:00:00.000Z'),
        event('al:e2', '2026-08-24T08:00:00.000Z'),
      ],
      settings: { watch: false, watchMinutes: 1, systemNotifications: false },
    });
    const merged = mergeStates(current, incoming);
    expect(merged.alerts.rules['al:1']?.note).toBe('à moi');
    expect(Object.keys(merged.alerts.rules).sort()).toEqual(['al:1', 'al:2']);
    expect(merged.alerts.events.map((e) => e.id)).toEqual(['al:e1', 'al:e2']);
    expect(merged.alerts.settings).toEqual(current.alerts.settings);
  });
});

describe('expiration et condition composée (décision n° 44)', () => {
  const withRule = (over: Record<string, unknown>) =>
    sanitizeState({
      ...emptyState(),
      alerts: {
        ...emptyAlertsState(),
        rules: {
          'al:1': {
            id: 'al:1',
            asset: 'btc',
            direction: 'below',
            threshold: { kind: 'pru-pct', percent: '10' },
            repeat: 'recurring',
            enabled: true,
            note: '',
            createdAt: '',
            ...over,
          },
        },
      },
    }).state.alerts.rules['al:1'];

  it('conserve une date d’expiration lisible, écarte une date illisible', () => {
    expect(withRule({ expiresAt: '2027-01-01T00:00:00.000Z' })?.expiresAt).toBe(
      '2027-01-01T00:00:00.000Z',
    );
    // Illisible = sans limite : jamais une règle rendue muette par une donnée abîmée.
    expect(withRule({ expiresAt: 'bientôt' })?.expiresAt).toBeUndefined();
    expect(withRule({ expiresAt: 42 })?.expiresAt).toBeUndefined();
  });

  it('n’accepte une condition composée que complète et dans l’échelle 0-100', () => {
    expect(withRule({ gate: { kind: 'fear-greed', direction: 'below', value: 20 } })?.gate).toEqual(
      {
        kind: 'fear-greed',
        direction: 'below',
        value: 20,
      },
    );
    // Au moindre doute, la condition disparaît — une règle sans condition se déclenche, elle ne
    // reste pas bloquée par un fragment de données incompréhensible.
    expect(
      withRule({ gate: { kind: 'autre', direction: 'below', value: 20 } })?.gate,
    ).toBeUndefined();
    expect(
      withRule({ gate: { kind: 'fear-greed', direction: 'sideways', value: 20 } })?.gate,
    ).toBeUndefined();
    expect(
      withRule({ gate: { kind: 'fear-greed', direction: 'below', value: 140 } })?.gate,
    ).toBeUndefined();
    expect(withRule({ gate: 'peur' })?.gate).toBeUndefined();
  });
});
