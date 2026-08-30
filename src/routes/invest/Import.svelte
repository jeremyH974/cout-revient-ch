<script lang="ts">
  import type { ImportReport } from '$lib/import/coinhouse/index';
  import { parseCsvText } from '$lib/import/csv';
  import { detectPivotFormat } from '$lib/import/pivot/detect';
  import type { ImportedFormat, PivotImportReport } from '$lib/import/pivot/index';
  import {
    ACCEPTED_FORMATS_HINT,
    FORMAT_LABELS,
    PLATFORM_CONVERTERS,
  } from '$lib/import/platforms/index';
  import { downloadText } from '$lib/export/download';
  import { countryName } from '$lib/format/declarations-fr';
  import { fmtDate } from '$lib/format/fr';
  import { refusalText } from '$lib/format/ai';
  import { router } from '$lib/router.svelte';
  import { buildRequest, type AiOutcome } from '$lib/ai/contract';
  import { runMapping } from '$lib/ai/mapping';
  import { ANTHROPIC_MODEL_ID, anthropicAdapter } from '$lib/net/anthropic';
  import { msToParisNaive } from '$lib/import/time';
  import {
    buildColumnMappingInput,
    confirmedMapping,
    contextOf,
    firstFailure,
    mergeModelMapping,
    proposeMapping,
    verifyMapping,
    type ConfirmedMapping,
    type MappingProposal,
    type MappingTarget,
    type ModelMapping,
  } from '$lib/import/mapping/index';
  import { TYPE_TARGETS } from '$lib/import/mapping/labels';
  import AppBar from '../../components/layout/AppBar.svelte';
  import ColumnMapping from '../../components/import/ColumnMapping.svelte';
  import ConsentSheet from '../../components/ai/ConsentSheet.svelte';
  import SupportSection from '../../components/settings/SupportSection.svelte';
  import { aiKey } from '../../state/ai-key.svelte';
  import { app } from '../../state/app.svelte';
  import { toasts } from '../../state/ui.svelte';

  let busy = $state(false);
  let dragging = $state(false);
  let report = $state<ImportReport | null>(null);
  let pivotReport = $state<PivotImportReport | null>(null);
  let failure = $state<{ error: string; details: string[]; header: string[] } | null>(null);
  let backupDone = $state(false);

  /** Fichier reconnu, en attente du choix du compte de destination (rien n'est importé). */
  let pending = $state<{
    text: string;
    fileName: string;
    format: ImportedFormat;
    kind: 'csv' | 'ghostfolio' | 'mapped';
  } | null>(null);
  let targetAccount = $state<string>('new');
  let newLabel = $state('');

  /** Dernier import réussi : c'est lui que « Annuler cet import » retire (P64, arbitrage n° 4). */
  let lastImportId = $state<string | null>(null);

  // --- Appariement de colonnes (P64) ------------------------------------------------------------
  /** Proposition courante : déterministe, éventuellement complétée par le modèle. */
  let proposal = $state<MappingProposal | null>(null);
  let mappedColumns = $state<Partial<Record<MappingTarget, number>>>({});
  let mappedTypes = $state<Record<string, string>>({});
  let consentOpen = $state(false);
  let modelOutcome = $state<AiOutcome<ModelMapping> | null>(null);

  const aiModelId = $derived(app.state.ui.aiModelId ?? ANTHROPIC_MODEL_ID);
  const modelReady = $derived(app.state.ui.aiEnabled && aiKey.present);

  /** L'appariement tel qu'il sera importé : ce que l'écran affiche, au champ près. */
  const currentMapping = $derived<ConfirmedMapping>(
    proposal === null
      ? { columns: {}, typeLabels: {} }
      : proposal.impliedCurrencies === undefined ||
          Object.keys(proposal.impliedCurrencies).length === 0
        ? { columns: mappedColumns, typeLabels: mappedTypes }
        : {
            columns: mappedColumns,
            typeLabels: mappedTypes,
            impliedCurrencies: proposal.impliedCurrencies,
          },
  );

  /**
   * Le verdict du vérificateur, recalculé à CHAQUE changement de l'utilisateur. C'est ce qui rend
   * la correction d'une ligne immédiatement lisible : inverser deux colonnes fait rougir « Sens
   * des opérations » avant l'import, pas après.
   */
  const verdict = $derived(
    proposal === null || pending === null
      ? null
      : verifyMapping(
          currentMapping,
          contextOf(parseCsvText(pending.text), proposal, (day) => app.usdRate(day)),
        ),
  );

  const mappingPayload = $derived(
    proposal === null || pending === null
      ? null
      : buildColumnMappingInput(parseCsvText(pending.text), proposal),
  );
  const mappingRequest = $derived(
    mappingPayload === null
      ? { system: '', user: '' }
      : buildRequest('column-mapping', mappingPayload.input),
  );

  const rememberedAt = $derived(
    pending === null || targetAccount === 'new'
      ? null
      : (app.state.accounts[targetAccount]?.columnMapping?.confirmedAt ?? null),
  );

  const csvAccounts = $derived(app.accounts.filter((a) => a.kind === 'csv'));
  const formatLabel = (format: ImportedFormat): string => FORMAT_LABELS[format];

  /** Prépare l'import : le fichier attend le choix du compte de destination. */
  function stage(
    text: string,
    fileName: string,
    format: ImportedFormat,
    kind: 'csv' | 'ghostfolio' | 'mapped',
  ): void {
    pending = { text, fileName, format, kind };
    targetAccount = csvAccounts[0]?.id ?? 'new';
    newLabel = fileName.replace(/\.(csv|json)$/i, '').slice(0, 60);
    proposal = null;
    modelOutcome = null;
    if (kind !== 'mapped') return;
    const table = parseCsvText(text);
    const proposed = proposeMapping(table);
    proposal = proposed;
    applyRemembered();
  }

  /**
   * Repose l'appariement du compte visé, s'il en a un pour le MÊME en-tête. Appelé au dépôt du
   * fichier et à chaque changement de compte de destination : la mémoire appartient au compte,
   * donc changer de compte change la proposition — sans quoi l'utilisateur importerait dans un
   * compte l'appariement d'un autre.
   */
  function applyRemembered(): void {
    if (pending === null || proposal === null) return;
    const table = parseCsvText(pending.text);
    const remembered =
      targetAccount === 'new' ? null : app.rememberedMapping(targetAccount, table.header);
    const base = remembered ?? confirmedMapping(proposal);
    mappedColumns = { ...base.columns };
    mappedTypes = { ...base.typeLabels };
  }

  async function handleFile(file: File | undefined): Promise<void> {
    if (!file) return;
    busy = true;
    failure = null;
    report = null;
    pivotReport = null;
    pending = null;
    try {
      const text = await file.text();
      // 1) JSON → export Ghostfolio (vérification légère ici, complète à l'import).
      if (/\.json$/i.test(file.name) || text.trimStart().startsWith('{')) {
        try {
          const parsed = JSON.parse(text) as { activities?: unknown };
          if (Array.isArray(parsed.activities)) {
            stage(text, file.name, 'ghostfolio-json', 'ghostfolio');
            return;
          }
          failure = {
            error: 'JSON reconnu, mais sans tableau « activities ».',
            details: ['Attendu : un export Ghostfolio (ou un objet { "activities": […] }).'],
            header: [],
          };
          return;
        } catch {
          // pas un JSON : on continue avec les détections CSV.
        }
      }
      // 2) Export Coinhouse (import direct, sans choix de compte).
      const result = app.importCsv(text, file.name);
      if (result.ok) {
        report = result.report;
        toasts.push(`${result.report.newRows} nouvelle(s) ligne(s) importée(s).`, 'success');
        void app.refreshPrices();
        return;
      }
      // 3) CSV pivot (Koinly/Waltio) ou export natif d'une plateforme connue.
      const header = parseCsvText(text).header;
      const pivot = detectPivotFormat(header);
      if (pivot.ok) {
        stage(text, file.name, pivot.format, 'csv');
        return;
      }
      const converter = PLATFORM_CONVERTERS.find((c) => c.detect(header));
      if (converter) {
        stage(text, file.name, converter.id, 'csv');
        return;
      }
      // 4) Format inconnu : au lieu de renoncer, l'application propose un appariement de colonnes
      //    (P64). C'est la voie déterministe, elle ne demande ni clé ni réseau.
      if (header.length >= 3 && parseCsvText(text).rows.length > 0) {
        stage(text, file.name, 'mapped-csv', 'mapped');
        return;
      }
      failure = {
        error: result.error,
        details: [...result.details, ACCEPTED_FORMATS_HINT],
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
      // Un compte tout juste créé ne peut PAS déjà porter de pays : si l'import lui en pose un par
      // défaut (P66, plateforme sourcée), c'est forcément CETTE opération qui vient de le faire.
      const isNewAccount = targetAccount === 'new';
      const accountId = isNewAccount
        ? app.addPivotAccount(newLabel || pending.fileName).id
        : targetAccount;
      const result =
        pending.kind === 'ghostfolio'
          ? app.importGhostfolio(pending.text, pending.fileName, accountId)
          : pending.kind === 'mapped'
            ? app.importMapped(pending.text, pending.fileName, accountId, currentMapping)
            : app.importPivot(pending.text, pending.fileName, accountId);
      if (result.ok) {
        pivotReport = result.report;
        lastImportId = app.state.imports[app.state.imports.length - 1]?.id ?? null;
        pending = null;
        proposal = null;
        toasts.push(`${result.report.newRows} nouvelle(s) ligne(s) importée(s).`, 'success');
        const country = isNewAccount ? app.state.accounts[accountId]?.country : null;
        if (country)
          toasts.push(
            `Pays de l’organisme déduit : ${countryName(country)} (à corriger dans Comptes si besoin).`,
            'info',
          );
        void app.refreshPrices();
      } else {
        failure = { error: result.error, details: result.details, header: result.header };
        pending = null;
      }
    } finally {
      busy = false;
    }
  }

  /**
   * **Annule le dernier import** : ses lignes partent, le portefeuille se recalcule.
   *
   * Une fonctionnalité qui propose un appariement doit pouvoir défaire son erreur. Sans cela, un
   * appariement confirmé à tort ne se corrigerait qu'en supprimant le compte entier — donc aussi
   * les imports corrects qu'il porte.
   */
  function undoLastImport(): void {
    if (lastImportId === null) return;
    const undone = app.undoImport(lastImportId);
    lastImportId = null;
    pivotReport = null;
    report = null;
    if (undone === null) return;
    toasts.push(`Import annulé : ${undone.removed} ligne(s) retirée(s).`, 'success');
  }

  /**
   * Demande au modèle de compléter l'appariement. Le consentement passe par la MÊME feuille que le
   * récit (P65) : aucun second mécanisme, et la charge utile affichée est celle qui part.
   */
  async function askModel(): Promise<void> {
    if (proposal === null || pending === null || mappingPayload === null) return;
    if (!aiKey.hasConsent(mappingRequest, aiModelId)) {
      consentOpen = true;
      return;
    }
    await sendToModel();
  }

  async function sendToModel(): Promise<void> {
    const base = proposal;
    const staged = pending;
    const payload = mappingPayload;
    if (base === null || staged === null || payload === null) return;
    busy = true;
    try {
      const key = aiKey.value;
      const adapter = key === null ? null : anthropicAdapter(key, { modelId: aiModelId });
      const table = parseCsvText(staged.text);
      /*
       * Le vérificateur donné au modèle est le VRAI : il fusionne sa proposition (contrôle 5 : il
       * ne peut que combler un trou) puis rejoue l'import entier. Une proposition qui inverserait
       * les jambes est rejetée ici, avant d'atteindre l'écran.
       */
      const verify = (model: ModelMapping): string | null => {
        const merged = mergeModelMapping(base, model);
        const replay = verifyMapping(
          confirmedMapping(merged.proposal),
          contextOf(table, base, (day) => app.usdRate(day)),
        );
        return replay.ok ? null : (firstFailure(replay)?.code ?? 'refus sans code');
      };
      const outcome = await runMapping(
        adapter,
        payload.input,
        TYPE_TARGETS,
        msToParisNaive(Date.now()),
        verify,
      );
      modelOutcome = outcome;
      if (outcome.status !== 'ok') return;
      const merged = mergeModelMapping(base, outcome.value);
      proposal = merged.proposal;
      const next = confirmedMapping(merged.proposal);
      mappedColumns = { ...next.columns };
      mappedTypes = { ...next.typeLabels };
      toasts.push(
        merged.filled === 0
          ? 'Le modèle n’a rien ajouté : l’appariement était déjà complet.'
          : `${merged.filled} appariement(s) proposé(s) par le modèle, à confirmer.`,
        'info',
      );
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
      accept=".csv,.json,text/csv,application/json"
      disabled={busy}
      onchange={(e) => void handleFile(e.currentTarget.files?.[0])}
    />
    <span class="big">{busy ? 'Analyse en cours…' : 'Choisir le fichier .csv ou .json'}</span>
    <span class="muted small"
      >Export Coinhouse (Vos transactions → Exporter → Export avancé), CSV Koinly/Waltio, exports
      natifs Kraken, Revolut, Coinbase, Bitvavo, Ledger Live, ou JSON Ghostfolio. Tout autre CSV :
      l’application vous propose un appariement de ses colonnes, que vous confirmez avant l’import.
      Glissez-déposez ou touchez pour choisir.</span
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
            <input
              type="radio"
              name="target"
              value={account.id}
              bind:group={targetAccount}
              onchange={applyRemembered}
            />
            <span>{account.label} <span class="muted small">(existant)</span></span>
          </label>
        {/each}
        <label class="choice">
          <input
            type="radio"
            name="target"
            value="new"
            bind:group={targetAccount}
            onchange={applyRemembered}
          />
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
      {#if pending.kind !== 'mapped'}
        <div class="actions">
          <button class="primary" type="button" disabled={busy} onclick={confirmPivot}
            >Importer dans ce compte</button
          >
          <button class="secondary" type="button" onclick={() => (pending = null)}>Annuler</button>
        </div>
      {/if}
    </section>
  {/if}

  {#if pending && pending.kind === 'mapped' && proposal && verdict}
    {#if modelOutcome && modelOutcome.status === 'refused'}
      <p class="demo-note" role="status">
        {refusalText(modelOutcome.reason, modelOutcome.fallback)} L’appariement ci-dessous reste celui
        que l’application a trouvé seule.
      </p>
    {/if}
    <ColumnMapping
      {proposal}
      bind:columns={mappedColumns}
      bind:typeLabels={mappedTypes}
      {verdict}
      {modelReady}
      {busy}
      droppedTypeLabels={mappingPayload?.droppedTypeLabels ?? 0}
      {rememberedAt}
      onask={() => void askModel()}
      onconfirm={confirmPivot}
      oncancel={() => {
        pending = null;
        proposal = null;
      }}
    />
  {/if}

  <!-- Second avis (P62) : un export qui porte des CHIFFRES DÉJÀ CALCULÉS (une annexe 2086) ne
       s'importe pas — il se compare. La distinction est faite ici, à l'endroit exact où un
       utilisateur essaierait sinon de l'importer et obtiendrait « format non reconnu ». -->
  <section class="card block">
    <h2>Vous avez un fichier de chiffres déjà calculés ?</h2>
    <p class="small">
      Une annexe 2086 ou un rapport de plus-values d’un autre outil ne s’importe pas : ses chiffres
      sont le résultat d’un calcul, pas des opérations. Le « second avis » les compare aux nôtres et
      dit d’où vient chaque différence.
    </p>
    <div class="actions">
      <a class="secondary" href={router.href({ name: 'secondOpinion' })}>Ouvrir le second avis</a>
    </div>
  </section>

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
        {#if pivotReport.counts.skippedInternal > 0}· {pivotReport.counts.skippedInternal} mouvement(s)
          interne(s) à la plateforme, ignoré(s){/if}
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
        {#if lastImportId}
          <button class="secondary" type="button" onclick={undoLastImport}
            >Annuler cet import</button
          >
        {/if}
      </div>
      {#if lastImportId}
        <p class="small muted">
          « Annuler cet import » retire les lignes que cet import a ajoutées, et rien d’autre : les
          lignes déjà connues d’un import précédent restent en place.
        </p>
      {/if}
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

<!-- Le MÊME consentement que le récit (P65) : aucun second mécanisme, et la charge utile affichée
     est celle qui part, au caractère près. -->
<ConsentSheet
  bind:open={consentOpen}
  request={mappingRequest}
  modelId={aiModelId}
  purpose="Appariement des colonnes de ce fichier : en-têtes, formes de colonnes et libellés de type — aucune cellule."
  discreet={app.state.ui.discreet}
  onsend={() => {
    aiKey.grantConsent(mappingRequest, aiModelId);
    void sendToModel();
  }}
  oncancel={() => {
    // Un consentement refusé n'est pas une panne : c'est l'état « pas de modèle », et la
    // proposition déterministe reste exactement ce qu'elle était.
    modelOutcome = { status: 'refused', reason: 'no-model', fallback: 'deterministic' };
  }}
/>

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
