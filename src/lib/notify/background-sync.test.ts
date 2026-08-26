import { describe, expect, it } from 'vitest';
import { alertThresholdEur, type AlertRule } from '../domain/alerts';
import { buildAlertWatchSnapshot, takePendingSwFires } from './background-sync';

const rule = (id: string, over: Partial<AlertRule> = {}): AlertRule => ({
  id,
  asset: 'btc',
  direction: 'below',
  threshold: { kind: 'pru-pct', percent: '10' },
  repeat: 'recurring',
  enabled: true,
  note: '',
  createdAt: '',
  ...over,
});

const baseInput = {
  states: {},
  positions: { btc: { pruEur: '70000', qty: '1' } },
  usdPerEur: '1.1' as string | null,
  idOverrides: {},
  coingeckoDemoKey: null,
  notifUrl: 'https://example.test/#/invest/alerts',
  icon: 'https://example.test/icon.png',
  nowMs: 123,
};

describe('buildAlertWatchSnapshot', () => {
  it('précalcule exactement les seuils du moteur (PRU, prix fixe, prix dollar)', () => {
    const rules = [
      rule('al:pct'),
      rule('al:px', { threshold: { kind: 'price', priceEur: '50000' } }),
      rule('al:usd', { threshold: { kind: 'price-usd', priceUsd: '110000' } }),
    ];
    const snapshot = buildAlertWatchSnapshot({ ...baseInput, rules });
    expect(snapshot.rules.map((r) => r.id)).toEqual(['al:pct', 'al:px', 'al:usd']);
    for (const [i, r] of rules.entries()) {
      const expected = alertThresholdEur(r, baseInput.positions.btc, baseInput.usdPerEur);
      expect(snapshot.rules[i]?.thresholdEur).toBe(expected?.toString());
      expect(snapshot.rules[i]?.coingeckoId).toBe('bitcoin');
      expect(snapshot.rules[i]?.pruEur).toBe('70000');
    }
  });

  it('écarte les règles inactives, sans seuil calculable ou sans identifiant CoinGecko', () => {
    const rules = [
      rule('al:off', { enabled: false }),
      // PRU absent : seuil relatif incalculable.
      rule('al:no-pru', { asset: 'eth' }),
      // Seuil dollar sans taux : dormant.
      rule('al:usd', { threshold: { kind: 'price-usd', priceUsd: '110000' } }),
      // Actif sans identifiant CoinGecko connu : le service worker ne saurait pas le coter.
      rule('al:no-id', { asset: 'zzz-inconnu', threshold: { kind: 'price', priceEur: '1' } }),
    ];
    const snapshot = buildAlertWatchSnapshot({ ...baseInput, usdPerEur: null, rules });
    expect(snapshot.rules).toEqual([]);
  });

  it('reprend l’état d’armement, et traite un état inconnu comme NON armé', () => {
    const rules = [rule('al:armed'), rule('al:fired'), rule('al:new')];
    const snapshot = buildAlertWatchSnapshot({
      ...baseInput,
      rules,
      states: {
        'al:armed': { armed: true, lastTriggeredAtMs: null, triggerCount: 0 },
        'al:fired': { armed: false, lastTriggeredAtMs: 42, triggerCount: 3 },
      },
    });
    expect(snapshot.rules.map((r) => [r.id, r.armed, r.lastTriggeredAtMs, r.triggerCount])).toEqual(
      [
        ['al:armed', true, null, 0],
        ['al:fired', false, 42, 3],
        // Jamais de déclenchement avant que l'app n'ait initialisé la règle.
        ['al:new', false, null, 0],
      ],
    );
  });

  it('respecte les identifiants CoinGecko personnalisés', () => {
    const snapshot = buildAlertWatchSnapshot({
      ...baseInput,
      rules: [rule('al:1', { asset: 'zzz', threshold: { kind: 'price', priceEur: '1' } })],
      positions: {},
      idOverrides: { zzz: 'mon-id-perso' },
    });
    expect(snapshot.rules[0]?.coingeckoId).toBe('mon-id-perso');
  });
});

describe('takePendingSwFires', () => {
  it('rend une liste vide sans IndexedDB (environnement node)', async () => {
    expect(await takePendingSwFires()).toEqual([]);
  });
});

describe('règles que le service worker ne doit PAS voir (décision n° 45)', () => {
  const NOW = 1_800_000_000_000;

  it('écarte les règles expirées et celles à condition composée', () => {
    const rules = [
      rule('al:ok'),
      rule('al:expired', { expiresAt: new Date(NOW - 1).toISOString() }),
      rule('al:gated', { gate: { kind: 'fear-greed', direction: 'below', value: 20 } }),
    ];
    const snapshot = buildAlertWatchSnapshot({ ...baseInput, rules, nowMs: NOW });
    // Le service worker ne sait que comparer un prix à un seuil : il ne peut vérifier ni une date
    // d'expiration au moment du réveil, ni le contexte de marché. Il ne les reçoit donc jamais.
    expect(snapshot.rules.map((r) => r.id)).toEqual(['al:ok']);
  });

  it('garde une règle dont l’expiration est encore à venir', () => {
    const later = rule('al:later', { expiresAt: new Date(NOW + 86_400_000).toISOString() });
    const snapshot = buildAlertWatchSnapshot({ ...baseInput, rules: [later], nowMs: NOW });
    expect(snapshot.rules).toHaveLength(1);
  });
});
