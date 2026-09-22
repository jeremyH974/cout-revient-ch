/**
 * Orchestrateur PUR (autant que possible) d'UN cycle de synchronisation par boîte aux lettres
 * (P125) : lire les dépôts des appareils pairs, les fusionner, déposer le sien, élaguer ses
 * anciens fichiers. Rien ici ne touche au disque, au réseau ni à IndexedDB directement —
 * `MailboxFolder` est le SEUL point de contact avec l'extérieur, implémenté par un
 * `FileSystemDirectoryHandle` en vrai (`mailbox-folder.ts`), par une fausse implémentation en
 * test (`mailbox-sync.test.ts`). C'est ce qui permet de tester toute la logique de décision — quoi
 * lire, quoi fusionner, quoi écrire, quoi élaguer, quoi ignorer — sans navigateur.
 *
 * Composition plutôt que réécriture : la sélection des fichiers (`mailbox.ts`,
 * `selectPeerFiles`/`ownFilesToPrune`), le chiffrement (`mailbox-envelope.ts`) et la fusion
 * (`sync/merge.ts`, via les callbacks `exportJson`/`mergeJson` fournis par l'appelant — en
 * pratique `AppState.exportBackup`/`restoreBackup('merge')`) existaient déjà avant ce chantier ;
 * ce module ne fait qu'ORDONNANCER leurs appels pour UN cycle complet.
 *
 * ## Ce qui n'est jamais une erreur bloquante
 *
 * Un fichier vide, illisible ou tronqué n'atteint jamais ce module : `selectPeerFiles` (appelé
 * ici) l'a déjà écarté en amont, silencieusement — voir `mailbox.ts`. Une MAUVAISE PHRASE sur un
 * fichier par ailleurs bien formé, elle, ARRIVE jusqu'ici : elle est rapportée nommément pour CET
 * appareil pair (`status: 'wrong-passphrase'`), sans jamais interrompre la lecture des autres ni
 * faire échouer tout le cycle. Le même principe protège l'écriture et l'élagage : une écriture qui
 * échoue (permission révoquée, quota) est rapportée (`writeError`) plutôt que levée, et une
 * suppression qui échoue (fichier verrouillé par le client cloud) est silencieusement retentée au
 * cycle suivant, puisqu'elle dépassera de nouveau `keep`.
 *
 * ## Pourquoi un dépôt à CHAQUE cycle, jamais conditionnel
 *
 * Le module n'essaie pas de deviner si « quelque chose a changé » avant d'écrire : il écrit à
 * chaque appel. Décider QUAND appeler `syncMailbox` (au démarrage, au retour au premier plan,
 * après une modification avec un anti-rebond, à la demande) est la responsabilité de l'appelant —
 * `src/state/app.svelte.ts`. Comme au plus `keep` fichiers propres survivent (le reste est élagué
 * à chaque cycle), des dépôts fréquents ne font pas grossir le dossier sans limite.
 */
import type { KdfParams } from './kdf';
import {
  mailboxFileName,
  ownFilesToPrune,
  selectPeerFiles,
  type MailboxFileEntry,
} from './mailbox';
import {
  decryptMailboxEnvelope,
  encryptMailboxEnvelope,
  readMailboxHeader,
  type MailboxEnvelopeV3,
} from './mailbox-envelope';
import type { MergeReport } from './sync/merge';

/**
 * Surface minimale sur un dossier synchronisé (Drive, OneDrive… ou OPFS en test) : ce que ce
 * module exige, rien de plus. Une implémentation réelle (`mailbox-folder.ts`) ne doit JAMAIS
 * lever depuis `read` — un fichier illisible (verrouillé, à moitié téléversé, permission perdue
 * entre deux appels) vaut `null`, jamais une exception.
 */
export interface MailboxFolder {
  /** Noms de fichiers présents, dans n'importe quel ordre (la sélection y est indifférente). */
  list(): Promise<string[]>;
  /** Contenu texte d'un fichier, ou `null` s'il est illisible/absent. Ne lève jamais. */
  read(name: string): Promise<string | null>;
  write(name: string, text: string): Promise<void>;
  remove(name: string): Promise<void>;
}

/** Ce qui est arrivé au dépôt le plus récent d'UN appareil pair, durant ce cycle. */
export type PeerOutcome =
  | { status: 'merged'; seq: number; writtenAt: string; report: MergeReport | null }
  | { status: 'up-to-date'; seq: number; writtenAt: string }
  /**
   * Message unique, comme `decryptMailboxEnvelope` : une phrase fausse et un texte chiffré altéré
   * produisent la même erreur, indistinguables de l'extérieur (voir `mailbox-envelope.ts`). Le nom
   * retient la cause la plus probable, sans prétendre exclure l'autre.
   */
  | { status: 'wrong-passphrase'; seq: number; writtenAt: string }
  /** Déchiffré, mais `mergeJson` a refusé le contenu (schéma inconnu, autre application…). */
  | { status: 'invalid'; seq: number; writtenAt: string; error: string };

