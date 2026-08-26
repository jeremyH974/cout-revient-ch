import { describe, expect, it, vi } from 'vitest';
import { FEAR_GREED_URL, loadFearGreed, parseFearGreed } from './fear-greed';

const payload = (over: Record<string, unknown> = {}) => ({
  name: 'Fear and Greed Index',
  data: [
    {
      value: '31',
      value_classification: 'Fear',
      timestamp: '1787356800',
      time_until_update: '3600',
      ...over,
    },
  ],
});

describe('parseFearGreed', () => {
  it('lit la valeur, la bande et le jour (horodatage en secondes)', () => {
    const point = parseFearGreed(payload())!;
    expect(point.value).toBe(31);
    expect(point.band).toBe('fear');
    expect(point.rawLabel).toBe('Fear');
    expect(point.day).toBe(new Date(1_787_356_800 * 1000).toISOString().slice(0, 10));
  });

  it('déduit la bande de la valeur quand le libellé de la source change', () => {
    expect(parseFearGreed(payload({ value: '10', value_classification: 'Panique' }))!.band).toBe(
      'extreme-fear',
    );
    expect(parseFearGreed(payload({ value: '50', value_classification: '' }))!.band).toBe(
      'neutral',
    );
    expect(parseFearGreed(payload({ value: '90', value_classification: 'Euphorie' }))!.band).toBe(
      'extreme-greed',
    );
  });

  it('fait confiance au libellé de la source quand il est connu', () => {
    // La source est l'autorité : si elle dit « Greed » à 10, on n'invente pas mieux qu'elle.
    expect(parseFearGreed(payload({ value: '10', value_classification: 'Greed' }))!.band).toBe(
      'greed',
    );
  });

  it('respecte les bornes publiées de chaque bande, à défaut de libellé', () => {
    const bandAt = (value: number) =>
      parseFearGreed(payload({ value: String(value), value_classification: '' }))!.band;
    expect(bandAt(24)).toBe('extreme-fear');
    expect(bandAt(25)).toBe('fear');
    expect(bandAt(44)).toBe('fear');
    expect(bandAt(45)).toBe('neutral');
    expect(bandAt(55)).toBe('neutral');
    expect(bandAt(56)).toBe('greed');
    expect(bandAt(75)).toBe('greed');
    expect(bandAt(76)).toBe('extreme-greed');
  });

  it('refuse tout ce qui n’a pas la forme attendue', () => {
    expect(parseFearGreed(null)).toBeNull();
    expect(parseFearGreed({})).toBeNull();
    expect(parseFearGreed({ data: [] })).toBeNull();
    expect(parseFearGreed(payload({ value: 'beaucoup' }))).toBeNull();
    // Hors de l'échelle publiée : la source a changé de contrat, on n'affiche rien.
    expect(parseFearGreed(payload({ value: '140' }))).toBeNull();
    expect(parseFearGreed(payload({ timestamp: '0' }))).toBeNull();
  });
});

describe('loadFearGreed', () => {
  it('appelle l’API sans clé et rend le point validé', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => payload() });
    const point = await loadFearGreed({ fetch: fetchMock as unknown as typeof fetch });
    expect(point?.value).toBe(31);
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url.startsWith(FEAR_GREED_URL)).toBe(true);
    // Aucune clé, aucun identifiant : la source est publique et le reste.
    expect(url).not.toMatch(/key|token|api[-_]?key/i);
  });

  it('rend null plutôt que de propager une panne : le contexte est facultatif', async () => {
    const failing = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    expect(await loadFearGreed({ fetch: failing as unknown as typeof fetch })).toBeNull();
    const throwing = vi.fn().mockRejectedValue(new Error('offline'));
    expect(await loadFearGreed({ fetch: throwing as unknown as typeof fetch })).toBeNull();
  });
});
