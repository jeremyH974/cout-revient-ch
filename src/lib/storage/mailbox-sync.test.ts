/**
 * `syncMailbox` : un dossier FAUX (`FakeFolder`, en mémoire), donc aucune dépendance au navigateur.
 * Les scénarios à deux appareils utilisent un harnais minimal (`makeDevice`) bâti sur les MÊMES
 * fonctions pures que `AppState.exportBackup`/`restoreBackup('merge')` — `stampChanges`,
 * `mergeSynced`, `serializeBackup`, `parseBackup` — sans importer la classe Svelte elle-même.
 */
import fc from 'fast-check';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ManualEvent } from '../domain/types';
import {
  decryptMailboxEnvelope,
  encryptMailboxEnvelope,
  readMailboxHeader,
  resetMailboxKeyCacheForTests,
} from './mailbox-envelope';
import {
  buildMailboxDeposit,
  syncMailbox,
  type MailboxFolder,
  type MailboxSyncOptions,
} from './mailbox-sync';
import { parseBackup, serializeBackup } from './json-io';
import { emptyState, type StoredStateV1 } from './schema';
import { mergeSynced, type MergeReport } from './sync/merge';
import { stampChanges } from './sync/stamp';
import { emptySyncMeta, type SyncMeta } from './sync/types';

/** Paramètres Argon2id réduits (même patron que `mailbox-envelope.test.ts`) : tests rapides. */
const FAST = { m: 64, t: 1, p: 1 };
const salt = (): Uint8Array<ArrayBuffer> => crypto.getRandomValues(new Uint8Array(16));

beforeEach(() => resetMailboxKeyCacheForTests());

// --- Dossier factice --------------------------------------------------------------------------

class FakeFolder implements MailboxFolder {
  private files = new Map<string, string>();
  /** Noms qu'un `read` doit refuser (verrou simulé) : jamais de rejet, `null` — voir le contrat. */
  private locked = new Set<string>();

  seed(name: string, text: string): void {
    this.files.set(name, text);
  }
  lock(name: string): void {
    this.locked.add(name);
  }
  names(): string[] {
    return [...this.files.keys()];
  }
  contents(name: string): string | undefined {
    return this.files.get(name);
  }

  async list(): Promise<string[]> {
    return [...this.files.keys()];
  }
  async read(name: string): Promise<string | null> {
    if (this.locked.has(name)) return null;
    return this.files.get(name) ?? null;
  }
  async write(name: string, text: string): Promise<void> {
    this.files.set(name, text);
  }
  async remove(name: string): Promise<void> {
    if (this.locked.has(name)) throw new Error('verrouillé (simulation)');
    this.files.delete(name);
  }
}

/** Enveloppe v3 déjà chiffrée, prête à être déposée dans un `FakeFolder` par un test. */
async function envelopeText(
  json: string,
  passphrase: string,
  device: string,
  seq: number,
): Promise<string> {
  const envelope = await encryptMailboxEnvelope(json, passphrase, device, seq, salt(), {
    params: FAST,
  });
  return JSON.stringify(envelope);
}

// --- Harnais « appareil » ----------------------------------------------------------------------
// Mêmes fonctions pures qu'`AppState` (décision n° 182), sans la classe Svelte : `exportJson`
// stampe puis sérialise, `mergeJson` fusionne — exactement le contrat que `MailboxSyncOptions`
// attend d'`AppState.exportBackup`/`restoreBackup('merge')`.

interface Device {
  id: string;
  state: StoredStateV1;
  sync: SyncMeta;
  baseline: StoredStateV1;
  mergeCalls: number;
  exportJson(): string;
  mergeJson(json: string): { ok: true; report: MergeReport | null } | { ok: false; error: string };
  addNote(key: string, note: string): void;
}

function makeDevice(id: string): Device {
  const d: Device = {
    id,
    state: emptyState(),
    sync: emptySyncMeta(),
    baseline: emptyState(),
    mergeCalls: 0,
    exportJson(): string {
      d.sync = stampChanges(d.baseline, d.state, d.sync, d.id, Date.now());
      d.baseline = d.state;
      return serializeBackup({ ...d.state, sync: d.sync }, new Date().toISOString());
    },
    mergeJson(json) {
      d.mergeCalls += 1;
      const parsed = parseBackup(json);
      if (!parsed.ok) return parsed;
      const { sync: remoteSync, ...remoteState } = parsed.state;
      const result = mergeSynced(
        { state: d.state, sync: d.sync },
        { state: remoteState as StoredStateV1, sync: remoteSync ?? emptySyncMeta() },
        d.id,
        Date.now(),
      );
      d.state = result.state;
      d.sync = result.sync;
      d.baseline = result.state;
      return { ok: true, report: result.report };
    },
    addNote(key, note) {
      const evt: ManualEvent = {
        id: key,
        at: '2026-01-01T00:00:00',
        kind: 'buy',
        asset: 'btc',
        qty: '1',
        amountEur: null,
        scope: 'coinhouse',
        note,
      };
      d.state = { ...d.state, manualEvents: { ...d.state.manualEvents, [key]: evt } };
    },
  };
  return d;
}

