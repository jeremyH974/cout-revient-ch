/**
 * Les toasts et le drapeau de mise à jour (décision n° 88).
 *
 * Quarante-sept lignes de comportement visible que rien ne vérifiait : un toast qui ne
 * disparaîtrait plus s'accumulerait à l'écran, et un « Appliquer » armé mais muet laisserait
 * l'utilisateur sur une version périmée en croyant l'avoir mise à jour.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toasts, update } from './ui.svelte';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  // Purge : ces états sont des singletons de module, partagés d'un test à l'autre.
  vi.runAllTimers();
  vi.useRealTimers();
});

describe('toasts', () => {
  it('empile, puis oublie tout seul après son délai', () => {
    toasts.push('Sauvegardé', 'success', 1000);
    expect(toasts.items.map((t) => t.text)).toEqual(['Sauvegardé']);
    expect(toasts.items[0]?.kind).toBe('success');
    vi.advanceTimersByTime(999);
    expect(toasts.items.length, 'pas avant l’heure').toBe(1);
    vi.advanceTimersByTime(1);
    expect(toasts.items, 'un toast qui ne part jamais s’accumule à l’écran').toEqual([]);
  });

  it('donne un identifiant distinct à chaque toast, même de même texte', () => {
    toasts.push('Copié', 'info', 5000);
    toasts.push('Copié', 'info', 5000);
    const [first, second] = toasts.items;
    expect(first?.id).not.toBe(second?.id);
  });

  it('se ferme à la demande, sans toucher aux autres', () => {
    toasts.push('A', 'info', 9000);
    toasts.push('B', 'info', 9000);
    const first = toasts.items[0]!;
    toasts.dismiss(first.id);
    expect(toasts.items.map((t) => t.text)).toEqual(['B']);
  });

  it('fermer deux fois le même toast ne fait rien de plus', () => {
    toasts.push('A', 'info', 9000);
    const id = toasts.items[0]!.id;
    toasts.dismiss(id);
    toasts.dismiss(id);
    expect(toasts.items).toEqual([]);
  });

  it('le ton par défaut est neutre', () => {
    toasts.push('Note');
    expect(toasts.items[0]?.kind).toBe('info');
  });
});

describe('mise à jour en attente', () => {
  it('n’est pas prête tant que rien ne l’a armée', () => {
    expect(update.ready).toBe(false);
  });

  it('appliquer sans avoir armé ne lève pas', () => {
    expect(() => update.apply()).not.toThrow();
  });

  it('armer rend prêt, et appliquer déclenche l’action une fois par appel', () => {
    const fn = vi.fn();
    update.arm(fn);
    expect(update.ready).toBe(true);
    update.apply();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
