import { describe, expect, it } from 'vitest';
import {
  BACKUP_KDF_ITERATIONS,
  decryptBackup,
  encryptBackup,
  isEncryptedBackup,
  type EncryptedBackup,
} from './encryption';

// Itérations réduites pour des tests rapides ; `BACKUP_KDF_ITERATIONS` (défaut réel) est vérifié
// séparément plus bas.
const FAST = { iterations: 1000 };

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

    const missingSalt: unknown = {
      app: backup.app,
      encrypted: backup.encrypted,
      version: backup.version,
      kdf: backup.kdf,
      hash: backup.hash,
      iterations: backup.iterations,
      iv: backup.iv,
      ciphertext: backup.ciphertext,
      exportedAt: backup.exportedAt,
    };
    expect(isEncryptedBackup(missingSalt)).toBe(false);
    expect(isEncryptedBackup({ ...backup, app: 'autre-app' })).toBe(false);
    expect(isEncryptedBackup({ ...backup, encrypted: false })).toBe(false);
  });

  it('BACKUP_KDF_ITERATIONS : au moins 600 000 (recommandation OWASP), utilisé par défaut', async () => {
    expect(BACKUP_KDF_ITERATIONS).toBeGreaterThanOrEqual(600_000);
    const backup = await encryptBackup('{"a":1}', 'phrase', {});
    expect(backup.iterations).toBe(BACKUP_KDF_ITERATIONS);
  });
});