function optionsFor(
  device: Device,
  folder: MailboxFolder,
  passphrase: string,
  nextSeq: number,
  lastMergedSeq: Readonly<Record<string, number>> = {},
): MailboxSyncOptions {
  return {
    folder,
    device: device.id,
    passphrase,
    salt: salt(),
    nextSeq,
    lastMergedSeq,
    kdfParams: FAST,
    exportJson: device.exportJson,
    mergeJson: device.mergeJson,
  };
}

// --- Écriture numérotée et élagage des siens ---------------------------------------------------

describe('syncMailbox — dépôt et élagage de ses propres fichiers', () => {
  it('dossier vide : écrit le premier fichier numéroté, sans pair, sans élagage', async () => {
    const folder = new FakeFolder();
    const device = makeDevice('11111111-1111-1111-1111-111111111111');
    const result = await syncMailbox(optionsFor(device, folder, 'phrase', 1));
    expect(result.writeError).toBeNull();
    expect(result.wrote?.seq).toBe(1);
    expect(result.wrote?.name).toBe('cout-revient-ch-sync-11111111-000001.txt');
    expect(folder.names()).toEqual([result.wrote?.name]);
    expect(result.peers).toEqual([]);
    expect(result.pruned).toEqual([]);
  });

  it('au-delà de deux dépôts, élague ses propres anciens fichiers (garde les deux derniers)', async () => {
    const folder = new FakeFolder();
    const device = makeDevice('mine');
    for (const seq of [1, 2, 3]) {
      folder.seed(
        `cout-revient-ch-sync-mine-00000${seq}.txt`,
        await envelopeText('{}', 'phrase', 'mine', seq),
      );
    }
    const result = await syncMailbox(optionsFor(device, folder, 'phrase', 4));
    expect(result.wrote?.seq).toBe(4);
    expect(result.pruned.sort()).toEqual([
      'cout-revient-ch-sync-mine-000001.txt',
      'cout-revient-ch-sync-mine-000002.txt',
    ]);
    // Les deux plus récents survivent : le tout nouveau, et le seq=3 précédent.
    expect(folder.names().sort()).toEqual([
      'cout-revient-ch-sync-mine-000003.txt',
      result.wrote?.name,
    ]);
  });

  it('un fichier propre verrouillé (client cloud) n’empêche pas le cycle : retenté au suivant', async () => {
    const folder = new FakeFolder();
    const device = makeDevice('mine');
    for (const seq of [1, 2, 3]) {
      const name = `cout-revient-ch-sync-mine-00000${seq}.txt`;
      folder.seed(name, await envelopeText('{}', 'phrase', 'mine', seq));
      if (seq === 1) folder.lock(name); // ne peut pas être supprimé ce cycle
    }
    const result = await syncMailbox(optionsFor(device, folder, 'phrase', 4));
    // seq=2 est bien élagué ; seq=1 (verrouillé) reste, sans faire échouer le cycle.
    expect(result.pruned).toEqual(['cout-revient-ch-sync-mine-000002.txt']);
    expect(result.writeError).toBeNull();
    expect(folder.names()).toContain('cout-revient-ch-sync-mine-000001.txt');
  });

  it('n’écrase jamais un fichier existant : toujours un NOUVEAU nom numéroté', async () => {
    const folder = new FakeFolder();
    const device = makeDevice('mine');
    const before = await syncMailbox(optionsFor(device, folder, 'phrase', 1));
    const beforeContent = folder.contents(before.wrote!.name);
    const after = await syncMailbox(optionsFor(device, folder, 'phrase', 2));
    expect(after.wrote?.name).not.toBe(before.wrote?.name);
    // Le premier fichier n'a pas été touché par le second appel (avant son élagage à seq=3, keep=2).
    expect(folder.contents(before.wrote!.name)).toBe(beforeContent);
  });
});

// --- Construction d'un dépôt SANS dossier (partage Android) --------------------------------------

