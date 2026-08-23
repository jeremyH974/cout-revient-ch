<script lang="ts">
  import type { ImportReport } from '$lib/import/coinhouse/index';
  import { parseCsvText } from '$lib/import/csv';
  import { detectPivotFormat, type PivotFormat } from '$lib/import/pivot/detect';
  import type { PivotImportReport } from '$lib/import/pivot/index';
  import { downloadText } from '$lib/export/download';
  import { fmtDate } from '$lib/format/fr';
  import { router } from '$lib/router.svelte';
  import AppBar from '../../components/layout/AppBar.svelte';
  import SupportSection from '../../components/settings/SupportSection.svelte';
  import { app } from '../../state/app.svelte';
  import { toasts } from '../../state/ui.svelte';

  let busy = $state(false);
  let dragging = $state(false);
  let report = $state<ImportReport | null>(null);
  let pivotReport = $state<PivotImportReport | null>(null);
  let failure = $state<{ error: string; details: string[]; header: string[] } | null>(null);
  let backupDone = $state(false);

  /** Fichier pivot détecté, en attente du choix du compte de destination (rien n'est importé). */
  let pending = $state<{ text: string; fileName: string; format: PivotFormat } | null>(null);
  let targetAccount = $state<string>('new');
  let newLabel = $state('');

  const csvAccounts = $derived(app.accounts.filter((a) => a.kind === 'csv'));
  const formatLabel = (format: PivotFormat): string =>
    format === 'koinly-universal' ? 'CSV Koinly « Universal »' : 'export Koinly (From/To)';

  async function handleFile(file: File | undefined): Promise<void> {
    if (!file) return;
    busy = true;
    failure = null;
    report = null;
    pivotReport = null;
    pending = null;
    try {
      const text = await file.text();
      const result = app.importCsv(text, file.name);
      if (result.ok) {
        report = result.report;
        toasts.push(`${result.report.newRows} nouvelle(s) ligne(s) importée(s).`, 'success');
        void app.refreshPrices();
        return;
      }
      // Pas un export Coinhouse : peut-être un CSV pivot (Koinly « Universal » ou export Koinly).
      const pivot = detectPivotFormat(parseCsvText(text).header);
      if (pivot.ok) {
        pending = { text, fileName: file.name, format: pivot.format };
        targetAccount = csvAccounts[0]?.id ?? 'new';
        newLabel = file.name.replace(/\.csv$/i, '').slice(0, 60);
        return;
      }
      failure = {
        error: result.error,
        details: [
          ...result.details,
          'Formats acceptés : export avancé Coinhouse, CSV Koinly « Universal », export Koinly (Bulk edit → Export), lus aussi par Waltio.',
        ],
        header: result.header,
      };
    } catch (error) {
      failure = { error: 'Lecture du fichier impossible.', details: [String(error)], header: [] };
    } finally {
      busy = false;
    }
  }

  function confirmPivot(): void {
    if (!pending) return;
    busy = true;
    try {
      const accountId =
        targetAccount === 'new'
          ? app.addPivotAccount(newLabel || pending.fileName).id
          : targetAccount;
      const result = app.importPivot(pending.text, pending.fileName, accountId);
      if (result.ok) {
        pivotReport = result.report;
        pending = null;
        toasts.push(`${result.report.newRows} nouvelle(s) ligne(s) importée(s).`, 'success');
        void app.refreshPrices();
      } else {
        failure = { error: result.error, details: result.details, header: result.header };
        pending = null;
      }
    } finally {
      busy = false;
    }
  }

  function downloadBackup(): void {
    const prefix = app.state.ui.demoMode ? 'demo-' : '';
    downloadText(
      `${prefix}cout-revient-ch-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`,
      app.exportBackup(),
      'application/json',
    );
    backupDone = true;
  }

  const integrityAlerts = $derived(
    [
      ...app.report.positions,
      ...app.report.stablecoins,
      ...app.report.closed,
      ...app.report.blocked,
    ]
      .filter((p) => p.integrity && p.integrity.status !== 'ok')
      .map((p) => p.integrity!.message),
  );
</script>

<AppBar title="Importer" back={app.hasData} />

