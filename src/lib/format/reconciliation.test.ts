import { describe, expect, it } from 'vitest';
import type { ReconciliationCode, ReconciliationItem } from '../domain/reconciliation';
import { renderReconciliationItem, renderSyncReport, type RenderOptions } from './reconciliation';

const OPTS: RenderOptions = {
  discreet: false,
  currency: 'EUR',
  accountLabels: { 'ch:main': 'Coinhouse', 'hl:0x1': 'Hyperliquid principal' },
};
const DISCREET: RenderOptions = { ...OPTS, discreet: true };

function mkItem(overrides: Partial<ReconciliationItem> = {}): ReconciliationItem {
  return {
    id: 'test-item',
    code: 'unqualified-rows',
    severity: 'warn',
    priority: 50,
    scope: { asset: null, accountId: null },
    values: {},
    evidence: { rowKeys: [], eventIds: [], trace: null },
    action: { code: 'none' },
    ...overrides,
  };
}

/** Un item représentatif par code : sert au test « une phrase complète par code ». */
const SAMPLES: Record<ReconciliationCode, ReconciliationItem> = {
  'unqualified-rows': mkItem({
    code: 'unqualified-rows',
    values: { count: { kind: 'count', value: 3 } },
    action: { code: 'qualify-rows' },
  }),
  'unpriced-asset': mkItem({
    code: 'unpriced-asset',
    scope: { asset: 'btc', accountId: null },
    action: { code: 'set-manual-price', asset: 'btc' },
  }),
  'balance-mismatch': mkItem({
    code: 'balance-mismatch',
    severity: 'fail',
    scope: { asset: 'eth', accountId: 'ch:main' },
    action: { code: 'reimport-export', accountId: 'ch:main', asset: 'eth' },
  }),
  'onchain-balance-gap': mkItem({ code: 'onchain-balance-gap' }),
  'unpaired-withdrawal': mkItem({
    code: 'unpaired-withdrawal',
    scope: { asset: 'btc', accountId: 'ch:main' },
    values: { day: { kind: 'day', value: '2026-01-05T10:00:00' } },
    action: { code: 'pair-or-value-transfer', accountId: 'ch:main', asset: 'btc' },
  }),
  'unpaired-deposit': mkItem({
    code: 'unpaired-deposit',
    scope: { asset: 'btc', accountId: 'ch:main' },
    values: { day: { kind: 'day', value: '2026-01-05T10:00:00' } },
    action: { code: 'pair-or-value-transfer', accountId: 'ch:main', asset: 'btc' },
  }),
  'duplicate-candidate': mkItem({
    code: 'duplicate-candidate',
    scope: { asset: 'btc', accountId: null },
    values: { day: { kind: 'day', value: '2026-01-05T10:00:00' } },
    action: { code: 'review-duplicate', asset: 'btc' },
  }),
  'external-inflow-no-cost': mkItem({
    code: 'external-inflow-no-cost',
    values: { count: { kind: 'count', value: 2 } },
    evidence: { rowKeys: ['pv:x:1', 'pv:x:2'], eventIds: ['e1', 'e2'], trace: null },
    action: { code: 'pair-or-value-transfer' },
  }),
  'external-outflow-unqualified': mkItem({
    code: 'external-outflow-unqualified',
    values: { count: { kind: 'count', value: 1 } },
    action: { code: 'pair-or-value-transfer' },
  }),
  'price-gap-at-cession': mkItem({
    code: 'price-gap-at-cession',
    severity: 'info',
    values: { count: { kind: 'count', value: 4 } },
    action: { code: 'none' },
  }),
  'account-missing-country': mkItem({
    code: 'account-missing-country',
    severity: 'info',
    scope: { asset: null, accountId: 'ch:main' },
    action: { code: 'set-account-country', accountId: 'ch:main' },
  }),
};

