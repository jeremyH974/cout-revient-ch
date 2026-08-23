<script lang="ts">
  import { nowMs } from '$lib/clock';
  import { lotsToCsv, operationsToCsv, positionsToCsv } from '$lib/export/csv-export';
  import { downloadText } from '$lib/export/download';
  import { fmtRelative } from '$lib/format/fr';
  import { router } from '$lib/router.svelte';
  import AppBar from '../components/layout/AppBar.svelte';
  import EngineSettings from '../components/settings/EngineSettings.svelte';
  import SupportSection from '../components/settings/SupportSection.svelte';
  import Sheet from '../components/shared/Sheet.svelte';
  import { app } from '../state/app.svelte';
  import { toasts } from '../state/ui.svelte';

  let restoreMode = $state<'replace' | 'merge'>('merge');
  let confirmClear = $state(false);
  let persisted = $state<boolean | null>(null);
  $effect(() => {
    void navigator.storage?.persisted?.().then((v) => (persisted = v));
  });
  const stamp = (): string => new Date(nowMs()).toISOString().slice(0, 10);
  const manualPrices = $derived(
    Object.entries(app.state.assetSettings).filter(([, s]) => s.manualPriceEur),
  );

  function backup(): void {
    const prefix = app.state.ui.demoMode ? 'demo-' : '';
    downloadText(
      `${prefix}cout-revient-ch-sauvegarde-${stamp()}.json`,
      app.exportBackup(),
      'application/json',
    );
    toasts.push('Sauvegarde téléchargée.', 'success');
  }
  async function restore(file: File | undefined): Promise<void> {
    if (!file) return;
    const result = app.restoreBackup(await file.text(), restoreMode);
    if (!result.ok) return toasts.push(result.error, 'error');
    toasts.push(
      restoreMode === 'replace' ? 'Sauvegarde restaurée.' : 'Sauvegarde fusionnée.',
      'success',
    );
    void app.refreshPrices();
    router.navigate({ name: 'portfolio' });
  }
  function clearAll(): void {
    app.clearAll();
    confirmClear = false;
    toasts.push('Toutes les données locales ont été effacées.');
    router.navigate({ name: 'welcome' });
  }
</script>

<AppBar title="Réglages" back={app.hasData} />

<div class="settings">
  <section class="card group">
    <h2>Données</h2>
    <p class="muted small">
      Vos données ne sont que dans ce navigateur. Dernière sauvegarde : {app.state.ui.lastBackupAt
        ? fmtRelative(app.state.ui.lastBackupAt, nowMs())
        : 'jamais'}. Stockage persistant : {persisted === null
        ? '?'
        : persisted
          ? 'oui'
          : 'non garanti'}.
    </p>
    <div class="row">
      <button class="primary" type="button" onclick={backup}
        >Télécharger une sauvegarde (JSON)</button
      >
    </div>
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
            operationsToCsv(app.report, app.currency),
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
  </section>

  <section class="card group">
    <h2>Prix</h2>
    <label class="field"
      >Source des prix
      <select
        value={app.state.ui.priceSource}
        onchange={(e) => app.setUi({ priceSource: e.currentTarget.value as 'auto' | 'off' })}
      >
        <option value="auto">Automatique (CoinGecko, puis Coinbase)</option>
        <option value="off">Désactivés (prix manuels uniquement)</option>
      </select>
    </label>
    {#each manualPrices as [asset, s] (asset)}
      <p class="line small">
        Prix manuel {asset.toUpperCase()} : {s.manualPriceEur} €
        <button class="link" type="button" onclick={() => app.setManualPrice(asset, null)}
          >supprimer</button
        >
      </p>
    {/each}
  </section>

  <section class="card group">
    <h2>Affichage</h2>
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
    <label class="check"
      ><input
        type="checkbox"
        checked={app.state.ui.discreet}
        onchange={(e) => app.setUi({ discreet: e.currentTarget.checked })}
      /> Mode discret (masquer les montants)</label
    >
    <label class="check"
      ><input
        type="checkbox"
        checked={app.state.ui.hideClosed}
        onchange={(e) => app.setUi({ hideClosed: e.currentTarget.checked })}
      /> Masquer les positions clôturées</label
    >
  </section>

  <EngineSettings />

  <section class="card group">
    <h2>Aide et retours</h2>
    <SupportSection
      intro="Un fichier refusé, un chiffre douteux, une idée ? Copiez le diagnostic (il ne contient ni montant ni quantité) et collez-le dans votre message."
    />
  </section>

  <section class="card group danger">
    <h2>Zone dangereuse</h2>
    <button class="secondary" type="button" onclick={() => (confirmClear = true)}
      >Effacer toutes les données</button
    >
  </section>

  <p class="muted small center">
    <a href={router.href({ name: 'help' })}>Aide</a> ·
    <a href={router.href({ name: 'privacy' })}>Confidentialité</a>
    · version {__APP_VERSION__}
  </p>
</div>

<Sheet bind:open={confirmClear} title="Effacer toutes les données ?">
  <p>
    Cette action supprime l'historique importé, vos saisies et vos réglages de ce navigateur.
    Avez-vous une sauvegarde ?
  </p>
  <div class="row">
    <button class="secondary" type="button" onclick={backup}>Télécharger d'abord</button><button
      class="primary danger"
      type="button"
      onclick={clearAll}>Effacer</button
    >
  </div>
</Sheet>

<style>
  .settings {
    padding: var(--space-3);
    display: grid;
    gap: var(--space-3);
    max-width: 640px;
    margin: 0 auto;
  }
  .group {
    padding: var(--space-4);
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
  .check {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    min-height: var(--tap);
    font-size: var(--fs-sm);
  }
  select {
    min-height: var(--tap);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--fg);
    padding: 0 var(--space-3);
  }
  .file input {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
  }
  .primary,
  .secondary {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: var(--tap);
    padding: 0 var(--space-4);
    border-radius: var(--radius-sm);
    font-weight: 700;
    cursor: pointer;
  }
  .primary {
    background: var(--accent);
    color: var(--accent-fg);
  }
  .primary.danger {
    background: var(--loss);
    color: #fff;
  }
  .secondary {
    border: 1px solid var(--border);
    color: var(--fg);
  }
  .secondary:disabled {
    opacity: 0.5;
  }
  .danger h2 {
    color: var(--loss);
  }
  .link {
    color: var(--accent);
    text-decoration: underline;
  }
  .small {
    font-size: var(--fs-xs);
  }
  .center {
    text-align: center;
  }
  .line {
    margin: 0;
  }
</style>
