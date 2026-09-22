import { describe, expect, it } from 'vitest';
import { EMPTY_FILTER } from '../domain/trading/filter';
import { DEFAULT_UI_SETTINGS, emptyState, sanitizeState, withDefaults } from './schema';

describe('filtre de la liste des trades (réglage ui.tradeFilter, P121)', () => {
  it('est vide par défaut, et ajouté aux états qui ne connaissent pas la clé', () => {
    expect(DEFAULT_UI_SETTINGS.tradeFilter).toEqual(EMPTY_FILTER);
    const legacy = emptyState();
    const { tradeFilter: _dropped, ...uiWithout } = legacy.ui;
    void _dropped;
    expect(withDefaults({ ...legacy, ui: uiWithout } as typeof legacy).ui.tradeFilter).toEqual(
      EMPTY_FILTER,
    );
  });

  it('garde une saisie plausible telle quelle', () => {
    const state = emptyState();
    state.ui = {
      ...state.ui,
      tradeFilter: {
        query: 'btc',
        sides: ['long'],
        outcomes: ['win', 'unannotated'],
        setups: ['Cassure'],
        mistakes: ['Entrée trop tôt'],
        tags: ['scalp'],
        accounts: ['hl:0xabc'],
      },
    };
    expect(sanitizeState(state).state.ui.tradeFilter).toEqual({
      query: 'btc',
      sides: ['long'],
      outcomes: ['win', 'unannotated'],
      setups: ['Cassure'],
      mistakes: ['Entrée trop tôt'],
      tags: ['scalp'],
      accounts: ['hl:0xabc'],
    });
  });

  it('écarte ce qu’un fichier altéré glisserait : un objet entier, un `sides`/`outcomes` hors liste blanche, un compte mal formé', () => {
    const state = emptyState();
    state.ui = {
      ...state.ui,
      tradeFilter: 'btc' as unknown as (typeof state.ui)['tradeFilter'],
    };
    expect(sanitizeState(state).state.ui.tradeFilter).toEqual(EMPTY_FILTER);

    state.ui = {
      ...state.ui,
      tradeFilter: {
        query: { injected: true } as unknown as string,
        sides: ['long', 'sideways', 42],
        outcomes: ['win', 'breakeven'],
        setups: [1, 'Cassure'],
        mistakes: 'not-an-array' as unknown as string[],
        tags: ['scalp', 'x'.repeat(200)],
        accounts: ['hl:0xabc', 'DROP TABLE accounts', ''],
      } as unknown as (typeof state.ui)['tradeFilter'],
    };
    const cleaned = sanitizeState(state).state.ui.tradeFilter;
    expect(cleaned.query).toBe('');
    expect(cleaned.sides).toEqual(['long']);
    expect(cleaned.outcomes).toEqual(['win']);
    expect(cleaned.setups).toEqual(['Cassure']);
    expect(cleaned.mistakes).toEqual([]);
    expect(cleaned.tags).toEqual(['scalp', 'x'.repeat(120)]);
    expect(cleaned.accounts).toEqual(['hl:0xabc']);
  });

  it('plafonne les listes au même plafond que le journal (40 entrées)', () => {
    const state = emptyState();
    state.ui = {
      ...state.ui,
      tradeFilter: {
        ...EMPTY_FILTER,
        tags: Array.from({ length: 60 }, (_, i) => `tag${i}`),
      },
    };
    expect(sanitizeState(state).state.ui.tradeFilter.tags).toHaveLength(40);
  });
});
