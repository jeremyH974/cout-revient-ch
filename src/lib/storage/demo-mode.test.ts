import { describe, expect, it } from 'vitest';
import { DEFAULT_UI_SETTINGS, emptyState, sanitizeState, withDefaults } from './schema';

describe('mode démo (réglage ui.demoMode)', () => {
  it('est désactivé par défaut', () => {
    expect(DEFAULT_UI_SETTINGS.demoMode).toBe(false);
    expect(emptyState().ui.demoMode).toBe(false);
  });

  it('est ajouté aux états antérieurs qui ne connaissent pas la clé', () => {
    const legacy = emptyState();
    const { demoMode: _dropped, ...uiWithoutDemo } = legacy.ui;
    void _dropped;
    const restored = withDefaults({ ...legacy, ui: uiWithoutDemo } as typeof legacy);
    expect(restored.ui.demoMode).toBe(false);
  });

  it('ramène une valeur non booléenne à false', () => {
    const state = emptyState();
    state.ui = { ...state.ui, demoMode: 'oui' as unknown as boolean };
    expect(sanitizeState(state).state.ui.demoMode).toBe(false);
    state.ui = { ...state.ui, demoMode: true };
    expect(sanitizeState(state).state.ui.demoMode).toBe(true);
  });
});