export interface PeerSyncResult {
  device: string;
  outcome: PeerOutcome;
}

export interface MailboxSyncResult {
  /** Un résultat par appareil pair dont au moins un fichier lisible a été trouvé ce cycle. */
  peers: PeerSyncResult[];
  wrote: { name: string; seq: number; writtenAt: string } | null;
  /** Non `null` seulement si l'écriture du dépôt a échoué — `wrote` reste alors `null`. */
  writeError: string | null;
  /** Noms des fichiers propres effectivement supprimés (au-delà des `keep` plus récents). */
  pruned: string[];
  /**
   * `lastMergedSeq` reçu en entrée, avancé pour chaque pair effectivement fusionné ce cycle —
   * **à PERSISTER par l'appelant** (méta IndexedDB) pour que le prochain cycle ignore ces fichiers.
   * Jamais avancé sur `wrong-passphrase`/`invalid` : un fichier non fusionné doit être retenté.
   */
  lastMergedSeq: Record<string, number>;
}

export interface MailboxSyncOptions {
  folder: MailboxFolder;
  /** Identifiant de CET appareil (`device-id.ts`) — jamais celui d'un pair. */
  device: string;
  /** Phrase de synchronisation de la session — jamais enregistrée par ce module. */
  passphrase: string;
  /** Sel STABLE de cet appareil (méta IndexedDB) — voir `mailbox-envelope.ts`. */
  salt: Uint8Array<ArrayBuffer>;
  /** `seq` du PROCHAIN fichier à écrire pour cet appareil (dernier connu + 1, 1 si aucun). */
  nextSeq: number;
  /** Dernier `seq` déjà fusionné, PAR APPAREIL PAIR — pour ignorer ce qui a déjà été vu. */
  lastMergedSeq: Readonly<Record<string, number>>;
  /** Combien de fichiers PROPRES garder après écriture (les plus récents). Défaut 2. */
  keep?: number;
  now?: () => number;
  /** Paramètres Argon2id pour LE CHIFFREMENT (jamais pour la lecture, qui suit l'en-tête reçu). */
  kdfParams?: KdfParams;
  /** L'état courant, déjà sérialisé et daté — `AppState.exportBackup()`. */
  exportJson: () => string;
  /**
   * Fusionne un JSON reçu dans l'état courant. Même contrat que
   * `AppState.restoreBackup(json, 'merge')` : ne touche rien si `ok` est faux.
   */
  mergeJson: (
    json: string,
  ) => { ok: true; report: MergeReport | null } | { ok: false; error: string };
}

/** Enveloppe déjà lue en mémoire, pour ne jamais relire un fichier deux fois. */
interface ReadEntry extends MailboxFileEntry {
  text: string;
}

async function readAll(folder: MailboxFolder): Promise<ReadEntry[]> {
  const names = await folder.list();
  const entries: ReadEntry[] = [];
  for (const name of names) {
    const text = await folder.read(name);
    if (text === null) continue; // illisible/absent : rien de nouveau, jamais bloquant
    entries.push({ name, size: text.length, header: readMailboxHeader(text), text });
  }
  return entries;
}

/** Déchiffre puis fusionne UN fichier pair ; ne lève jamais. */
async function mergeOneEnvelope(
  envelope: MailboxEnvelopeV3,
  passphrase: string,
  mergeJson: MailboxSyncOptions['mergeJson'],
): Promise<
  | { ok: true; report: MergeReport | null }
  | { ok: false; reason: 'wrong-passphrase' }
  | { ok: false; reason: 'invalid'; error: string }
> {
  let json: string;
  try {
    json = await decryptMailboxEnvelope(envelope, passphrase);
  } catch {
    return { ok: false, reason: 'wrong-passphrase' };
  }
  const merged = mergeJson(json);
  if (!merged.ok) return { ok: false, reason: 'invalid', error: merged.error };
  return { ok: true, report: merged.report };
}

export interface BuildMailboxDepositOptions {
  device: string;
  passphrase: string;
  salt: Uint8Array<ArrayBuffer>;
  /** `seq` de CE dépôt (déjà réservé par l'appelant — voir `mailbox-folder.ts`, `nextMailboxSeq`). */
  seq: number;
  now?: () => number;
  kdfParams?: KdfParams;
  exportJson: () => string;
}

