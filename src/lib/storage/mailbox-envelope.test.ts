/**
 * L'enveloppe v3 : aller-retour, AAD sur l'en-tête entier, cache de clés par sel, et la garantie
 * que rien ici ne dérange l'enveloppe v2 (`encryption.ts`), volontairement non importée en dehors
 * d'un seul test de coexistence ci-dessous.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decryptBackup, encryptBackup } from './encryption';
import * as kdf from './kdf';
import {
  decryptMailboxEnvelope,
  encryptMailboxEnvelope,
  readMailboxHeader,
  resetMailboxKeyCacheForTests,
  type MailboxEnvelopeV3,
} from './mailbox-envelope';

/** Paramètres réduits pour des tests rapides (même patron que encryption.test.ts). */
const FAST = { params: { m: 64, t: 1, p: 1 } };

const WRONG_PASSPHRASE = 'Phrase secrète incorrecte ou fichier altéré.';

const salt = (): Uint8Array<ArrayBuffer> => crypto.getRandomValues(new Uint8Array(16));

beforeEach(() => resetMailboxKeyCacheForTests());

describe('enveloppe v3 : aller-retour', () => {
  it('déchiffre exactement le JSON d’origine', async () => {
    const json = JSON.stringify({ hello: 'monde', n: 42 });
    const envelope = await encryptMailboxEnvelope(json, 'phrase', 'device-a', 1, salt(), FAST);
    expect(envelope.app).toBe('cout-revient-ch');
    expect(envelope.kind).toBe('mailbox');
    expect(envelope.version).toBe(3);
    expect(envelope.compression).toBe('gzip');
    expect(await decryptMailboxEnvelope(envelope, 'phrase')).toBe(json);
  });

  it('deux écritures du même contenu, même sel : IV et texte chiffré diffèrent, le sel non', async () => {
    const s = salt();
    const a = await encryptMailboxEnvelope('{"a":1}', 'phrase', 'device-a', 1, s, FAST);
    const b = await encryptMailboxEnvelope('{"a":1}', 'phrase', 'device-a', 2, s, FAST);
    expect(a.salt).toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('phrase secrète vide : rejetée au chiffrement et au déchiffrement', async () => {
    await expect(
      encryptMailboxEnvelope('{"a":1}', '', 'device-a', 1, salt(), FAST),
    ).rejects.toThrow();
    const envelope = await encryptMailboxEnvelope('{"a":1}', 'phrase', 'device-a', 1, salt(), FAST);
    await expect(decryptMailboxEnvelope(envelope, '')).rejects.toThrow(WRONG_PASSPHRASE);
  });

  it('mauvaise phrase secrète : message unique, comme la v2', async () => {
    const envelope = await encryptMailboxEnvelope('{"a":1}', 'bonne', 'device-a', 1, salt(), FAST);
    await expect(decryptMailboxEnvelope(envelope, 'mauvaise')).rejects.toThrow(WRONG_PASSPHRASE);
  });

  it('ciphertext altéré : rejette (AES-GCM authentifié)', async () => {
    const envelope = await encryptMailboxEnvelope('{"a":1}', 'phrase', 'device-a', 1, salt(), FAST);
    const tampered: MailboxEnvelopeV3 = {
      ...envelope,
      ciphertext: `AA${envelope.ciphertext.slice(2)}`,
    };
    await expect(decryptMailboxEnvelope(tampered, 'phrase')).rejects.toThrow(WRONG_PASSPHRASE);
  });
});

/**
 * **La contre-épreuve de décision n° 75** : ces deux tests visent spécifiquement des champs qui
 * n'entrent PAS dans la dérivation de clé (`seq`, `device`, `writtenAt` — contrairement à `salt`
 * ou `params`, qui font déjà échouer le déchiffrement par simple mésappariement de clé, comme en
 * v2). S'ils passent, c'est donc bien l'AAD qui protège, pas un effet de bord de la dérivation.
 *
 * Vérifié manuellement pendant le développement : retirer `additionalData` des deux appels
 * `crypto.subtle.encrypt`/`decrypt` de `mailbox-envelope.ts` fait ROUGIR ces deux tests précisément
 * (`ciphertext altéré` reste vert, lui, puisqu'AES-GCM authentifie toujours le texte chiffré) — puis
 * la restauration de l'AAD les fait revenir au vert. Voir le rapport final pour le détail exact.
 */
describe('l’AAD couvre l’en-tête entier (contre-épreuve décision n° 75)', () => {
  it('`seq` changé après coup : rejette, alors que la clé dérivée est inchangée', async () => {
    const envelope = await encryptMailboxEnvelope('{"a":1}', 'phrase', 'device-a', 1, salt(), FAST);
    const tampered: MailboxEnvelopeV3 = { ...envelope, seq: envelope.seq + 1 };
    await expect(decryptMailboxEnvelope(tampered, 'phrase')).rejects.toThrow(WRONG_PASSPHRASE);
  });

  it('`device` changé après coup : rejette, alors que la clé dérivée est inchangée', async () => {
    const envelope = await encryptMailboxEnvelope('{"a":1}', 'phrase', 'device-a', 1, salt(), FAST);
    const tampered: MailboxEnvelopeV3 = { ...envelope, device: `${envelope.device}-truque` };
    await expect(decryptMailboxEnvelope(tampered, 'phrase')).rejects.toThrow(WRONG_PASSPHRASE);
  });

  it('`writtenAt` changé après coup : rejette', async () => {
    const envelope = await encryptMailboxEnvelope('{"a":1}', 'phrase', 'device-a', 1, salt(), FAST);
    const tampered: MailboxEnvelopeV3 = { ...envelope, writtenAt: '2020-01-01T00:00:00.000Z' };
    await expect(decryptMailboxEnvelope(tampered, 'phrase')).rejects.toThrow(WRONG_PASSPHRASE);
  });
});

describe('cache de clés par sel (mémoire de session)', () => {
  it('Argon2id n’est dérivé qu’une fois par sel rencontré, jamais une fois par fichier', async () => {
    const spy = vi.spyOn(kdf, 'deriveAesKey');
    try {
      const saltA = salt();
      const saltB = salt();

      await encryptMailboxEnvelope('{"a":1}', 'phrase', 'device-a', 1, saltA, FAST);
      await encryptMailboxEnvelope('{"a":2}', 'phrase', 'device-a', 2, saltA, FAST); // même sel
      expect(spy).toHaveBeenCalledTimes(1);

      await encryptMailboxEnvelope('{"a":3}', 'phrase', 'device-b', 1, saltB, FAST); // sel différent
      expect(spy).toHaveBeenCalledTimes(2);

      const third = await encryptMailboxEnvelope('{"a":4}', 'phrase', 'device-a', 3, saltA, FAST);
      expect(spy).toHaveBeenCalledTimes(2); // toujours le sel A : pas de 3e dérivation

      await decryptMailboxEnvelope(third, 'phrase'); // lecture : le sel A est déjà en cache
      expect(spy).toHaveBeenCalledTimes(2);
    } finally {
      spy.mockRestore();
    }
  });

  it('même sel et même phrase sous d’autres paramètres : redérive, jamais la clé d’avant', async () => {
    const spy = vi.spyOn(kdf, 'deriveAesKey');
    try {
      const s = salt();
      await encryptMailboxEnvelope('{"a":1}', 'phrase', 'device-a', 1, s, FAST);
      const other = await encryptMailboxEnvelope('{"a":2}', 'phrase', 'device-a', 2, s, {
        params: { m: 128, t: 1, p: 1 },
      });
      expect(spy).toHaveBeenCalledTimes(2);
      expect(await decryptMailboxEnvelope(other, 'phrase')).toBe('{"a":2}');
    } finally {
      spy.mockRestore();
    }
  });

  it('resetMailboxKeyCacheForTests() vide bien le cache : un sel déjà vu redérive', async () => {
    const spy = vi.spyOn(kdf, 'deriveAesKey');
    try {
      const s = salt();
      await encryptMailboxEnvelope('{"a":1}', 'phrase', 'device-a', 1, s, FAST);
      expect(spy).toHaveBeenCalledTimes(1);
      resetMailboxKeyCacheForTests();
      await encryptMailboxEnvelope('{"a":2}', 'phrase', 'device-a', 2, s, FAST);
      expect(spy).toHaveBeenCalledTimes(2);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('readMailboxHeader : valide la forme, sans déchiffrer', () => {
  it('accepte une enveloppe valide et en fait le miroir exact', async () => {
    const envelope = await encryptMailboxEnvelope('{"a":1}', 'phrase', 'device-a', 7, salt(), FAST);
    const result = readMailboxHeader(JSON.stringify(envelope));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.envelope).toEqual(envelope);
  });

  it('paramètres Argon2id démesurés : refusés avant toute dérivation (le PC relit ces fichiers)', async () => {
    const envelope = await encryptMailboxEnvelope('{"a":1}', 'phrase', 'device-a', 7, salt(), FAST);
    for (const params of [
      { m: 4_194_304, t: 1, p: 1 }, // 4 Gio : figerait l'onglet
      { m: 64, t: 1_000, p: 1 },
      { m: 64, t: 1, p: 64 },
      { m: 64, t: 1.5, p: 1 },
      { m: 4, t: 1, p: 1 }, // sous le minimum d'Argon2
    ]) {
      const result = readMailboxHeader(JSON.stringify({ ...envelope, params }));
      expect(result, JSON.stringify(params)).toEqual({ ok: false, error: { code: 'malformed' } });
    }
  });

  it('JSON invalide', () => {
    const result = readMailboxHeader('{ pas du json');
    expect(result).toEqual({ ok: false, error: { code: 'invalid-json' } });
  });

  it('autre application', () => {
    const result = readMailboxHeader(JSON.stringify({ app: 'autre-app' }));
    expect(result).toEqual({ ok: false, error: { code: 'wrong-app', app: 'autre-app' } });
  });

  it('version non reconnue', () => {
    const result = readMailboxHeader(
      JSON.stringify({ app: 'cout-revient-ch', kind: 'mailbox', version: 4 }),
    );
    expect(result).toEqual({ ok: false, error: { code: 'unsupported-version', version: 4 } });
  });

  it.each([
    ['device manquant', { device: undefined }],
    ['seq non entier', { seq: 1.5 }],
    ['params incomplets', { params: { m: 1, t: 1 } }],
    ['compression inconnue', { compression: 'brotli' }],
  ])('en-tête malformé : %s', async (_label, patch) => {
    const envelope = await encryptMailboxEnvelope('{"a":1}', 'phrase', 'device-a', 1, salt(), FAST);
    const broken = { ...envelope, ...patch };
    expect(readMailboxHeader(JSON.stringify(broken))).toEqual({
      ok: false,
      error: { code: 'malformed' },
    });
  });

  it('un objet nu sans les champs attendus est refusé, jamais accepté par accident', () => {
    expect(readMailboxHeader(JSON.stringify({}))).toEqual({
      ok: false,
      error: { code: 'wrong-app', app: undefined },
    });
    expect(readMailboxHeader('null')).toEqual({ ok: false, error: { code: 'malformed' } });
    expect(readMailboxHeader('42')).toEqual({ ok: false, error: { code: 'malformed' } });
  });
});

describe('coexistence avec l’enveloppe v2 de sauvegarde (encryption.ts, inchangée)', () => {
  it('une sauvegarde v2 se chiffre et se déchiffre normalement après l’ajout de la v3', async () => {
    const json = JSON.stringify({ etat: 'inchange' });
    const backup = await encryptBackup(json, 'phrase', FAST);
    expect(backup.version).toBe(2);
    expect(await decryptBackup(backup, 'phrase')).toBe(json);
  });
});
