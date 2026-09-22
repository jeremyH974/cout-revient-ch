/**
 * Logique pure de la boîte aux lettres : nommage, et sélection à partir d'en-têtes déjà lus. Les
 * enveloppes utilisées ici sont FABRIQUÉES (pas de vrai chiffrement) : `selectPeerFiles` et
 * `ownFilesToPrune` ne lisent que la FORME de l'en-tête, jamais son contenu chiffré.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { MailboxEnvelopeV3 } from './mailbox-envelope';
import {
  mailboxFileName,
  ownFilesToPrune,
  selectPeerFiles,
  type MailboxFileEntry,
} from './mailbox';

function fakeEnvelope(device: string, seq: number): MailboxEnvelopeV3 {
  return {
    app: 'cout-revient-ch',
    kind: 'mailbox',
    version: 3,
    device,
    seq,
    writtenAt: new Date(2026, 0, 1, 0, 0, Math.max(0, seq)).toISOString(),
    kdf: 'argon2id',
    params: { m: 64, t: 1, p: 1 },
    salt: 'AAAA',
    iv: 'BBBB',
    compression: 'gzip',
    ciphertext: 'CCCC',
  };
}

function entry(name: string, device: string, seq: number, size = 100): MailboxFileEntry {
  return { name, size, header: { ok: true, envelope: fakeEnvelope(device, seq) } };
}

function unreadable(name: string, size = 0): MailboxFileEntry {
  return { name, size, header: { ok: false, error: { code: 'invalid-json' } } };
}

describe('mailboxFileName', () => {
  it('préfixe, 8 premiers caractères de l’appareil, seq sur 6 chiffres, extension .txt', () => {
    expect(mailboxFileName('550e8400-e29b-41d4-a716-446655440000', 7)).toBe(
      'cout-revient-ch-sync-550e8400-000007.txt',
    );
  });

  it('un seq à plus de 6 chiffres ne tronque jamais (pas de perte silencieuse)', () => {
    expect(mailboxFileName('device', 1234567)).toBe('cout-revient-ch-sync-device-1234567.txt');
  });

  it('un identifiant d’appareil court n’est jamais complété', () => {
    expect(mailboxFileName('abc', 1)).toBe('cout-revient-ch-sync-abc-000001.txt');
  });
});

describe('selectPeerFiles : exemples', () => {
  it('garde le plus grand seq par appareil pair, ignore mon appareil et les fichiers illisibles', () => {
    const entries = [
      entry('a-1.txt', 'device-a', 1),
      entry('a-3.txt', 'device-a', 3),
      entry('a-2.txt', 'device-a', 2),
      entry('b-1.txt', 'device-b', 1),
      entry('mine-9.txt', 'device-mine', 9),
      unreadable('broken.txt'),
    ];
    expect(selectPeerFiles(entries, 'device-mine').map((e) => e.name)).toEqual([
      'a-3.txt',
      'b-1.txt',
    ]);
  });

  it('un fichier vide, illisible ou tronqué : rien de nouveau, jamais une erreur bloquante', () => {
    const entries = [unreadable('vide.txt', 0), entry('a-1.txt', 'device-a', 1)];
    expect(selectPeerFiles(entries, 'device-mine').map((e) => e.name)).toEqual(['a-1.txt']);
  });

  it('aucun pair : liste vide, sans lever', () => {
    expect(selectPeerFiles([entry('mine.txt', 'mine', 1)], 'mine')).toEqual([]);
    expect(selectPeerFiles([], 'mine')).toEqual([]);
  });
});

// --- Propriétés -----------------------------------------------------------------------------

interface Spec {
  device: string;
  seq: number;
}

const specArb: fc.Arbitrary<Spec> = fc.record({
  device: fc.constantFrom('device-a', 'device-b', 'device-c', 'mine'),
  seq: fc.integer({ min: 0, max: 50 }),
});
const specsArb = fc.array(specArb, { maxLength: 15 });

/** Noms toujours distincts (index en suffixe) : seuls `device`/`seq` peuvent se répéter. */
function toEntries(specs: readonly Spec[]): MailboxFileEntry[] {
  return specs.map((s, i) => entry(`${s.device}-${s.seq}-${i}.txt`, s.device, s.seq));
}

