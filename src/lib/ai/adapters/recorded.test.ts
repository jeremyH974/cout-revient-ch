import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildRequest } from '../contract';
import {
  CASSETTE_SOURCES,
  MissingCassette,
  cassetteKey,
  parseCassette,
  recordedAdapter,
  type Cassette,
} from './recorded';

const SOURCE = readFileSync(fileURLToPath(new URL('./recorded.ts', import.meta.url)), 'utf8');

const request = buildRequest('narrative', { amount: '1284.37' });
const cassette = (over: Partial<Cassette> = {}): Cassette => ({
  hash: cassetteKey(request, 'essai-1'),
  modelId: 'essai-1',
  capturedAt: '2026-08-30T09:00:00',
  source: 'handwritten',
  text: 'Vos frais s’élèvent à 1 284,37 €.',
  ...over,
});

describe('la clé de cassette', () => {
  it('est un sha256 hexadécimal, stable d’un appel à l’autre', () => {
    const key = cassetteKey(request, 'essai-1');
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(cassetteKey(request, 'essai-1')).toBe(key);
  });

  it('change avec la consigne, avec l’entrée et avec le modèle', () => {
    const key = cassetteKey(request, 'essai-1');
    expect(cassetteKey({ ...request, system: 'autre' }, 'essai-1')).not.toBe(key);
    expect(cassetteKey({ ...request, user: '{"amount":"1"}' }, 'essai-1')).not.toBe(key);
    expect(cassetteKey(request, 'essai-2')).not.toBe(key);
  });
});

describe('parseCassette — la provenance est obligatoire', () => {
  it('accepte les deux seules provenances admises', () => {
    for (const source of CASSETTE_SOURCES) {
      expect(parseCassette(cassette({ source })).source).toBe(source);
    }
  });

  it('refuse toute autre provenance', () => {
    // La porte par laquelle une capture sur données réelles entrerait sans qu'on la voie.
    expect(() => parseCassette({ ...cassette(), source: 'production' })).toThrow(/provenance/);
    expect(() => parseCassette({ ...cassette(), source: undefined })).toThrow(/provenance/);
  });

  it('refuse une cassette mal formée plutôt que de la deviner', () => {
    expect(() => parseCassette('texte')).toThrow(/objet JSON/);
    expect(() => parseCassette({ ...cassette(), hash: 'court' })).toThrow(/sha256/);
    expect(() => parseCassette({ ...cassette(), capturedAt: '30/08/2026' })).toThrow(/date naïve/);
    expect(() => parseCassette({ ...cassette(), text: '   ' })).toThrow(/vide/);
    expect(() => parseCassette({ ...cassette(), modelId: '' })).toThrow(/modelId/);
  });
});

describe('recordedAdapter — hors ligne, sans repli', () => {
  const adapter = recordedAdapter('essai-1', new Map([[cassette().hash, cassette()]]));

  it('rejoue le texte enregistré', async () => {
    const reply = await adapter.complete(request);
    expect(reply.modelId).toBe('essai-1');
    expect(reply.text).toContain('1 284,37');
  });

  it('lève une exception quand la cassette manque — jamais un repli réseau', async () => {
    await expect(
      adapter.complete(buildRequest('narrative', { amount: '2' })),
    ).rejects.toBeInstanceOf(MissingCassette);
  });

  it('ne contient aucun chemin réseau, et c’est vérifié sur le texte du module', () => {
    // Une promesse de documentation ne prouve rien ; l'absence de ces mots, si.
    for (const forbidden of ['fetch(', 'XMLHttpRequest', 'http://', 'https://', 'WebSocket']) {
      expect(SOURCE.includes(forbidden), forbidden).toBe(false);
    }
  });
});