describe('renderReconciliationItem', () => {
  it('chaque code produit une phrase complète (titre et détail non vides)', () => {
    for (const [code, item] of Object.entries(SAMPLES)) {
      const rendered = renderReconciliationItem(item, OPTS);
      expect(rendered.title.length, `titre de ${code}`).toBeGreaterThan(0);
      expect(rendered.detail.length, `détail de ${code}`).toBeGreaterThan(0);
      // Une phrase complète se termine par une ponctuation.
      expect(rendered.detail, `ponctuation de ${code}`).toMatch(/[.!?]$/);
    }
  });

  it('le titre et le détail ne répètent jamais le code brut (toujours traduits)', () => {
    for (const item of Object.values(SAMPLES)) {
      const rendered = renderReconciliationItem(item, OPTS);
      expect(rendered.detail).not.toContain(item.code);
    }
  });

  it('chaque code d’action produit un intitulé, sauf « none »', () => {
    const withAction = SAMPLES['unqualified-rows'];
    expect(renderReconciliationItem(withAction, OPTS).actionLabel).toBe('Qualifier ces opérations');
    const noAction = SAMPLES['price-gap-at-cession'];
    expect(renderReconciliationItem(noAction, OPTS).actionLabel).toBe('');
  });

  it('les comptes cités sont résolus via accountLabels, avec repli sur l’id', () => {
    const item = mkItem({
      code: 'account-missing-country',
      scope: { asset: null, accountId: 'ch:main' },
    });
    expect(renderReconciliationItem(item, OPTS).accountLabel).toBe('Coinhouse');
    const unknown = mkItem({
      code: 'account-missing-country',
      scope: { asset: null, accountId: 'csv:inconnu' },
    });
    expect(renderReconciliationItem(unknown, OPTS).accountLabel).toBe('csv:inconnu');
  });

  it('les tickers sont mis en majuscules', () => {
    const item = mkItem({ code: 'unpriced-asset', scope: { asset: 'btc', accountId: null } });
    expect(renderReconciliationItem(item, OPTS).assetLabel).toBe('BTC');
    expect(renderReconciliationItem(item, OPTS).detail).toContain('BTC');
  });

  it('un compteur reste lisible en mode discret (ce n’est pas un montant)', () => {
    const item = SAMPLES['external-inflow-no-cost']!;
    const rendered = renderReconciliationItem(item, DISCREET);
    expect(rendered.detail).toContain('2');
    expect(rendered.evidenceLabel).toMatch(/^\d/);
  });

  it('la preuve compte les lignes/événements cités, jamais masquée', () => {
    const item = mkItem({
      code: 'unqualified-rows',
      evidence: { rowKeys: ['ch:1:eur', 'ch:1:btc'], eventIds: ['ch:1'], trace: null },
    });
    expect(renderReconciliationItem(item, OPTS).evidenceLabel).toBe('2 lignes citées en preuve.');
    expect(renderReconciliationItem(item, DISCREET).evidenceLabel).toBe(
      '2 lignes citées en preuve.',
    );
  });

  it('aucune ligne citée : la preuve le dit explicitement', () => {
    const item = mkItem();
    expect(renderReconciliationItem(item, OPTS).evidenceLabel).toBe(
      'Aucune ligne citée en preuve.',
    );
  });

  it('un écart chiffré (ValueGap) est rendu, et masqué en mode discret sauf le PRU', () => {
    const item = mkItem({
      code: 'unpriced-asset',
      scope: { asset: 'btc', accountId: null },
      evidence: {
        rowKeys: [],
        eventIds: [],
        trace: null,
        gap: {
          metric: 'value-eur',
          asset: 'btc',
          ours: '100',
          theirs: '90',
          delta: '10',
          source: { kind: 'platform-balance', accountId: 'hl:0x1' },
          ourTrace: null,
        },
      },
    });
    const visible = renderReconciliationItem(item, OPTS);
    expect(visible.gapLabel).not.toBeNull();
    expect(visible.gapLabel).toContain('100');
    expect(visible.gapLabel).toContain('90');
    const discreet = renderReconciliationItem(item, DISCREET);
    expect(discreet.gapLabel).not.toContain('100');
    expect(discreet.gapLabel).not.toContain('90');
    expect(discreet.gapLabel).toContain('••••');
  });

  it('un PRU comparé reste lisible en mode discret (c’est un prix, pas un montant)', () => {
    const item = mkItem({
      code: 'unpriced-asset',
      scope: { asset: 'btc', accountId: null },
      evidence: {
        rowKeys: [],
        eventIds: [],
        trace: null,
        gap: {
          metric: 'pru-eur',
          asset: 'btc',
          ours: '25000',
          theirs: '24000',
          delta: '1000',
          source: { kind: 'platform-balance', accountId: 'hl:0x1' },
          ourTrace: null,
        },
      },
    });
    const discreet = renderReconciliationItem(item, DISCREET);
    expect(discreet.gapLabel).toContain('25');
  });

  it('sans écart chiffré, gapLabel est null', () => {
    expect(renderReconciliationItem(mkItem(), OPTS).gapLabel).toBeNull();
  });
});

describe('compte rendu de synchronisation (écran de réconciliation)', () => {
  it('une erreur est reprise mot pour mot, en ton erreur', () => {
    const r = renderSyncReport({ error: 'adresse refusée', truncated: false, added: 0 });
    expect(r.tone).toBe('error');
    expect(r.text).toContain('adresse refusée');
  });

  it('une erreur prime sur tout le reste', () => {
    const r = renderSyncReport({ error: 'coupure', truncated: true, added: 12 });
    expect(r.tone).toBe('error');
  });

  it('une synchronisation tronquée invite à relancer', () => {
    expect(renderSyncReport({ error: null, truncated: true, added: 3 }).text).toContain('relancez');
  });

  it('rien de neuf le dit, plutôt que de laisser croire que le bouton n’a rien fait', () => {
    const r = renderSyncReport({ error: null, truncated: false, added: 0 });
    expect(r.text).toContain('Aucun élément nouveau');
    expect(r.tone).toBe('info');
  });

  it('un statut absent est traité comme « rien de neuf », jamais comme un succès muet', () => {
    expect(renderSyncReport(undefined).text).toContain('Aucun élément nouveau');
  });

  it('le pluriel s’accorde', () => {
    expect(renderSyncReport({ error: null, truncated: false, added: 1 }).text).toBe(
      '1 élément récupéré.',
    );
    expect(renderSyncReport({ error: null, truncated: false, added: 4 }).text).toBe(
      '4 éléments récupérés.',
    );
  });
});
