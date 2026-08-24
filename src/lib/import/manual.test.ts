/** Saisie manuelle → compte : explicite prioritaire, sinon déduit du périmètre (saisies v1). */
import { describe, expect, it } from 'vitest';
import { COINHOUSE_ACCOUNT_ID, MANUAL_ACCOUNT_ID, type ManualEvent } from '../domain/types';
import { manualAccountId, manualToLedgerEvent } from './manual';

const base = (overrides: Partial<ManualEvent> = {}): ManualEvent => ({
  id: 'm1',
  at: '2026-01-01T10:00:00',
  kind: 'buy',
  asset: 'btc',
  qty: '1',
  amountEur: '100',
  scope: 'coinhouse',
  note: '',
  ...overrides,
});

describe('manualAccountId', () => {
  it('accountId explicite : renvoyé tel quel, quel que soit le scope', () => {
    expect(manualAccountId(base({ accountId: 'man:x1', scope: 'coinhouse' }))).toBe('man:x1');
    expect(manualAccountId(base({ accountId: 'man:x1', scope: 'external' }))).toBe('man:x1');
  });

  it('accountId absent (saisies v1) : déduit du scope — coinhouse → ch:main, external → man:default', () => {
    expect(manualAccountId(base({ scope: 'coinhouse' }))).toBe(COINHOUSE_ACCOUNT_ID);
    expect(manualAccountId(base({ scope: 'external' }))).toBe(MANUAL_ACCOUNT_ID);
  });

  it('accepte juste { scope, accountId } (Pick), sans le reste de ManualEvent', () => {
    expect(manualAccountId({ scope: 'coinhouse' })).toBe(COINHOUSE_ACCOUNT_ID);
    expect(manualAccountId({ scope: 'external' })).toBe(MANUAL_ACCOUNT_ID);
    expect(manualAccountId({ scope: 'external', accountId: 'man:x1' })).toBe('man:x1');
  });
});

describe('manualToLedgerEvent — estampillage de accountId', () => {
  const kinds = ['buy', 'sell', 'reward', 'deposit', 'withdrawal', 'opening-balance'] as const;

  it('accountId = manualAccountId(m) sur chaque nature d’opération, compte déclaré explicite', () => {
    for (const kind of kinds) {
      const event = manualToLedgerEvent(base({ kind, accountId: 'man:x1' }));
      expect(event.accountId).toBe('man:x1');
    }
  });

  it('saisie v1 sans accountId : déduit du scope à la conversion, pour chaque nature', () => {
    for (const kind of kinds) {
      expect(manualToLedgerEvent(base({ kind, scope: 'coinhouse' })).accountId).toBe(
        COINHOUSE_ACCOUNT_ID,
      );
      expect(manualToLedgerEvent(base({ kind, scope: 'external' })).accountId).toBe(
        MANUAL_ACCOUNT_ID,
      );
    }
  });

  it("id préfixé man:, source 'manual', scope reporté tel quel", () => {
    const event = manualToLedgerEvent(base({ id: 'abc123', scope: 'external' }));
    expect(event.id).toBe('man:abc123');
    expect(event.source).toBe('manual');
    expect(event.scope).toBe('external');
  });
});
