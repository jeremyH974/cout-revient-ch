<script lang="ts">
  /**
   * Écran « Synchronisation » (P125) : la boîte aux lettres chiffrée entre les appareils d'UN
   * propriétaire, sans compte ni serveur. Deux chemins mutuellement exclusifs, choisis par
   * `app.mailboxSync.supported` (File System Access — Chrome/Edge de bureau) :
   *
   * - **PC** : un dossier choisi une fois, synchronisé automatiquement (démarrage, retour au
   *   premier plan, 60 s après une modification, `state/app.svelte.ts`) — cet écran n'a qu'à
   *   proposer le bouton « Synchroniser maintenant » et afficher l'état.
   * - **Android (et tout navigateur sans File System Access)** : « Recevoir » par le sélecteur
   *   système (fichier) et par le partage entrant (Web Share Target, `shared-inbox.ts`) ;
   *   « Envoyer » construit son propre dépôt et l'offre à `navigator.share`, repli sur le
   *   téléchargement.
   *
   * La phrase de synchronisation n'est JAMAIS enregistrée (`mailbox-session.ts`) : elle est
   * redemandée dès que le dossier est prêt mais qu'elle n'a pas encore été saisie CETTE session.
   */
  import { onMount } from 'svelte';
  import { nowMs } from '$lib/clock';
  import { canShareFiles, downloadText, shareTextFile } from '$lib/export/download';
  import { fmtRelative } from '$lib/format/fr';
  import { fmtMergeSummary } from '$lib/format/sync';
  import type { PeerOutcome } from '$lib/storage/mailbox-sync';
  import { summarizeMergeReport } from '$lib/storage/sync/merge';
  import { takeSharedFile } from '$lib/storage/shared-inbox';
  import AppBar from '../components/layout/AppBar.svelte';
  import Sheet from '../components/shared/Sheet.svelte';
  import { app } from '../state/app.svelte';
  import { toasts } from '../state/ui.svelte';

  const shareAvailable = canShareFiles('depot.txt', 'text/plain');

  let askPassphrase = $state(false);
  let passphraseInput = $state('');
  let busy = $state(false);
  /** Fichiers reçus (partage entrant, sélecteur) avant que la phrase ne soit connue cette session. */
  let pendingTexts = $state<string[]>([]);

  // Dossier prêt (choisi, permission accordée) mais phrase pas encore saisie CETTE session : on la
  // redemande sans attendre un clic. `askPassphrase` n'est pas lu ici — un utilisateur qui referme
  // la feuille sans rien saisir n'est donc pas harcelé tant que rien d'autre ne change.
  $effect(() => {
    if (
      app.mailboxSync.folderName !== null &&
      app.mailboxSync.permission === 'granted' &&
      !app.mailboxSync.unlocked
    ) {
      askPassphrase = true;
    }
  });

  /** Sans dossier (Android), rien ne déclenche l'effet ci-dessus : recevoir ou envoyer un fichier
   *  sans phrase connue met ce fichier de côté et ouvre la feuille elle-même. */
  async function ingestOne(text: string): Promise<void> {
    if (!app.mailboxSync.unlocked) {
      pendingTexts = [...pendingTexts, text];
      askPassphrase = true;
      return;
    }
    const result = await app.ingestMailboxFile(text);
    if (result.ok) {
      toasts.push(
        result.report ? fmtMergeSummary(summarizeMergeReport(result.report)) : 'Fusionné.',
        'success',
      );
    } else {
      toasts.push(result.error, 'error');
    }
  }

  async function drainPending(): Promise<void> {
    const texts = pendingTexts;
    pendingTexts = [];
    for (const text of texts) await ingestOne(text);
  }

  onMount(() => {
    void (async () => {
      const shared = await takeSharedFile();
      if (shared) await ingestOne(shared.text);
    })();
  });

  function unlock(): void {
    if (passphraseInput === '') return;
    app.unlockMailboxSync(passphraseInput);
    passphraseInput = '';
    askPassphrase = false;
    void drainPending();
  }

  async function choose(): Promise<void> {
    try {
      const chosen = await app.chooseMailboxFolder();
      if (chosen) toasts.push('Dossier de synchronisation choisi.', 'success');
    } catch (error) {
      toasts.push(`Dossier refusé : ${String(error)}`, 'error');
    }
  }

  async function syncNow(): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      await app.runMailboxSync();
      if (app.mailboxSync.error) toasts.push(app.mailboxSync.error, 'error');
    } finally {
      busy = false;
    }
  }

  async function receive(files: FileList | null): Promise<void> {
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) await ingestOne(await file.text());
  }

  async function send(): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      const built = await app.buildMailboxDeposit();
      if (!built) {
        askPassphrase = true;
        return;
      }
      const shared = shareAvailable && (await shareTextFile(built.name, built.text, 'text/plain'));
      if (!shared) downloadText(built.name, built.text, 'text/plain');
      toasts.push(shared ? 'Dépôt partagé.' : 'Dépôt téléchargé.', 'success');
    } finally {
      busy = false;
    }
  }

  function peerLabel(outcome: PeerOutcome): string {
    switch (outcome.status) {
      case 'merged':
        return outcome.report ? fmtMergeSummary(summarizeMergeReport(outcome.report)) : 'Fusionné.';
      case 'up-to-date':
        return 'À jour.';
      case 'wrong-passphrase':
        return 'Phrase secrète incorrecte pour ce dépôt (ou fichier altéré).';
      case 'invalid':
        return `Ignoré : ${outcome.error}`;
    }
  }

  const peers = $derived(Object.values(app.mailboxSync.peers));
