import { describe, expect, it } from 'vitest';
import {
  VAULT_KDF,
  VAULT_LOCKED_ERROR,
  createVault,
  decodeSealed,
  encodeSealed,
  isSealedBlob,
  isVaultMeta,
  looksSealed,
  rewrapVault,
  seal,
  unlockVault,
  unseal,
  type VaultKdfParams,
} from './vault';

/**
 * Coût volontairement dérisoire : ces tests éprouvent la *mécanique* du coffre, pas la solidité
 * d'Argon2id, qui est celle de la primitive et non la nôtre. Le vrai coût est fixé par `VAULT_KDF`,
 * et un test dédié en vérifie la valeur — c'est le seul endroit où elle compte.
 */
const FAST: VaultKdfParams = { m: 256, t: 1, p: 1 };

const ETAT = JSON.stringify({ positions: [{ asset: 'BTC', qty: '0.5' }], secret: 'très privé' });

describe('coffre — aller-retour', () => {
  it('scelle puis rouvre le même texte', async () => {
    const { meta, key } = await createVault('mot de passe correct', { params: FAST });
    const blob = await seal(key, ETAT);
    expect(await unseal(key, blob)).toBe(ETAT);

    // Rouvert depuis l'en-tête seul, comme au démarrage d'une session.
    const reopened = await unlockVault(meta, 'mot de passe correct');
    expect(await unseal(reopened, blob)).toBe(ETAT);
  });

  it("ne laisse pas l'état en clair dans le bloc scellé", async () => {
    const { key } = await createVault('mot de passe correct', { params: FAST });
    const blob = await seal(key, ETAT);
    expect(new TextDecoder().decode(blob.ct)).not.toContain('très privé');
    expect(new TextDecoder().decode(blob.ct)).not.toContain('BTC');
  });

  it('donne deux chiffrés différents pour le même texte (vecteur neuf à chaque scellement)', async () => {
    const { key } = await createVault('mot de passe correct', { params: FAST });
    const a = await seal(key, ETAT);
    const b = await seal(key, ETAT);
    expect(encodeSealed(a)).not.toBe(encodeSealed(b));
    expect(await unseal(key, b)).toBe(ETAT);
  });
});

describe('coffre — refus', () => {
  it('refuse un mauvais mot de passe', async () => {
    const { meta } = await createVault('le bon', { params: FAST });
    await expect(unlockVault(meta, 'le mauvais')).rejects.toThrow(VAULT_LOCKED_ERROR);
  });

  it('refuse un mot de passe vide à la création, bruyamment', async () => {
    await expect(createVault('', { params: FAST })).rejects.toThrow(/ne peut pas être vide/);
  });

  it("traite un mot de passe vide à l'ouverture comme une tentative incorrecte", async () => {
    const { meta } = await createVault('le bon', { params: FAST });
    await expect(unlockVault(meta, '')).rejects.toThrow(VAULT_LOCKED_ERROR);
  });

  it('refuse un bloc dont un seul octet a bougé (chiffrement authentifié)', async () => {
    const { key } = await createVault('le bon', { params: FAST });
    const blob = await seal(key, ETAT);
    const altered = { ...blob, ct: Uint8Array.from(blob.ct) };
    altered.ct[0] = (altered.ct[0]! + 1) % 256;
    await expect(unseal(key, altered)).rejects.toThrow(VAULT_LOCKED_ERROR);
  });

  it("refuse un en-tête dont la clé scellée a bougé, sans distinguer le cas d'un mauvais mot de passe", async () => {
    const { meta } = await createVault('le bon', { params: FAST });
    const tampered = { ...meta, wrappedKey: `A${meta.wrappedKey.slice(1)}` };
    await expect(unlockVault(tampered, 'le bon')).rejects.toThrow(VAULT_LOCKED_ERROR);
  });

  it("refuse un en-tête dont le sel n'est pas du base64", async () => {
    const { meta } = await createVault('le bon', { params: FAST });
    await expect(unlockVault({ ...meta, salt: '!!!' }, 'le bon')).rejects.toThrow(
      VAULT_LOCKED_ERROR,
    );
  });

  it('ne rend pas la clé de données exportable', async () => {
    const { key } = await createVault('le bon', { params: FAST });
    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow();
  });
});

describe('coffre — changement de mot de passe', () => {
  it("garde lisibles les données scellées AVANT le changement (c'est tout l'intérêt de l'enveloppe)", async () => {
    const { meta, key } = await createVault('ancien', { params: FAST });
    const blob = await seal(key, ETAT);

    const next = await rewrapVault(meta, 'ancien', 'nouveau', { params: FAST });
    const reopened = await unlockVault(next, 'nouveau');

    // Le bloc n'a pas été réécrit : c'est la MÊME clé de données qui le rouvre.
    expect(await unseal(reopened, blob)).toBe(ETAT);
  });

  it("ferme la porte à l'ancien mot de passe", async () => {
    const { meta } = await createVault('ancien', { params: FAST });
    const next = await rewrapVault(meta, 'ancien', 'nouveau', { params: FAST });
    await expect(unlockVault(next, 'ancien')).rejects.toThrow(VAULT_LOCKED_ERROR);
  });

  it('refuse de changer sans le mot de passe courant', async () => {
    const { meta } = await createVault('ancien', { params: FAST });
    await expect(rewrapVault(meta, 'pas le bon', 'nouveau', { params: FAST })).rejects.toThrow(
      VAULT_LOCKED_ERROR,
    );
  });

  it('retire un sel et un vecteur neufs', async () => {
    const { meta } = await createVault('ancien', { params: FAST });
    const next = await rewrapVault(meta, 'ancien', 'nouveau', { params: FAST });
    expect(next.salt).not.toBe(meta.salt);
    expect(next.wrapIv).not.toBe(meta.wrapIv);
    expect(next.wrappedKey).not.toBe(meta.wrappedKey);
  });
});

