<script lang="ts">
  import { nowMs } from '$lib/clock';
  import { D } from '$lib/domain/money';
  import { lotsToCsv, operationsToCsv, positionsToCsv } from '$lib/export/csv-export';
  import { canShareFiles, downloadText, shareTextFile } from '$lib/export/download';
  import { eventsToKoinlyCsv } from '$lib/export/koinly-csv';
  import { koinlyPortabilityPreview } from '$lib/export/koinly-preview';
  import { fmtBytes } from '$lib/format/bytes';
  import { fmtDate, fmtPrice, fmtRelative, localDay } from '$lib/format/fr';
  import { fmtPortabilityGap } from '$lib/format/koinly-preview';
  import { FLAVOR_LABELS, KEYED_FLAVORS } from '$lib/import/onchain/etherscan';
  import {
    isInstallable,
    isStandalone,
    onInstallableChange,
    promptInstall,
  } from '$lib/pwa/install';
  import { router } from '$lib/router.svelte';
  import { collapsedByDefault } from '$lib/ui/narrow';
  import AppBar from '../components/layout/AppBar.svelte';
  import AiSection from '../components/settings/AiSection.svelte';
  import EngineSettings from '../components/settings/EngineSettings.svelte';
  import SelfChecks from '../components/settings/SelfChecks.svelte';
  import SourcesSection from '../components/settings/SourcesSection.svelte';
  import NetworkSection from '../components/settings/NetworkSection.svelte';
  import VaultSection from '../components/settings/VaultSection.svelte';
  import SupportSection from '../components/settings/SupportSection.svelte';
  import {
    decryptBackup,
    encryptBackup,
    isEncryptedBackup,
    type EncryptedBackup,
  } from '$lib/storage/encryption';
  import { summarizeMergeReport } from '$lib/storage/sync/merge';
  import { fmtMergeSummary } from '$lib/format/sync';
  import Sheet from '../components/shared/Sheet.svelte';
  import Switch from '../components/shared/Switch.svelte';
  import type { UiSettings } from '$lib/storage/schema';
  import { app } from '../state/app.svelte';
  import { toasts } from '../state/ui.svelte';

  /** Sommaire d'ancres en tête (P124) : ouvre la section visée sans passer par le routeur à
   *  hash — `#donnees` n'est pas une route, et le laisser filer changerait de page. */
  const SECTIONS: { id: string; label: string }[] = [
    { id: 'donnees', label: 'Données' },
    { id: 'prix', label: 'Prix' },
    { id: 'affichage', label: 'Affichage' },
    { id: 'methode-calcul', label: 'Méthode de calcul' },
    ...(__PRIVATE_BUILD__ ? [{ id: 'reseau', label: 'Sortie réseau' }] : []),
    { id: 'coffre', label: 'Coffre' },
    { id: 'ia', label: 'Récit par IA' },
    { id: 'verifications', label: 'Vérifications automatiques' },
    { id: 'aide', label: 'Aide et retours' },
    { id: 'sources', label: 'Sources des données' },
    { id: 'danger', label: 'Zone dangereuse' },
  ];
  /** Replié à l'ouverture seulement sur petit écran (décision n° 185, `$lib/ui/narrow`). */
  const collapsed = collapsedByDefault();

  function openAndScroll(id: string): void {
    const el = document.getElementById(id);
    if (el instanceof HTMLDetailsElement) el.open = true;
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /** État du stockage (P124) : jamais de rappel à `persist()` en boucle, une seule lecture. */
  let persistedStorage = $state<boolean | null>(null);
  let storageEstimate = $state<{ usage: number; quota: number } | null>(null);
  $effect(() => {
    void navigator.storage?.persisted?.().then((v) => (persistedStorage = v));
    void navigator.storage
      ?.estimate?.()
      .then((e) => (storageEstimate = { usage: e.usage ?? 0, quota: e.quota ?? 0 }));
  });

  /** Installation Android (P124) : masqué en variante privée (jamais de manifeste) et en
   *  standalone — rien à proposer dans les deux cas. */
  let installable = $state(isInstallable() && !isStandalone());
  $effect(() => onInstallableChange((v) => (installable = v && !isStandalone())));
  async function install(): Promise<void> {
    const outcome = await promptInstall();
    installable = false;
    if (outcome === 'accepted') toasts.push('Application installée.', 'success');
  }

  let restoreMode = $state<'replace' | 'merge'>('merge');
  let confirmClear = $state(false);
  // Date locale dans les noms de fichiers (le jour UTC diffère le soir).
  const stamp = (): string => localDay(nowMs());
  const manualPrices = $derived(
    Object.entries(app.state.assetSettings).filter(([, s]) => s.manualPriceEur),
  );
  /** Décompte de ce que l'export portable ne saura pas porter, chiffré sur les données réelles
   *  (docs/backup-format.md § Export portable) — jamais un texte générique. */
  const portabilityGaps = $derived(koinlyPortabilityPreview(app.events));

  /** Chiffrement optionnel de la sauvegarde (la phrase secrète n'est jamais enregistrée). */
  let encrypt = $state(false);
  let passphrase = $state('');
  const MIN_PASSPHRASE = 8;
  const backupFileName = (): string =>
    `${app.state.ui.demoMode ? 'demo-' : ''}cout-revient-ch-sauvegarde-${stamp()}${encrypt ? '-chiffree' : ''}.json`;
  /** Contenu de la sauvegarde : JSON en clair, ou enveloppe chiffrée ; `null` si la phrase est trop courte. */
  async function backupText(): Promise<string | null> {
    const json = app.exportBackup();
    if (!encrypt) return json;
    if (passphrase.length < MIN_PASSPHRASE) {
      toasts.push(`Phrase secrète : ${MIN_PASSPHRASE} caractères minimum.`, 'error');
      return null;
    }
    return JSON.stringify(await encryptBackup(json, passphrase), null, 1);
  }
  /** Rend `true` si un fichier est bien parti : le coffre s'en sert pour savoir si son étape 1 est faite. */
  async function backup(): Promise<boolean> {
    const text = await backupText();
    if (text === null) return false;
    downloadText(backupFileName(), text, 'application/json');
    toasts.push(
      encrypt ? 'Sauvegarde chiffrée téléchargée.' : 'Sauvegarde téléchargée.',
      'success',
    );
    return true;
  }
  /** iPhone/iPad (et Android) : « Enregistrer dans Fichiers », AirDrop… plutôt qu'un téléchargement. */
  async function share(): Promise<void> {
    const text = await backupText();
    if (text === null) return;
    const shared = await shareTextFile(backupFileName(), text);
    if (shared) toasts.push('Sauvegarde partagée.', 'success');
  }
  /** Restauration d'une sauvegarde chiffrée : le fichier attend sa phrase secrète. */
  let pendingEncrypted = $state<EncryptedBackup | null>(null);
  let restorePassphrase = $state('');
  let askPassphrase = $state(false);
  async function decryptAndRestore(): Promise<void> {
    if (!pendingEncrypted) return;
    try {
      const json = await decryptBackup(pendingEncrypted, restorePassphrase);
      askPassphrase = false;
      pendingEncrypted = null;
      restorePassphrase = '';
      applyRestore(json);
    } catch (error) {
      toasts.push(error instanceof Error ? error.message : String(error), 'error');
    }
  }
  const shareAvailable = canShareFiles();
  async function chooseFolder(): Promise<void> {
    try {
      if (await app.chooseBackupFolder())
        toasts.push(
          'Dossier choisi : la sauvegarde y sera réécrite à chaque modification.',
          'success',
        );
    } catch (error) {
      toasts.push(`Dossier refusé : ${String(error)}`, 'error');
    }
  }
  async function restore(file: File | undefined): Promise<void> {
    if (!file) return;
    const text = await file.text();
    const parsed = ((): unknown => {
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    })();
    if (isEncryptedBackup(parsed)) {
      pendingEncrypted = parsed;
      restorePassphrase = '';
      askPassphrase = true;
      return;
    }
    applyRestore(text);
  }
  function applyRestore(text: string): void {
    const result = app.restoreBackup(text, restoreMode);
    if (!result.ok) return toasts.push(result.error, 'error');
    toasts.push(
      result.report
        ? fmtMergeSummary(summarizeMergeReport(result.report))
        : 'Sauvegarde restaurée.',
      'success',
    );
    void app.refreshPrices();
    router.navigate({ name: 'overview' });
  }
  /**
   * Une clé saisie vaut demande de cotation : sans ce rafraîchissement, l'utilisateur colle sa clé
   * et rien ne bouge à l'écran — il n'a aucune raison de deviner qu'un second geste est attendu.
   */
  function saveKey(patch: Partial<UiSettings>): void {
    app.setUi(patch);
    void app.refreshPrices(true);
  }

  async function clearAll(): Promise<void> {
    // `eraseAll` et non `clearAll` : le second sert aussi à quitter la démo et ne touche pas au
    // cache d'historique de prix (décision n° 88).
    await app.eraseAll();
    confirmClear = false;
    toasts.push('Toutes les données locales ont été effacées.');
    router.navigate({ name: 'welcome' });
  }
</script>

<AppBar title="Réglages" back={app.hasData} />

<nav class="toc" aria-label="Sommaire des réglages">
  {#each SECTIONS as s (s.id)}
    <a
      href="#{s.id}"
      onclick={(e) => {
        e.preventDefault();
        openAndScroll(s.id);
      }}>{s.label}</a
    >
  {/each}
</nav>

<div class="settings">
  <details class="card group" id="donnees" open>
    <summary><h2>Données</h2></summary>
    <p class="muted small">
      Vos données ne sont que dans ce navigateur. Dernière sauvegarde : {app.state.ui.lastBackupAt
        ? fmtRelative(app.state.ui.lastBackupAt, nowMs())
        : 'jamais'}. Stockage persistant : {persistedStorage === null
        ? '?'
        : persistedStorage
          ? 'oui'
          : 'non garanti'}{#if storageEstimate}
        · {fmtBytes(storageEstimate.usage)} utilisés sur {fmtBytes(storageEstimate.quota)}
        disponibles{/if}.
    </p>
    {#if installable}
      <div class="row">
        <button class="secondary" type="button" onclick={() => void install()}
          >Installer l'application</button
        >
      </div>
    {/if}
    <div class="row">
      <button class="primary" type="button" onclick={() => void backup()}
        >Télécharger une sauvegarde (JSON)</button
      >
      {#if shareAvailable}
        <button class="secondary" type="button" onclick={() => void share()}
          >Partager vers Fichiers…</button
        >
      {/if}
    </div>
    <div class="row encrypt">
      <Switch
        checked={encrypt}
        onCheckedChange={(v) => (encrypt = v)}
        label="Chiffrer la sauvegarde avec une phrase secrète"
      />
      {#if encrypt}
        <input
          type="password"
          autocomplete="new-password"
          placeholder="Phrase secrète (8 caractères minimum)"
          aria-label="Phrase secrète"
          bind:value={passphrase}
        />
        <span class="muted small"
          >AES-GCM, clé dérivée de la phrase (PBKDF2, 600 000 itérations). La phrase n'est jamais
          enregistrée : perdue, la sauvegarde est illisible.</span
        >
      {/if}
    </div>
    {#if app.folderBackup.supported}
      <div class="row folder">
        {#if app.folderBackup.folderName === null}
          <button class="secondary" type="button" onclick={() => void chooseFolder()}
            >Sauvegarde automatique dans un dossier…</button
          >
          <span class="muted small"
            >Chrome et Edge sur ordinateur : le fichier <code>cout-revient-ch-sauvegarde.json</code>
            est réécrit dans le dossier choisi (par exemple OneDrive, Google Drive ou iCloud Drive) à
            chaque modification.</span
          >
        {:else}
          <span class="small"
            >Dossier de sauvegarde automatique : <strong>{app.folderBackup.folderName}</strong> ·
            {#if app.folderBackup.permission === 'granted'}
              {app.folderBackup.lastWriteAt
                ? `dernière écriture ${fmtRelative(app.folderBackup.lastWriteAt, nowMs())}`
                : 'en attente de la prochaine modification'}
            {:else}
              <span class="warn">permission requise</span>
            {/if}
            {#if app.folderBackup.error}<span class="warn"> · {app.folderBackup.error}</span>{/if}
          </span>
          {#if app.folderBackup.permission !== 'granted'}
            <button class="secondary" type="button" onclick={() => void app.reconnectBackupFolder()}
              >Reconnecter le dossier</button
            >
          {/if}
          <button class="link" type="button" onclick={() => void app.stopBackupFolder()}
            >Arrêter</button
          >
        {/if}
      </div>
    {/if}
    <div class="row">
      <label class="file"
        ><input
          type="file"
          accept=".json,application/json"
          onchange={(e) => void restore(e.currentTarget.files?.[0])}
        /><span class="secondary">Restaurer une sauvegarde…</span></label
      >
      <select bind:value={restoreMode} aria-label="Mode de restauration"
        ><option value="merge">en fusionnant</option><option value="replace"
          >en remplaçant tout</option
        ></select
      >
    </div>
    {#if restoreMode === 'merge'}
      <p class="muted small">
        En fusionnant : la version la plus récente de chaque élément l'emporte, quel que soit
        l'appareil qui l'a écrite ; les suppressions sont reportées. Les réglages et les cours en
        cache restent ceux de cet appareil ; les règles d'alerte, elles, sont fusionnées.
      </p>
    {/if}
    <p class="muted small">
      <strong>Sauvegarde JSON</strong> — tout, pour revenir ici. Comptes, réglages, alertes, journal.
      Le fichier qui vous fait retrouver exactement où vous en étiez, dans cette app.
    </p>
    <p class="muted small">
      <strong>Export portable (Koinly / Waltio)</strong> — l'essentiel de votre historique, pour un autre
      outil. Achats, ventes, récompenses, frais. Pas les comptes ni les réglages. Format documenté, vérifié
      par un test à chaque version : ce que vous exportez aujourd'hui se relit demain, ici ou ailleurs.
    </p>
    {#if portabilityGaps.length > 0}
      <ul class="gap-list small">
        {#each portabilityGaps as gap (gap.code)}
          <li>{fmtPortabilityGap(gap)}</li>
        {/each}
      </ul>
    {/if}
    <div class="row">
      <button
        class="secondary"
        type="button"
        disabled={!app.hasData}
        onclick={() => {
          const out = eventsToKoinlyCsv(app.events);
          downloadText(`cout-revient-ch-koinly-${stamp()}.csv`, out.csv, 'text/csv;charset=utf-8');
          if (out.skipped > 0)
            toasts.push(`${out.skipped} ligne(s) à qualifier laissée(s) de côté.`, 'info');
        }}>Format Koinly / Waltio (CSV)</button
      >
    </div>
    <div class="row">
      <button
        class="secondary"
        type="button"
        disabled={!app.hasData}
        onclick={() =>
          downloadText(
            `cout-revient-ch-positions-${stamp()}.csv`,
            positionsToCsv(app.report, app.currency),
            'text/csv;charset=utf-8',
          )}>Positions (CSV)</button
      >
      <button
        class="secondary"
        type="button"
        disabled={!app.hasData}
        onclick={() =>
          downloadText(
            `cout-revient-ch-operations-${stamp()}.csv`,
            operationsToCsv(app.report, app.currency, undefined, app.accountLabels),
            'text/csv;charset=utf-8',
          )}>Opérations avec PRU (CSV)</button
      >
      <button
        class="secondary"
        type="button"
        disabled={!app.hasData}
        onclick={() =>
          downloadText(
            `cout-revient-ch-lots-${stamp()}.csv`,
            lotsToCsv(app.report, app.currency),
            'text/csv;charset=utf-8',
          )}>Lots ouverts (CSV)</button
      >
    </div>
    <div class="row">
      <button
        class="secondary"
        type="button"
        onclick={() => router.navigate({ name: 'report' })}
        disabled={!app.hasData}>Rapport PDF (imprimable)</button
      >
    </div>
  </details>

  <details class="card group" id="prix" open={!collapsed}>
    <summary><h2>Prix</h2></summary>
    <label class="field"
      >Source des prix
      <select
        value={app.state.ui.priceSource}
        onchange={(e) => app.setUi({ priceSource: e.currentTarget.value as 'auto' | 'off' })}
      >
        <option value="auto"
          >Automatique (CoinGecko, Coinbase, Kraken, Hyperliquid, DefiLlama, Twelve Data)</option
        >
        <option value="off">Désactivés (prix manuels uniquement)</option>
      </select>
    </label>
    <label class="field"
      >Clé CoinGecko « Demo » (facultative)
      <input
        type="text"
        autocomplete="off"
        autocapitalize="off"
        spellcheck={false}
        placeholder="CG-…"
        value={app.state.ui.coingeckoDemoKey ?? ''}
        onchange={(e) => saveKey({ coingeckoDemoKey: e.currentTarget.value.trim() || null })}
      />
    </label>
    <p class="line small muted">
      Gratuite sur coingecko.com, elle lève les limites de débit du plan public. Elle reste sur cet
      appareil, envoyée à CoinGecko uniquement.
    </p>
    <label class="field"
      >Clé Twelve Data (facultative)
      <input
        type="text"
        autocomplete="off"
        autocapitalize="off"
        spellcheck={false}
        placeholder="32 caractères"
        value={app.state.ui.twelveDataApiKey ?? ''}
        onchange={(e) => saveKey({ twelveDataApiKey: e.currentTarget.value.trim() || null })}
      />
    </label>
    <p class="line small muted">
      Gratuite sur twelvedata.com, elle seule permet de coter vos actions et vos ETF : aucune source
      crypto ne les connaît. Sans elle, ces actifs restent au prix que vous saisissez vous-même.
      Elle reste sur cet appareil, envoyée à Twelve Data uniquement. Son palier gratuit ne cote que
      les places américaines.
    </p>
    <label class="field"
      >Clé Alpha Vantage (facultative)
      <input
        type="text"
        autocomplete="off"
        autocapitalize="off"
        spellcheck={false}
        placeholder="16 caractères"
        value={app.state.ui.alphaVantageApiKey ?? ''}
        onchange={(e) => saveKey({ alphaVantageApiKey: e.currentTarget.value.trim() || null })}
      />
    </label>
    <p class="line small muted">
      Gratuite sur alphavantage.co, elle prend le relais sur <strong>les titres européens</strong> — Paris
      et Francfort — que la précédente laisse sans cours. Vingt-cinq cotations par jour, cinq par minute
      : de quoi suivre une poignée de lignes, pas un portefeuille entier. Elle reste sur cet appareil,
      envoyée à Alpha Vantage uniquement.
    </p>
    <label class="field"
      >Explorateur de blocs (comptes on-chain EVM)
      <select
        value={app.state.ui.explorerFlavor}
        onchange={(e) =>
          app.setUi({ explorerFlavor: e.currentTarget.value as UiSettings['explorerFlavor'] })}
      >
        {#each KEYED_FLAVORS as flavor (flavor)}
          <option value={flavor}>{FLAVOR_LABELS[flavor]}</option>
        {/each}
      </select>
    </label>
    <label class="field"
      >Clé d'explorateur (facultative)
      <input
        type="text"
        autocomplete="off"
        autocapitalize="off"
        spellcheck={false}
        placeholder="jeton de lecture"
        value={app.state.ui.explorerKey ?? ''}
        onchange={(e) => app.setUi({ explorerKey: e.currentTarget.value.trim() || null })}
      />
    </label>
    <p class="line small muted">
      <strong>Clé publique de lecture seule : elle ne donne accès à aucun fonds</strong> et ne lit que
      des données de la blockchain déjà visibles de tous — rien à voir avec une clé d'exchange, que cette
      application refuse par principe. Elle sert de secours : l'API Blockscout publique, utilisée par
      défaut sans aucune clé, a été officiellement basculée vers une offre à clé le 1ᵉʳ juillet 2026 et
      peut s'arrêter. Elle lève aussi le plafond de pagination et fait apparaître les fonds reçus via
      un contrat.
    </p>
    {#each manualPrices as [asset, s] (asset)}
      <p class="line small">
        Prix manuel {asset.toUpperCase()} : {fmtPrice(D(s.manualPriceEur ?? '0'), 'EUR')}
        <button class="link" type="button" onclick={() => app.setManualPrice(asset, null)}
          >supprimer</button
        >
      </p>
    {/each}
  </details>

  <details class="card group" id="affichage" open={!collapsed}>
    <summary><h2>Affichage</h2></summary>
    <label class="field"
      >Thème
      <select
        value={app.state.ui.theme}
        onchange={(e) => app.setUi({ theme: e.currentTarget.value as 'auto' | 'dark' | 'light' })}
      >
        <option value="auto">Automatique</option><option value="dark">Sombre</option><option
          value="light">Clair</option
        >
      </select>
    </label>
    <label class="field"
      >Devise d'affichage
      <select
        value={app.state.ui.displayCurrency}
        onchange={(e) => app.setCurrency(e.currentTarget.value as 'EUR' | 'USD')}
      >
        <option value="EUR">Euro (€) — devise des données</option>
        <option value="USD">Dollar ($) — chaque mouvement converti au taux BCE du jour</option>
      </select>
    </label>
    {#if app.state.ui.displayCurrency !== 'EUR' && app.currency === 'EUR'}
      <p class="warn small" role="status">
        Taux BCE {app.state.ui.displayCurrency} indisponibles{#if app.fxStatus.error}&nbsp;({app
            .fxStatus.error}){/if} : les montants restent affichés en euros.
      </p>
    {:else if app.state.ui.displayCurrency !== 'EUR' && app.fxStatus.error}
      <p class="warn small" role="status">
        Mise à jour des taux BCE impossible ({app.fxStatus.error}) : derniers taux connus utilisés{#if app.fxLookup.latestDay},
          jusqu'au {fmtDate(app.fxLookup.latestDay)}{/if}.
      </p>
    {/if}
    <Switch
      checked={app.state.ui.discreet}
      onCheckedChange={(v) => app.setUi({ discreet: v })}
      label="Mode discret (masquer les montants)"
    />
    <Switch
      checked={app.state.ui.hideClosed}
      onCheckedChange={(v) => app.setUi({ hideClosed: v })}
      label="Masquer les positions clôturées"
    />
    <Switch
      checked={app.state.ui.marketContext}
      onCheckedChange={(v) => {
        app.setUi({ marketContext: v });
        if (v) void app.refreshMarketContext();
      }}
      label="Contexte de marché (indice Fear & Greed)"
    />
    <p class="muted small">
      Ajoute un appel à <strong>alternative.me</strong> pour afficher l'indice de sentiment du marché
      sur la Vue d'ensemble. Aucune de vos données n'est envoyée : la requête ne contient rien d'autre
      que la demande de l'indice du jour, identique pour tout le monde.
    </p>
  </details>

  <EngineSettings />

  {#if __PRIVATE_BUILD__}
    <NetworkSection />
  {/if}

  <VaultSection onBackup={backup} />

  <AiSection />

  <details class="card group" id="verifications" open={!collapsed}>
    <summary><h2>Vérifications automatiques</h2></summary>
    <p class="muted small">
      L’application contrôle ses propres chiffres à chaque affichage : cohérence comptable, lots,
      soldes de votre export, prix, sauvegarde. Un voyant rouge est une anomalie à signaler.
    </p>
    <SelfChecks />
  </details>

  <details class="card group" id="aide" open={!collapsed}>
    <summary><h2>Aide et retours</h2></summary>
    <SupportSection
      intro="Un fichier refusé, un chiffre douteux, une idée ? Copiez le diagnostic (il ne contient ni montant ni quantité) et collez-le dans votre message."
    />
  </details>

  <SourcesSection />

  <details class="card group danger" id="danger">
    <summary><h2>Zone dangereuse</h2></summary>
    <button class="secondary" type="button" onclick={() => (confirmClear = true)}
      >Effacer toutes les données</button
    >
  </details>

  <p class="muted small center">
    <a href={router.href({ name: 'help' })}>Aide</a> ·
    <a href={router.href({ name: 'privacy' })}>Confidentialité</a>
    · <a href={router.href({ name: 'news' })}>Nouveautés</a> · version {__APP_VERSION__}
  </p>
</div>

<Sheet bind:open={confirmClear} title="Effacer toutes les données ?">
  <p>
    Cette action supprime l'historique importé, vos saisies et vos réglages de ce navigateur.
    Avez-vous une sauvegarde ?
  </p>
  <div class="row">
    <button class="secondary" type="button" onclick={() => void backup()}
      >Télécharger d'abord</button
    ><button class="primary danger" type="button" onclick={() => void clearAll()}>Effacer</button>
  </div>
</Sheet>

<Sheet bind:open={askPassphrase} title="Sauvegarde chiffrée">
  <p>Ce fichier a été chiffré avec une phrase secrète : saisissez-la pour le restaurer.</p>
  <form
    onsubmit={(e) => {
      e.preventDefault();
      void decryptAndRestore();
    }}
  >
    <input
      type="password"
      autocomplete="current-password"
      placeholder="Phrase secrète"
      aria-label="Phrase secrète de la sauvegarde"
      bind:value={restorePassphrase}
    />
    <button class="primary" type="submit">Déchiffrer et restaurer</button>
  </form>
</Sheet>

<style>
  .toc {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-3);
    padding: var(--space-3);
    max-width: 640px;
    margin: 0 auto;
    font-size: var(--fs-xs);
  }
  /* Cible ≥ 24 px de zone (WCAG 2.2 SC 2.5.8) : à `--fs-xs` sans padding, chaque lien ne mesurait
     que 17 px de haut — trouvé par la mesure avant/après de P124, pas par une intuition. */
  .toc a {
    display: inline-flex;
    align-items: center;
    min-height: 24px;
    padding: 2px 0;
    color: var(--fg-muted);
  }
  .settings {
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
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
    margin-top: var(--space-2);
  }
  .field {
    display: grid;
    gap: 4px;
    font-size: var(--fs-sm);
    color: var(--fg-muted);
  }
  select {
    min-height: var(--tap);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--fg);
    padding: 0 var(--space-3);
    /* Un <select> prend la largeur de sa plus longue option : sans plafond, la page déborde sur
       mobile et le navigateur dézoome toute l'interface. */
    width: 100%;
    max-width: 100%;
    min-width: 0;
  }
  .field,
  .row {
    min-width: 0;
  }
  .row select {
    width: auto;
    flex: 1 1 12rem;
  }
  .file input {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
  }
  .primary.danger {
    background: var(--loss);
    color: #fff;
  }
  .danger h2 {
    color: var(--loss);
  }
  .link {
    color: var(--accent);
    text-decoration: underline;
  }
  .folder {
    flex-wrap: wrap;
    align-items: center;
  }
  .encrypt {
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2);
  }
  .folder code {
    font-size: var(--fs-xs);
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
  .line {
    margin: 0;
  }
  .gap-list {
    margin: 0;
    padding-left: var(--space-4);
    display: grid;
    gap: 4px;
    color: var(--fg-muted);
  }
</style>