describe('buildMailboxDeposit', () => {
  it('produit exactement ce que `syncMailbox` aurait écrit dans un dossier pour le même seq', async () => {
    const built = await buildMailboxDeposit({
      device: '550e8400-e29b-41d4-a716-446655440000',
      passphrase: 'phrase',
      salt: salt(),
      seq: 7,
      kdfParams: FAST,
      exportJson: () => '{"hello":"monde"}',
    });
    expect(built.name).toBe('cout-revient-ch-sync-550e8400-000007.txt');
    const header = readMailboxHeader(built.text);
    expect(header.ok).toBe(true);
    if (!header.ok) return;
    expect(header.envelope.device).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(header.envelope.seq).toBe(7);
    expect(await decryptMailboxEnvelope(header.envelope, 'phrase')).toBe('{"hello":"monde"}');
  });

  it('un fichier construit ainsi est lu normalement par un pair via `syncMailbox`', async () => {
    const folder = new FakeFolder();
    const built = await buildMailboxDeposit({
      device: 'phone',
      passphrase: 'phrase-commune',
      salt: salt(),
      seq: 1,
      kdfParams: FAST,
      exportJson: () => makeDevice('phone').exportJson(),
    });
    folder.seed(built.name, built.text);
    const device = makeDevice('mine');
    const result = await syncMailbox(optionsFor(device, folder, 'phrase-commune', 1));
    expect(result.peers).toEqual([
      {
        device: 'phone',
        outcome: {
          status: 'merged',
          seq: 1,
          writtenAt: expect.any(String),
          report: expect.anything(),
        },
      },
    ]);
  });
});

// --- Lecture des pairs ---------------------------------------------------------------------------

describe('syncMailbox — lecture des pairs', () => {
  it('ignore ses propres fichiers, ne les traite jamais comme un pair', async () => {
    const folder = new FakeFolder();
    const device = makeDevice('mine');
    folder.seed(
      'cout-revient-ch-sync-mine-000001.txt',
      await envelopeText('{}', 'phrase', 'mine', 1),
    );
    const result = await syncMailbox(optionsFor(device, folder, 'phrase', 2));
    expect(result.peers).toEqual([]);
  });

  it('un fichier vide ou tronqué parmi les pairs : rien de nouveau, jamais une erreur', async () => {
    const folder = new FakeFolder();
    folder.seed('cout-revient-ch-sync-peer-000001.txt', '');
    folder.seed('cout-revient-ch-sync-peer-000002.txt', '{"app":"cout-revient-ch","kind":"mail');
    const device = makeDevice('mine');
    const result = await syncMailbox(optionsFor(device, folder, 'phrase', 1));
    expect(result.peers).toEqual([]);
    expect(result.writeError).toBeNull();
  });

  it('une copie de conflit du même dépôt (même appareil, même seq) ne fusionne qu’une fois', async () => {
    const folder = new FakeFolder();
    const peerText = await envelopeText('{"schemaVersion":1}', 'phrase', 'peer', 1);
    folder.seed('cout-revient-ch-sync-peer-000001.txt', peerText);
    folder.seed('cout-revient-ch-sync-peer-000001 (conflit).txt', peerText);
    const device = makeDevice('mine');
    const result = await syncMailbox(optionsFor(device, folder, 'phrase', 1));
    expect(result.peers).toHaveLength(1);
    expect(device.mergeCalls).toBe(1);
  });

  it('déjà fusionné (seq ≤ dernier connu) : « à jour », jamais rappelé à `mergeJson`', async () => {
    const folder = new FakeFolder();
    const peer = makeDevice('peer');
    peer.addNote('n1', 'note du pair');
    folder.seed(
      'cout-revient-ch-sync-peer-000001.txt',
      await envelopeText(peer.exportJson(), 'phrase', 'peer', 1),
    );
    const device = makeDevice('mine');
    const first = await syncMailbox(optionsFor(device, folder, 'phrase', 1));
    expect(first.peers[0]?.outcome.status).toBe('merged');
    expect(device.mergeCalls).toBe(1);

    // Second cycle, MÊME fichier encore présent, `lastMergedSeq` reporté depuis le premier résultat.
    const second = await syncMailbox(optionsFor(device, folder, 'phrase', 2, first.lastMergedSeq));
    expect(second.peers[0]?.outcome.status).toBe('up-to-date');
    expect(device.mergeCalls).toBe(1); // pas un appel de plus
  });

  it('mauvaise phrase : erreur nommée, et rien n’est fusionné', async () => {
    const folder = new FakeFolder();
    const peer = makeDevice('peer');
    peer.addNote('n1', 'secret du pair');
    folder.seed(
      'cout-revient-ch-sync-peer-000001.txt',
      await envelopeText(peer.exportJson(), 'bonne-phrase', 'peer', 1),
    );
    const device = makeDevice('mine');
    const result = await syncMailbox(optionsFor(device, folder, 'mauvaise-phrase', 1));
    expect(result.peers).toEqual([
      {
        device: 'peer',
        outcome: { status: 'wrong-passphrase', seq: 1, writtenAt: expect.any(String) },
      },
    ]);
    expect(device.mergeCalls).toBe(0);
    expect(device.state.manualEvents).toEqual({});
    expect(result.lastMergedSeq['peer']).toBeUndefined(); // jamais avancé : à retenter
  });

  it('ne touche jamais un fichier d’un appareil pair lors de son propre élagage', async () => {
    const folder = new FakeFolder();
    for (const seq of [1, 2, 3]) {
      folder.seed(
        `cout-revient-ch-sync-peer-00000${seq}.txt`,
        await envelopeText('{}', 'phrase', 'peer', seq),
      );
    }
    const device = makeDevice('mine');
    await syncMailbox(optionsFor(device, folder, 'phrase', 1, { peer: 3 })); // déjà tout fusionné
    // Les TROIS fichiers du pair doivent survivre : ownFilesToPrune ne connaît que « mine ».
    expect(folder.names()).toContain('cout-revient-ch-sync-peer-000001.txt');
    expect(folder.names()).toContain('cout-revient-ch-sync-peer-000002.txt');
    expect(folder.names()).toContain('cout-revient-ch-sync-peer-000003.txt');
  });

  it('l’ordre de découverte des fichiers ne change rien au résultat', async () => {
    await fc.assert(
      fc.asyncProperty(fc.boolean(), async (reversed) => {
        const folder = new FakeFolder();
        const names = ['cout-revient-ch-sync-a-000001.txt', 'cout-revient-ch-sync-b-000001.txt'];
        const texts = await Promise.all([
          envelopeText('{}', 'phrase', 'a', 1),
          envelopeText('{}', 'phrase', 'b', 1),
        ]);
        const order = reversed ? [1, 0] : [0, 1];
        for (const i of order) folder.seed(names[i]!, texts[i]!);
        const device = makeDevice('mine');
        const result = await syncMailbox(optionsFor(device, folder, 'phrase', 1));
        expect(result.peers.map((p) => p.device).sort()).toEqual(['a', 'b']);
      }),
    );
  });
});