describe('coffre — paramètres relevables', () => {
  it("ouvre un coffre ancien avec SES paramètres, pas avec ceux d'aujourd'hui", async () => {
    const faible: VaultKdfParams = { m: 128, t: 1, p: 1 };
    const { meta, key } = await createVault('le bon', { params: faible });
    const blob = await seal(key, ETAT);

    expect(meta.params).toEqual(faible);
    // Aucun paramètre n'est passé : `unlockVault` doit lire ceux de l'en-tête.
    const reopened = await unlockVault(meta, 'le bon');
    expect(await unseal(reopened, blob)).toBe(ETAT);
  });

  it('relève les paramètres au changement de mot de passe quand on le demande', async () => {
    const { meta } = await createVault('ancien', { params: { m: 128, t: 1, p: 1 } });
    const next = await rewrapVault(meta, 'ancien', 'nouveau', { params: { m: 512, t: 2, p: 1 } });
    expect(next.params).toEqual({ m: 512, t: 2, p: 1 });
    await expect(unlockVault(next, 'nouveau')).resolves.toBeDefined();
  });

  it('annonce le coût que la fiche OWASP recommande pour Argon2id', () => {
    // 46 Mio, une itération, une voie : première ligne du tableau OWASP « Password Storage ».
    // Le parallélisme reste à 1 parce que la dérivation est mono-fil ici (voir `vault.ts`).
    expect(VAULT_KDF).toEqual({ m: 47_104, t: 1, p: 1 });
    expect(VAULT_KDF.m).toBeGreaterThanOrEqual(19_456);
  });
});

describe('coffre — forme texte du miroir', () => {
  it('fait un aller-retour par le miroir localStorage', async () => {
    const { key } = await createVault('le bon', { params: FAST });
    const blob = await seal(key, ETAT);
    const decoded = decodeSealed(encodeSealed(blob));
    expect(decoded).not.toBeNull();
    expect(await unseal(key, decoded!)).toBe(ETAT);
  });

  it('reconnaît un miroir scellé sans avoir la clé, et ne confond pas du JSON en clair', () => {
    expect(looksSealed('crch-sealed.1.AAAA.BBBB')).toBe(true);
    expect(looksSealed('{"imports":[]}')).toBe(false);
    expect(decodeSealed('{"imports":[]}')).toBeNull();
  });

  it('rejette une forme texte tronquée plutôt que de rendre un bloc bancal', () => {
    expect(decodeSealed('crch-sealed.1.AAAA')).toBeNull();
    expect(decodeSealed('crch-sealed.1.AAAA.BBBB.CCCC')).toBeNull();
    expect(decodeSealed('crch-sealed.1.!!!.BBBB')).toBeNull();
  });
});

describe('coffre — gardes runtime', () => {
  it('accepte un en-tête réel', async () => {
    const { meta } = await createVault('le bon', { params: FAST });
    expect(isVaultMeta(meta)).toBe(true);
    expect(isVaultMeta(JSON.parse(JSON.stringify(meta)))).toBe(true);
  });

  it('rejette tout en-tête auquel il manque une pièce', async () => {
    const { meta } = await createVault('le bon', { params: FAST });
    for (const champ of [
      'app',
      'vault',
      'version',
      'kdf',
      'params',
      'salt',
      'wrappedKey',
      'wrapIv',
      'createdAt',
      'rewrappedAt',
    ] as const) {
      const reste: Record<string, unknown> = { ...meta };
      delete reste[champ];
      expect(isVaultMeta(reste), `sans « ${champ} »`).toBe(false);
    }
    expect(isVaultMeta(null)).toBe(false);
    expect(isVaultMeta('crch')).toBe(false);
    expect(isVaultMeta({ ...meta, params: { m: '47104', t: 1, p: 1 } })).toBe(false);
  });

  it('rejette un bloc scellé dont les octets ne sont pas des octets', async () => {
    const { key } = await createVault('le bon', { params: FAST });
    const blob = await seal(key, ETAT);
    expect(isSealedBlob(blob)).toBe(true);
    expect(isSealedBlob({ ...blob, ct: [1, 2, 3] })).toBe(false);
    expect(isSealedBlob({ ...blob, v: 2 })).toBe(false);
    expect(isSealedBlob(null)).toBe(false);
  });
});