</script>

<AppBar title="Synchronisation" back />

<div class="synchro">
  <section class="card group">
    <h2>Comment ça marche</h2>
    <p class="muted small">
      Chaque appareil dépose son propre fichier chiffré (<code>.txt</code>) dans un dossier que vous
      synchronisez déjà avec Google Drive, OneDrive ou un service équivalent, et lit les fichiers
      des autres. Aucun compte, aucun serveur : c'est le dossier qui fait le transport, et lui seul.
      La version la plus récente de chaque élément l'emporte, quel que soit l'appareil qui l'a
      écrite ; rien n'est jamais perdu en silence.
    </p>
    {#if app.mailboxSync.unlocked}
      <p class="muted small">Phrase de synchronisation saisie pour cette session.</p>
    {:else}
      <div class="row">
        <button class="secondary" type="button" onclick={() => (askPassphrase = true)}
          >Saisir la phrase de synchronisation…</button
        >
      </div>
    {/if}
  </section>

  {#if app.mailboxSync.supported}
    <section class="card group">
      <h2>Dossier de synchronisation</h2>
      {#if app.mailboxSync.folderName === null}
        <p class="muted small">
          Choisissez un dossier que Google Drive ou OneDrive synchronise déjà sur cet appareil
          (icône dans la barre des tâches ou l'explorateur de fichiers) : le fichier de cet appareil
          y sera déposé, et les autres appareils y liront le leur.
        </p>
        <div class="row">
          <button class="primary" type="button" onclick={() => void choose()}
            >Choisir le dossier de synchronisation…</button
          >
        </div>
      {:else}
        <p class="small">
          Dossier : <strong>{app.mailboxSync.folderName}</strong> ·
          {#if app.mailboxSync.permission === 'granted'}
            {#if app.mailboxSync.syncing}
              synchronisation en cours…
            {:else if app.mailboxSync.lastSyncAt}
              dernier dépôt {fmtRelative(app.mailboxSync.lastSyncAt, nowMs())}
            {:else}
              en attente du premier dépôt
            {/if}
          {:else}
            <span class="warn">permission requise</span>
          {/if}
          {#if app.mailboxSync.error}<span class="warn"> · {app.mailboxSync.error}</span>{/if}
        </p>
        <div class="row">
          {#if app.mailboxSync.permission !== 'granted'}
            <button
              class="secondary"
              type="button"
              onclick={() => void app.reconnectMailboxFolder()}>Reconnecter le dossier</button
            >
          {:else}
            <button
              class="primary"
              type="button"
              disabled={busy || app.mailboxSync.syncing}
              onclick={() => void syncNow()}
              >{app.mailboxSync.syncing ? 'Synchronisation…' : 'Synchroniser maintenant'}</button
            >
          {/if}
          <button class="link" type="button" onclick={() => void app.stopMailboxFolder()}
            >Arrêter</button
          >
        </div>
      {/if}
    </section>
  {:else}
    <section class="card group">
      <h2>Recevoir</h2>
      <p class="muted small">
        Par le sélecteur de fichiers (Google Drive y figure si son application est installée), ou
        automatiquement si vous êtes arrivé ici en partageant un fichier depuis une autre
        application.
      </p>
      <div class="row">
        <label class="file"
          ><input
            type="file"
            multiple
            accept=".txt,text/plain,.json,application/json"
            onchange={(e) => {
              void receive(e.currentTarget.files);
              e.currentTarget.value = '';
            }}
          /><span class="secondary">Recevoir un ou plusieurs fichiers…</span></label
        >
      </div>
    </section>
    <section class="card group">
      <h2>Envoyer</h2>
      <p class="muted small">
        Construit le dépôt de cet appareil et l'offre au partage (Drive, Quick Share…), avec repli
        sur le téléchargement si aucune application ne peut le recevoir.
      </p>
      <div class="row">
        <button class="primary" type="button" disabled={busy} onclick={() => void send()}
          >{shareAvailable ? 'Partager le dépôt' : 'Télécharger le dépôt'}</button
        >
      </div>
    </section>
  {/if}

  <section class="card group">
    <h2>Appareils pairs</h2>
    {#if peers.length === 0}
      <p class="muted small">Aucun appareil pair vu pour l'instant.</p>
    {:else}
      <ul class="peers">
        {#each peers as peer (peer.device)}
          <li>
            <span class="device">{peer.device.slice(0, 8)}</span>
            <span class="muted small"
              >dépôt n° {peer.outcome.seq} · {fmtRelative(peer.outcome.writtenAt, nowMs())}</span
            >
            <span class="small">{peerLabel(peer.outcome)}</span>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <p class="muted small center">
    Fonctionne réseau coupé (variante personnelle comprise) : aucune de ces actions n'appelle
    Internet — voir <code>docs/variante-personnelle.md</code>.
  </p>
</div>

<Sheet bind:open={askPassphrase} title="Phrase de synchronisation">
  <p>
    Une seule phrase déverrouille toute la boîte aux lettres de tous vos appareils — c'est elle qui
    chiffre et déchiffre les dépôts. Elle n'est <strong>jamais enregistrée</strong> : à ressaisir à chaque
    session.
  </p>
  <form
    onsubmit={(e) => {
      e.preventDefault();
      unlock();
    }}
  >
    <input
      type="password"
      autocomplete="off"
      placeholder="Phrase de synchronisation"
      aria-label="Phrase de synchronisation"
      bind:value={passphraseInput}
    />
    <button class="primary" type="submit" disabled={passphraseInput === ''}>Déverrouiller</button>
  </form>
</Sheet>

<style>
  .synchro {
    padding: var(--space-3);
    display: grid;
    gap: var(--space-3);
    max-width: 640px;
    margin: 0 auto;
  }
  .group {
    display: grid;
    gap: var(--space-3);
  }
  h2 {
    margin: 0;
    font-size: var(--fs-md);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
  }
  .small {
    font-size: var(--fs-xs);
  }
  .warn {
    color: var(--warn);
  }
  .center {
    text-align: center;
  }
  .file input {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
  }
  .link {
    color: var(--accent);
    text-decoration: underline;
    min-height: var(--tap);
  }
  .peers {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-2);
  }
  .peers li {
    display: grid;
    gap: 2px;
    padding: var(--space-2) 0;
  }
  .peers li + li {
    border-top: 1px solid var(--border);
  }
  .device {
    font-family: var(--font-mono);
    font-weight: 700;
  }
  form {
    display: grid;
    gap: var(--space-2);
    margin-top: var(--space-3);
  }
  input[type='password'] {
    min-height: var(--tap);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--fg);
    padding: 0 var(--space-3);
    width: 100%;
  }
</style>
