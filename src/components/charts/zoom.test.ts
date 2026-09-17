import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  clampWindow,
  fullWindow,
  isFullView,
  minimumSpan,
  panWindow,
  visibleRange,
  zoomWindow,
  type TimeWindow,
} from './zoom';

const full: TimeWindow = { from: 0, to: 1000 };

describe('fullWindow / minimumSpan', () => {
  it('la série entière, et la durée des quatre points consécutifs les plus serrés', () => {
    const times = [0, 100, 200, 210, 220, 230, 600, 1000];
    expect(fullWindow(times)).toEqual({ from: 0, to: 1000 });
    // 200 → 230 : quatre points en 30 ms, la finesse la plus grande de la série.
    expect(minimumSpan(times, fullWindow(times)!)).toBe(30);
  });

  it('pas de fenêtre sans deux instants distincts', () => {
    expect(fullWindow([])).toBeNull();
    expect(fullWindow([5])).toBeNull();
    expect(fullWindow([5, 5])).toBeNull();
  });
});

describe('zoomWindow', () => {
  it('rapproche autour du curseur, qui garde sa place à l’écran', () => {
    // Curseur au quart de la fenêtre : il y reste après un zoom × 2.
    const next = zoomWindow(full, full, 250, 2, 10);
    expect(next).toEqual({ from: 125, to: 625 });
    expect((250 - next.from) / (next.to - next.from)).toBe(0.25);
  });

  it('éloigne sans jamais dépasser la série, et ne resserre pas sous la finesse des points', () => {
    expect(zoomWindow({ from: 400, to: 600 }, full, 500, 0.01, 10)).toEqual(full);
    expect(zoomWindow({ from: 400, to: 600 }, full, 500, 1000, 50)).toEqual({ from: 475, to: 525 });
  });

  it('un zoom près du bord reste dans la série', () => {
    expect(zoomWindow({ from: 900, to: 1000 }, full, 1000, 0.5, 10)).toEqual({
      from: 800,
      to: 1000,
    });
  });
});

describe('panWindow / clampWindow', () => {
  it('se déplace en gardant la durée, et bute sur les bords', () => {
    expect(panWindow({ from: 100, to: 300 }, full, 150)).toEqual({ from: 250, to: 450 });
    expect(panWindow({ from: 100, to: 300 }, full, -500)).toEqual({ from: 0, to: 200 });
    expect(panWindow({ from: 700, to: 900 }, full, 500)).toEqual({ from: 800, to: 1000 });
    expect(clampWindow({ from: -50, to: 2000 }, full)).toEqual(full);
  });

  it('isFullView : rien de zoomé tant que la fenêtre couvre tout', () => {
    expect(isFullView(null, full)).toBe(true);
    expect(isFullView(full, full)).toBe(true);
    expect(isFullView({ from: 1, to: 1000 }, full)).toBe(false);
  });
});

describe('visibleRange', () => {
  const times = [0, 10, 20, 30, 40];

  it('les points de la fenêtre, bornes comprises', () => {
    expect(visibleRange(times, { from: 10, to: 30 })).toEqual({ start: 1, end: 3 });
    expect(visibleRange(times, null)).toEqual({ start: 0, end: 4 });
  });

  it('moins de deux points dans la fenêtre : les voisins immédiats, jamais un graphique vide', () => {
    expect(visibleRange(times, { from: 12, to: 18 })).toEqual({ start: 1, end: 2 });
    expect(visibleRange(times, { from: 18, to: 22 })).toEqual({ start: 1, end: 2 });
    expect(visibleRange(times, { from: -10, to: -5 })).toEqual({ start: 0, end: 1 });
    expect(visibleRange(times, { from: 50, to: 60 })).toEqual({ start: 3, end: 4 });
  });

  it('propriété : toujours au moins deux points valides, et tous ceux de la fenêtre', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 0, max: 10_000 }), { minLength: 2, maxLength: 60 }),
        fc.integer({ min: -1_000, max: 11_000 }),
        fc.integer({ min: 0, max: 5_000 }),
        (raw, from, span) => {
          const sorted = [...raw].sort((a, b) => a - b);
          const view = { from, to: from + span };
          const { start, end } = visibleRange(sorted, view);
          expect(start).toBeGreaterThanOrEqual(0);
          expect(end).toBeLessThan(sorted.length);
          expect(end - start + 1).toBeGreaterThanOrEqual(2);
          const inside = sorted.filter((t) => t >= view.from && t <= view.to).length;
          if (inside >= 2) expect(end - start + 1).toBe(inside);
        },
      ),
    );
  });

  it('propriété : zoomer puis se déplacer reste toujours dans la série', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1000 }),
        fc.double({ min: 0.05, max: 20, noNaN: true }),
        fc.integer({ min: -2000, max: 2000 }),
        (anchor, factor, delta) => {
          const zoomed = zoomWindow(full, full, anchor, factor, 5);
          const moved = panWindow(zoomed, full, delta);
          for (const w of [zoomed, moved]) {
            expect(w.from).toBeGreaterThanOrEqual(full.from);
            expect(w.to).toBeLessThanOrEqual(full.to);
            expect(w.to - w.from).toBeGreaterThanOrEqual(5 - 1e-9);
          }
        },
      ),
    );
  });
});
