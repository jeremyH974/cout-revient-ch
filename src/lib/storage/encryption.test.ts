/**
 * La sauvegarde chiffrée : ce qu'elle protège, et ce qu'elle continue d'ouvrir (décision n° 151).
 *
 * Deux exigences tirent dans des sens opposés, et ce fichier surveille les deux :
 *
 * 1. **Les nouvelles sauvegardes sont en Argon2id** — c'est le fichier qui voyage, et il gardait le
 *    KDF le plus faible pendant que le coffre, qui ne quitte jamais la machine, avait le plus fort.
 * 2. **Les anciennes s'ouvrent toujours.** Une sauvegarde chiffrée est une assurance : elle ne vaut
 *    que si elle s'ouvre le jour où tout le reste a disparu. Un fichier de version 1 gelé ici le
 *    prouve à chaque exécution.
 */
import { describe, expect, it } from 'vitest';
import {
  BACKUP_KDF_ITERATIONS,
  decryptBackup,
  encryptBackup,
  isEncryptedBackup,
  type EncryptedBackup,
  type EncryptedBackupV1,
} from './encryption';
import { KDF_PARAMS } from './kdf';

/** Paramètres réduits pour des tests rapides ; `KDF_PARAMS` (défaut réel) est vérifié plus bas. */
const FAST = { params: { m: 64, t: 1, p: 1 } };

/** Modifie le premier caractère (jamais un remplissage `=`) : altère toujours les octets décodés. */
function flipFirstChar(base64: string): string {
  const flipped = base64[0] === 'A' ? 'B' : 'A';
  return flipped + base64.slice(1);
}

