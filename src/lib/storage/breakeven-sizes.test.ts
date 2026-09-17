import { describe, expect, it } from 'vitest';
import { DEFAULT_UI_SETTINGS, emptyState, sanitizeState, withDefaults } from './schema';

describe('tailles de l’onglet « Seuil » (réglage ui.breakevenSizes)', () => {
  it('sont vides par défaut, et ajoutées aux états qui ne connaissent pas la clé', () => {
    expect(DEFAULT_UI_SETTINGS.breakevenSizes).toEqual({});
    const legacy = emptyState();
    const { breakevenSizes: _dropped, ...uiWithout } = legacy.ui;
    void _dropped;
    expect(withDefaults({ ...legacy, ui: uiWithout } as typeof legacy).ui.breakevenSizes).toEqual(
      {},
    );
  });

  it('gardent le texte tapé par actif, tel quel', () => {
    const state = emptyState();
    state.ui = { ...state.ui, breakevenSizes: { BTC: '10 20 30', SOL: '0,5 ; 1,5' } };
    expect(sanitizeState(state).state.ui.breakevenSizes).toEqual({
      BTC: '10 20 30',
      SOL: '0,5 ; 1,5',
    });
  });

  it('écartent ce qu’un fichier altéré glisserait : objet, nombre, symbole vide ou trop long, roman', () => {
    const state = emptyState();
    state.ui = {
      ...state.ui,
      breakevenSizes: {
        BTC: '10',
        ETH: 20,
        '': '1',
        [`X${'Y'.repeat(40)}`]: '1',
        SOL: '9'.repeat(201),
        HYPE: { taille: '1' },
      } as unknown as Record<string, string>,
    };
    expect(sanitizeState(state).state.ui.breakevenSizes).toEqual({ BTC: '10' });
    state.ui = { ...state.ui, breakevenSizes: 'BTC 10' as unknown as Record<string, string> };
    expect(sanitizeState(state).state.ui.breakevenSizes).toEqual({});
  });
});