<div class="page">
  {#if app.state.ui.demoMode}
    <p class="demo-note" role="note">
      Vous êtes en démo : importer votre fichier remplacera les données d’exemple par vos
      opérations.
    </p>
  {/if}
  <label
    class="drop"
    class:dragging
    ondragover={(e) => {
      e.preventDefault();
      dragging = true;
    }}
    ondragleave={() => (dragging = false)}
    ondrop={(e) => {
      e.preventDefault();
      dragging = false;
      void handleFile(e.dataTransfer?.files[0]);
    }}
  >
    <input
      type="file"
      accept=".csv,text/csv"
      disabled={busy}
      onchange={(e) => void handleFile(e.currentTarget.files?.[0])}
    />
    <span class="big">{busy ? 'Analyse en cours…' : 'Choisir le fichier .csv'}</span>
    <span class="muted small"
      >Export Coinhouse (Vos transactions → Exporter → Export avancé) ou CSV au format Koinly /
      Waltio pour vos autres plateformes. Glissez-déposez ou touchez pour choisir.</span
    >
  </label>

  {#if pending}
    <section class="card block">
      <h2>Fichier {formatLabel(pending.format)} reconnu</h2>
      <p class="small">
        « {pending.fileName} » sera importé dans un compte de l'espace Investissement (PRU par compte
        et consolidé). Choisissez sa destination :
      </p>
      <fieldset class="accounts">
        <legend class="sr-only">Compte de destination</legend>
        {#each csvAccounts as account (account.id)}
          <label class="choice">
            <input type="radio" name="target" value={account.id} bind:group={targetAccount} />
            <span>{account.label} <span class="muted small">(existant)</span></span>
          </label>
        {/each}
        <label class="choice">
          <input type="radio" name="target" value="new" bind:group={targetAccount} />
          <span>Nouveau compte</span>
        </label>
        {#if targetAccount === 'new'}
          <label class="choice indent">
            <span class="sr-only">Nom du nouveau compte</span>
            <input
              type="text"
              maxlength="60"
              placeholder="Nom du compte (ex. Ledger, Kraken…)"
              bind:value={newLabel}
            />
          </label>
        {/if}
      </fieldset>
      <div class="actions">
        <button class="primary" type="button" disabled={busy} onclick={confirmPivot}
          >Importer dans ce compte</button
        >
        <button class="secondary" type="button" onclick={() => (pending = null)}>Annuler</button>
      </div>
    </section>
  {/if}

  {#if failure}
    <section class="card block error">
      <h2>{failure.error}</h2>
      <ul>
        {#each failure.details as d (d)}<li>{d}</li>{/each}
      </ul>
      <p class="small">
        Colonnes attendues : ID Coinhouse, Date, Type, Quantité, Devise, Prix du marché,
        Contre-valeur (EUR)… Si vous avez ouvert le fichier dans Excel, ré-importez la pièce jointe
        d'origine.
      </p>
      <SupportSection
        failure={{ error: failure.error, header: failure.header }}
        intro="Fichier non reconnu ? Copiez le diagnostic (il contient les colonnes trouvées, jamais vos montants) et signalez-le : l'export Coinhouse a peut-être changé."
      />
    </section>
  {/if}

  {#if pivotReport}
    <section class="card block">
      <h2>Import réussi</h2>
      <p>
        <strong>{pivotReport.counts.trades}</strong> achats/ventes/échanges ·
        <strong>{pivotReport.assets.length}</strong> actifs
        {#if pivotReport.period}· du {fmtDate(pivotReport.period.from)} au {fmtDate(
            pivotReport.period.to,
          )}{/if}
        {#if pivotReport.counts.rewards > 0}· {pivotReport.counts.rewards} récompense(s){/if}
        {#if pivotReport.counts.deposits > 0}· {pivotReport.counts.deposits} dépôt(s){/if}
        {#if pivotReport.counts.withdrawals > 0}· {pivotReport.counts.withdrawals} retrait(s){/if}
        {#if pivotReport.counts.fees > 0}· {pivotReport.counts.fees} frais{/if}
      </p>
      <p class="small muted">
        {pivotReport.newRows} nouvelle(s) ligne(s) · {pivotReport.duplicateRows} déjà connue(s), ignorée(s)
        {#if pivotReport.counts.skippedCash > 0}· {pivotReport.counts.skippedCash} ligne(s) 100 % fiat
          hors modèle{/if}
        {#if pivotReport.conflictingRows > 0}· <span class="warn"
            >{pivotReport.conflictingRows} en conflit (version existante conservée)</span
          >{/if}
        {#if pivotReport.counts.unqualified > 0}· <span class="warn"
            >{pivotReport.counts.unqualified} opération(s) à qualifier</span
          >{/if}
      </p>
      {#if app.transferPairing.pairs.length > 0}
        <p class="small">
          {app.transferPairing.pairs.length} virement(s) interne(s) apparié(s) entre vos comptes : le
          coût d'acquisition voyage, aucune plus-value fantôme. Détail dans le
          <a href={router.href({ name: 'report' })}>Rapport</a>.
        </p>
      {/if}
      {#if pivotReport.warnings.length > 0 || pivotReport.issues.length > 0}
        <details>
          <summary
            >Avertissements ({pivotReport.warnings.length + pivotReport.issues.length})</summary
          >
          <ul class="small">
            {#each pivotReport.warnings as w (w)}<li>{w}</li>{/each}
            {#each pivotReport.issues as i (i.lineNo + i.message)}<li>
                Ligne {i.lineNo} : {i.message}
              </li>{/each}
          </ul>
        </details>
      {/if}
      <div class="actions">
        <a class="primary" href={router.href({ name: 'portfolio' })}>Voir mon portefeuille</a>
      </div>
    </section>
  {/if}

  {#if report}
    <section class="card block">
      <h2>Import réussi</h2>
      <p>
        <strong>{report.counts.trades}</strong> achats/ventes ·
        <strong>{report.assets.length}</strong>
        actifs
        {#if report.period}· du {fmtDate(report.period.from)} au {fmtDate(report.period.to)}{/if}
        {#if report.counts.fees > 0}· {report.counts.fees} abonnement(s){/if}
        {#if report.counts.migrations > 0}· {report.counts.migrations} migration(s){/if}
      </p>
      <p class="small muted">
        {report.newRows} nouvelle(s) ligne(s) · {report.duplicateRows} déjà connue(s), ignorée(s)
        {#if report.conflictingRows > 0}· <span class="warn"
            >{report.conflictingRows} en conflit (version existante conservée)</span
          >{/if}
        {#if report.counts.unqualified > 0}· <span class="warn"
            >{report.counts.unqualified} opération(s) à qualifier</span
          >{/if}
      </p>
      {#if report.warnings.length > 0 || report.issues.length > 0 || integrityAlerts.length > 0}
        <details>
          <summary
            >Avertissements ({report.warnings.length +
              report.issues.length +
              integrityAlerts.length})</summary
          >
          <ul class="small">
            {#each report.warnings as w (w)}<li>{w}</li>{/each}
            {#each report.issues as i (i.lineNo + i.message)}<li>
                Ligne {i.lineNo} : {i.message}
              </li>{/each}
            {#each integrityAlerts as a (a)}<li>{a}</li>{/each}
          </ul>
        </details>
      {/if}
      <div class="actions">
        <a class="primary" href={router.href({ name: 'portfolio' })}>Voir mon portefeuille</a>
      </div>
    </section>
  {/if}

  {#if report || pivotReport}
    <section class="card block nudge">
      <h2>Sauvegardez vos données</h2>
      <p class="small">
        Vos données vivent uniquement dans ce navigateur. Si vous videz les données de navigation ou
        changez d'appareil, elles disparaissent. Une sauvegarde JSON se restaure en un clic depuis
        les réglages.
      </p>
      <div class="actions">
        <button class="secondary" type="button" onclick={downloadBackup}
          >{backupDone ? 'Sauvegarde téléchargée ✓' : 'Télécharger une sauvegarde'}</button
        >
      </div>
    </section>
  {/if}
</div>

<style>
  .page {
    padding: var(--space-3);
    display: grid;
    gap: var(--space-3);
    max-width: 720px;
    margin: 0 auto;
  }
  .drop {
    display: grid;
    gap: var(--space-2);
    justify-items: center;
    text-align: center;
    padding: var(--space-6) var(--space-4);
    border: 2px dashed var(--border);
    border-radius: var(--radius);
    cursor: pointer;
    background: var(--bg-elev);
  }
  .drop.dragging {
    border-color: var(--accent);
  }
  .drop input {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
  }
  .big {
    font-size: var(--fs-lg);
    font-weight: 700;
    color: var(--accent);
  }
  .small {
    font-size: var(--fs-sm);
  }
  .block {
    padding: var(--space-4);
    display: grid;
    gap: var(--space-2);
  }
  .error {
    border-color: var(--loss);
  }
  .warn {
    color: var(--warn);
  }
  .nudge {
    border-color: var(--warn);
  }
  .demo-note {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--warn);
    border-radius: var(--radius-sm);
    color: var(--warn);
    font-size: var(--fs-sm);
  }
  .accounts {
    display: grid;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    border: 0;
  }
  .choice {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--tap);
  }
  .choice input[type='text'] {
    flex: 1;
    min-height: var(--tap);
    padding: 0 var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--fg);
  }
  .choice.indent {
    margin-left: var(--space-5);
  }
  .actions {
    margin-top: var(--space-2);
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
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
    text-decoration: none;
  }
  .primary {
    background: var(--accent);
    color: var(--accent-fg);
    border: 0;
    cursor: pointer;
  }
  .secondary {
    border: 1px solid var(--border);
    background: none;
    color: var(--fg);
    cursor: pointer;
  }
  ul {
    margin: 0;
    padding-left: var(--space-4);
  }
</style>