/** (appareil, seq) de chaque entrée sélectionnée — le nom exact n'est pas la propriété visée. */
function deviceSeqPairs(entries: readonly MailboxFileEntry[]): Array<[string, number]> {
  return entries.map((e) =>
    e.header.ok ? [e.header.envelope.device, e.header.envelope.seq] : ['?', -1],
  );
}

describe('selectPeerFiles : propriétés', () => {
  it('l’ordre de découverte ne change rien (inversion)', () => {
    fc.assert(
      fc.property(specsArb, (specs) => {
        const entries = toEntries(specs);
        const forward = deviceSeqPairs(selectPeerFiles(entries, 'mine'));
        const backward = deviceSeqPairs(selectPeerFiles([...entries].reverse(), 'mine'));
        expect(backward).toEqual(forward);
      }),
    );
  });

  it('l’ordre de découverte ne change rien (rotation)', () => {
    fc.assert(
      fc.property(specsArb, fc.nat(), (specs, k) => {
        const entries = toEntries(specs);
        const pivot = entries.length === 0 ? 0 : k % entries.length;
        const rotated = [...entries.slice(pivot), ...entries.slice(0, pivot)];
        expect(deviceSeqPairs(selectPeerFiles(rotated, 'mine'))).toEqual(
          deviceSeqPairs(selectPeerFiles(entries, 'mine')),
        );
      }),
    );
  });

  it('dupliquer le fichier gagnant sous un autre nom (copie de conflit) ne change pas la sélection', () => {
    fc.assert(
      fc.property(specsArb, fc.string({ minLength: 1, maxLength: 12 }), (specs, suffix) => {
        const entries = toEntries(specs);
        const before = selectPeerFiles(entries, 'mine');
        const winner = before[0];
        if (!winner || !winner.header.ok) return; // rien à dupliquer sur ce tirage
        const conflictCopy = entry(
          `${winner.name}.conflit-${suffix}`,
          winner.header.envelope.device,
          winner.header.envelope.seq,
        );
        const after = selectPeerFiles([...entries, conflictCopy], 'mine');
        expect(deviceSeqPairs(after)).toEqual(deviceSeqPairs(before));
      }),
    );
  });

  it('jamais mon propre appareil, jamais un doublon d’appareil dans le résultat', () => {
    fc.assert(
      fc.property(specsArb, (specs) => {
        const selected = selectPeerFiles(toEntries(specs), 'mine');
        for (const e of selected) expect(e.header.ok && e.header.envelope.device).not.toBe('mine');
        const seen = new Set(selected.map((e) => (e.header.ok ? e.header.envelope.device : '')));
        expect(seen.size).toBe(selected.length);
      }),
    );
  });
});

describe('ownFilesToPrune', () => {
  it('garde les `keep` plus récents, rend le reste', () => {
    const entries = [1, 2, 3, 4, 5].map((seq) => entry(`f-${seq}.txt`, 'mine', seq));
    const pruned = ownFilesToPrune(entries, 'mine', 2).map((e) => e.name);
    expect(pruned.sort()).toEqual(['f-1.txt', 'f-2.txt', 'f-3.txt']);
  });

  it('ne touche jamais un fichier illisible, même entouré de fichiers qui sont les miens', () => {
    const entries = [entry('a.txt', 'mine', 1), unreadable('b.txt')];
    expect(ownFilesToPrune(entries, 'mine', 0)).toEqual([entries[0]]);
  });

  it('ignore les fichiers des autres appareils', () => {
    const entries = [entry('a.txt', 'mine', 1), entry('b.txt', 'device-b', 99)];
    expect(ownFilesToPrune(entries, 'mine', 0).map((e) => e.name)).toEqual(['a.txt']);
  });

  it('propriété : renvoie exactement (mes fichiers lisibles − keep), jamais un fichier d’un autre appareil', () => {
    fc.assert(
      fc.property(specsArb, fc.integer({ min: 0, max: 5 }), (specs, keep) => {
        const entries = toEntries(specs);
        const pruned = ownFilesToPrune(entries, 'mine', keep);
        const mine = entries.filter((e) => e.header.ok && e.header.envelope.device === 'mine');
        expect(pruned.length).toBe(Math.max(0, mine.length - keep));
        for (const p of pruned) expect(p.header.ok && p.header.envelope.device).toBe('mine');
      }),
    );
  });
});