/**
 * Construit le fichier `.txt` que CET appareil déposerait pour `seq` — sans jamais y toucher de
 * dossier : c'est ce qui permet de le réutiliser tel quel pour le partage Android (`navigator.share`
 * / téléchargement, aucun `MailboxFolder` en jeu) comme pour l'écriture PC ci-dessous.
 */
export async function buildMailboxDeposit(
  options: BuildMailboxDepositOptions,
): Promise<{ name: string; text: string; envelope: MailboxEnvelopeV3 }> {
  const { device, passphrase, salt, seq, now, kdfParams, exportJson } = options;
  const json = exportJson();
  const envelope = await encryptMailboxEnvelope(json, passphrase, device, seq, salt, {
    ...(now ? { now } : {}),
    ...(kdfParams ? { params: kdfParams } : {}),
  });
  const name = mailboxFileName(device, seq);
  return { name, text: JSON.stringify(envelope), envelope };
}

/** Écrit le dépôt de cet appareil dans le DOSSIER ; renvoie l'enveloppe écrite (pour l'élagage). */
async function writeOwnDeposit(
  options: MailboxSyncOptions,
): Promise<{ ok: true; name: string; envelope: MailboxEnvelopeV3 } | { ok: false; error: string }> {
  try {
    const { name, text, envelope } = await buildMailboxDeposit({
      device: options.device,
      passphrase: options.passphrase,
      salt: options.salt,
      seq: options.nextSeq,
      ...(options.now ? { now: options.now } : {}),
      ...(options.kdfParams ? { kdfParams: options.kdfParams } : {}),
      exportJson: options.exportJson,
    });
    await options.folder.write(name, text);
    return { ok: true, name, envelope };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * UN cycle complet : lire les pairs, fusionner ce qui est nouveau, déposer son propre fichier,
 * élaguer les siens au-delà de `keep`. Voir la documentation de tête de fichier pour ce qui est,
 * et n'est jamais, une erreur bloquante.
 */
export async function syncMailbox(options: MailboxSyncOptions): Promise<MailboxSyncResult> {
  const { folder, device, passphrase, keep = 2, mergeJson } = options;

  const entries = await readAll(folder);
  const peerFiles = selectPeerFiles(entries, device);
  const lastMergedSeq: Record<string, number> = { ...options.lastMergedSeq };
  const peers: PeerSyncResult[] = [];

  for (const file of peerFiles) {
    if (!file.header.ok) continue; // garde défensive : selectPeerFiles ne renvoie que des ok
    const { device: peerDevice, seq, writtenAt } = file.header.envelope;
    if (seq <= (lastMergedSeq[peerDevice] ?? -1)) {
      peers.push({ device: peerDevice, outcome: { status: 'up-to-date', seq, writtenAt } });
      continue;
    }
    const outcome = await mergeOneEnvelope(file.header.envelope, passphrase, mergeJson);
    if (outcome.ok) {
      lastMergedSeq[peerDevice] = seq; // avancé SEULEMENT sur un succès — un échec sera retenté
      peers.push({
        device: peerDevice,
        outcome: { status: 'merged', seq, writtenAt, report: outcome.report },
      });
    } else if (outcome.reason === 'wrong-passphrase') {
      peers.push({ device: peerDevice, outcome: { status: 'wrong-passphrase', seq, writtenAt } });
    } else {
      peers.push({
        device: peerDevice,
        outcome: { status: 'invalid', seq, writtenAt, error: outcome.error },
      });
    }
  }

  const written = await writeOwnDeposit(options);
  const wrote = written.ok
    ? { name: written.name, seq: options.nextSeq, writtenAt: written.envelope.writtenAt }
    : null;
  const writeError = written.ok ? null : written.error;

  // L'élagage voit le fichier qu'on vient d'écrire (le plus récent des siens) : sans lui, un
  // dossier qui tenait déjà `keep` fichiers propres ne libérerait jamais le plus ancien.
  const ownEntries: MailboxFileEntry[] = written.ok
    ? [
        ...entries,
        { name: written.name, size: 0, header: { ok: true, envelope: written.envelope } },
      ]
    : entries;
  const toPrune = ownFilesToPrune(ownEntries, device, keep);
  const pruned: string[] = [];
  for (const file of toPrune) {
    try {
      await folder.remove(file.name);
      pruned.push(file.name);
    } catch {
      // Transitoire (verrou du client cloud, permission) : ce fichier dépassera de nouveau `keep`
      // au prochain cycle, qui retentera sa suppression — jamais d'erreur bloquante ici non plus.
    }
  }

  return { peers, wrote, writeError, pruned, lastMergedSeq };
}