// --- Convergence à deux appareils ---------------------------------------------------------------

describe('syncMailbox — deux appareils convergent après un aller-retour', () => {
  it('A dépose une note, B la lit ; B dépose la sienne, A la lit — les deux finissent avec les deux notes', async () => {
    const folder = new FakeFolder();
    const a = makeDevice('device-a');
    const b = makeDevice('device-b');

    a.addNote('note-a', 'écrite par A');
    const r1 = await syncMailbox(optionsFor(a, folder, 'phrase-commune', 1));
    expect(r1.wrote).not.toBeNull();

    const r2 = await syncMailbox(optionsFor(b, folder, 'phrase-commune', 1));
    expect(r2.peers[0]?.outcome.status).toBe('merged');
    expect(b.state.manualEvents['note-a']?.note).toBe('écrite par A');

    b.addNote('note-b', 'écrite par B');
    const r3 = await syncMailbox(optionsFor(b, folder, 'phrase-commune', 2, r2.lastMergedSeq));
    expect(r3.wrote).not.toBeNull();

    const r4 = await syncMailbox(optionsFor(a, folder, 'phrase-commune', 2, r1.lastMergedSeq));
    expect(r4.peers[0]?.outcome.status).toBe('merged');

    // Convergence : les DEUX appareils connaissent les DEUX notes.
    expect(Object.keys(a.state.manualEvents).sort()).toEqual(['note-a', 'note-b']);
    expect(Object.keys(b.state.manualEvents).sort()).toEqual(['note-a', 'note-b']);
    expect(a.state.manualEvents['note-b']?.note).toBe('écrite par B');
    expect(b.state.manualEvents['note-a']?.note).toBe('écrite par A');
  });
});

// --- Écriture pendant que le coffre est fermé ---------------------------------------------------
// N'est PAS testée ici : `syncMailbox` n'a aucune notion de coffre (délibérément — c'est un
// orchestrateur de dossier, pas un gardien d'état). La règle « coffre fermé ⇒ aucune écriture »
// est portée par l'APPELANT (`src/state/app.svelte.ts`), au même endroit que pour la sauvegarde
// automatique dans un dossier (`initFolderBackup`, appelée seulement après le retour anticipé sur
// coffre verrouillé d'`AppState.init()`) — voir le rapport final.