describe('encryption', () => {
  it("aller-retour : déchiffre exactement le JSON d'origine", async () => {
    const json = JSON.stringify({ hello: 'monde', n: 42 });
    const backup = await encryptBackup(json, 'phrase secrète robuste', FAST);
    expect(isEncryptedBackup(backup)).toBe(true);
    expect(await decryptBackup(backup, 'phrase secrète robuste')).toBe(json);
  });

  it('phrase secrète incorrecte : rejette avec le message dédié', async () => {
    const backup = await encryptBackup('{"a":1}', 'bonne phrase', FAST);
    await expect(decryptBackup(backup, 'mauvaise phrase')).rejects.toThrow(
      'Phrase secrète incorrecte ou fichier altéré.',
    );
  });

  it('ciphertext altéré : rejette (AES-GCM authentifié)', async () => {
    const backup = await encryptBackup('{"a":1}', 'phrase', FAST);
    const tampered: EncryptedBackup = { ...backup, ciphertext: flipFirstChar(backup.ciphertext) };
    await expect(decryptBackup(tampered, 'phrase')).rejects.toThrow(
      'Phrase secrète incorrecte ou fichier altéré.',
    );
  });

  it('IV altéré : rejette', async () => {
    const backup = await encryptBackup('{"a":1}', 'phrase', FAST);
    const tampered: EncryptedBackup = { ...backup, iv: flipFirstChar(backup.iv) };
    await expect(decryptBackup(tampered, 'phrase')).rejects.toThrow(
      'Phrase secrète incorrecte ou fichier altéré.',
    );
  });

  /**
   * Les paramètres voyagent en clair, donc rien n'empêche de les truquer. Ils sont couverts par
   * l'authentification de fait : changer `m` change la clé dérivée, donc AES-GCM échoue.
   */
  it('paramètres du KDF altérés : rejette, la clé dérivée n’étant plus la même', async () => {
    const backup = await encryptBackup('{"a":1}', 'phrase', FAST);
    const tampered: EncryptedBackup = { ...backup, params: { ...backup.params, m: 128 } };
    await expect(decryptBackup(tampered, 'phrase')).rejects.toThrow(
      'Phrase secrète incorrecte ou fichier altéré.',
    );
  });

  it('deux chiffrements du même texte diffèrent (sel et IV aléatoires à chaque appel)', async () => {
    const a = await encryptBackup('{"a":1}', 'phrase', FAST);
    const b = await encryptBackup('{"a":1}', 'phrase', FAST);
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('phrase secrète vide : rejetée au chiffrement et au déchiffrement', async () => {
    await expect(encryptBackup('{"a":1}', '', FAST)).rejects.toThrow();
    const backup = await encryptBackup('{"a":1}', 'phrase', FAST);
    await expect(decryptBackup(backup, '')).rejects.toThrow(
      'Phrase secrète incorrecte ou fichier altéré.',
    );
  });

  it('isEncryptedBackup : accepte une sauvegarde valide, rejette champ manquant / mauvaise app / mauvais indicateur', async () => {
    const backup = await encryptBackup('{"a":1}', 'phrase', FAST);
    expect(isEncryptedBackup(backup)).toBe(true);
    expect(isEncryptedBackup(null)).toBe(false);
    expect(isEncryptedBackup(undefined)).toBe(false);
    expect(isEncryptedBackup({})).toBe(false);
    expect(isEncryptedBackup('{"a":1}')).toBe(false);

    const { salt: _salt, ...missingSalt } = backup;
    void _salt;
    expect(isEncryptedBackup(missingSalt)).toBe(false);
    expect(isEncryptedBackup({ ...backup, app: 'autre-app' })).toBe(false);
    expect(isEncryptedBackup({ ...backup, encrypted: false })).toBe(false);
    expect(isEncryptedBackup({ ...backup, version: 3 })).toBe(false);
    expect(isEncryptedBackup({ ...backup, kdf: 'PBKDF2' })).toBe(false);
    const { params: _params, ...missingParams } = backup;
    void _params;
    expect(isEncryptedBackup(missingParams)).toBe(false);
    expect(isEncryptedBackup({ ...backup, params: { m: 1, t: 1 } })).toBe(false);
  });
});

describe('Argon2id par défaut', () => {
  it('écrit une version 2, jamais une version 1', async () => {
    const backup = await encryptBackup('{"a":1}', 'phrase', FAST);
    expect(backup.version).toBe(2);
    expect(backup.kdf).toBe('argon2id');
  });

  /**
   * Les paramètres par défaut sont ceux du coffre, et le test l'exige : les laisser diverger
   * referait exactement le défaut que cette décision corrige — deux forces pour la même menace.
   */
  it('emploie les mêmes paramètres que le coffre du navigateur', async () => {
    const backup = await encryptBackup('{"a":1}', 'phrase');
    expect(backup.params).toEqual(KDF_PARAMS);
    expect(KDF_PARAMS.m).toBeGreaterThanOrEqual(19_456); // plancher OWASP pour Argon2id
    expect(KDF_PARAMS.t).toBeGreaterThanOrEqual(1);
  }, 30_000);

  it('écrit un sel de 128 bits, comme la RFC 9106 le demande', async () => {
    const backup = await encryptBackup('{"a":1}', 'phrase', FAST);
    expect(atob(backup.salt).length).toBe(16);
  });
});

describe('les sauvegardes de version 1 restent lisibles', () => {
  /**
   * Fichier **gelé**, produit par la version PBKDF2 du code et conservé tel quel : il n'est pas
   * régénéré par les tests, sans quoi il ne prouverait plus rien le jour où l'écriture de la v1
   * disparaîtrait. Son contenu clair est `{"gele":"v1"}`, sa phrase `phrase de test`, et ses
   * itérations sont volontairement basses pour que le test reste rapide.
   */
  const FROZEN_V1: EncryptedBackupV1 = {
    app: 'cout-revient-ch',
    encrypted: true,
    version: 1,
    kdf: 'PBKDF2',
    hash: 'SHA-256',
    iterations: 1000,
    salt: '23H0q7y6qE9Lpqvo8MvO+A==',
    iv: 'RcIe0oJdawvNWv4Z',
    ciphertext: 'i9Pu7vZM37exL21Q3x/HE9NUsuvzzqPXk6bInyE=',
    exportedAt: '2026-01-15T08:00:00.000Z',
  };

  it('la garde runtime reconnaît une version 1', () => {
    expect(isEncryptedBackup(FROZEN_V1)).toBe(true);
  });

  it('le fichier gelé se déchiffre avec ses propres itérations', async () => {
    expect(await decryptBackup(FROZEN_V1, 'phrase de test')).toBe('{"gele":"v1"}');
  });

  it('une mauvaise phrase sur un fichier de version 1 échoue comme les autres', async () => {
    await expect(decryptBackup(FROZEN_V1, 'mauvaise')).rejects.toThrow(
      'Phrase secrète incorrecte ou fichier altéré.',
    );
  });

  it('BACKUP_KDF_ITERATIONS reste la valeur avec laquelle la version 1 fut écrite', () => {
    expect(BACKUP_KDF_ITERATIONS).toBeGreaterThanOrEqual(600_000);
  });
});
