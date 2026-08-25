<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { nowIso } from '$lib/clock';
  import { downloadReportPdf } from '$lib/export/pdf';
  import { buildReportModel, type ReportModel, type ReportTable } from '$lib/export/report-model';
  import AppBar from '../../components/layout/AppBar.svelte';
  import { app } from '../../state/app.svelte';
  import { history } from '../../state/history.svelte';
  import { toasts } from '../../state/ui.svelte';

  // Le TWR et le repère se lisent dans l'historique quotidien des prix : on le charge à
  // l'ouverture du rapport (idempotent, il ne redemande que ce qui manque).
  onMount(() => void history.ensure());

  let generatedAt = $state(nowIso());
  let busy = $state(false);

  const model = $derived<ReportModel>(
    buildReportModel(app.report, {
      discreet: app.state.ui.discreet,
      currency: app.currency,
      generatedAt,
      version: __APP_VERSION__,
      subscriptionsInPnl: app.state.engineSettings.includeSubscriptionsInPnl,
      subscription: app.subscriptionAnalysis,
      // Tant que l'historique n'est pas chargé, la série est vide ou partielle : mieux vaut dire
      // « pas encore » que d'afficher un chiffre qui bougera sous les yeux de l'utilisateur.
      performance: history.status.loadedAt === null ? undefined : history.performance(),
    }),
  );
  const tables = $derived<ReportTable[]>([
    model.allocation,
    model.positions,
    model.stablecoins,
    model.closed,
  ]);

  async function download(): Promise<void> {
    if (busy) return;
    busy = true;
    generatedAt = nowIso();
    try {
      const fileName = await downloadReportPdf(model);
      toasts.push(`PDF téléchargé (${fileName}).`, 'success');
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      toasts.push(`Impossible de générer le PDF : ${reason}`, 'error');
    } finally {
      busy = false;
    }
  }

  async function print(): Promise<void> {
    generatedAt = nowIso();
    await tick();
    window.print();
  }
</script>

<AppBar title="Rapport de portefeuille" back />

<div class="actions">
  <button class="primary" type="button" onclick={() => void download()} disabled={busy}>
    {busy ? 'Génération…' : 'Télécharger le PDF'}
  </button>
  <button class="secondary" type="button" onclick={() => void print()}>
    Imprimer / Enregistrer en PDF
  </button>
  <p class="muted small">Généré dans votre navigateur : aucune donnée n'est envoyée.</p>
</div>

<article class="report">
  <header class="cover card">
    <p class="brand">{model.meta.appName}</p>
    <h1>{model.cover.title}</h1>
    <p class="muted">{model.cover.subtitle}</p>
    <dl class="facts">
      {#each model.cover.facts as fact (fact.label)}
        <dt>{fact.label}</dt>
        <dd>{fact.value}</dd>
      {/each}
    </dl>
    {#if model.cover.notes.length > 0}
      <ul class="notes">
        {#each model.cover.notes as note (note)}
          <li>{note}</li>
        {/each}
      </ul>
    {/if}
    <p class="disclaimer">{model.cover.disclaimer}</p>
  </header>

  <section class="card">
    <h2>{model.summary.title}</h2>
    <div class="kpis">
      {#each model.summary.kpis as kpi (kpi.label)}
        <div class="kpi">
          <p class="label">{kpi.label}</p>
          <p class="value num {kpi.tone}">{kpi.value}</p>
          {#if kpi.hint}<p class="hint">{kpi.hint}</p>{/if}
        </div>
      {/each}
    </div>
    <table class="details">
      <tbody>
        {#each model.summary.details as d (d.label)}
          <tr>
            <th scope="row">{d.label}</th>
            <td class="right num {d.tone}">{d.value}</td>
            <td class="hint">{d.hint ?? ''}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </section>

  {#if model.subscription}
    <section class="card">
      <h2>{model.subscription.title}</h2>
      <table class="details">
        <tbody>
          {#each model.subscription.details as d (d.label)}
            <tr>
              <th scope="row">{d.label}</th>
              <td class="right num {d.tone}">{d.value}</td>
              <td class="hint">{d.hint ?? ''}</td>
            </tr>
          {/each}
        </tbody>
      </table>
      <p class="note">{model.subscription.note}</p>
    </section>
  {/if}

  {#each tables as table (table.kind)}
    <section class="card">
      <h2>{table.title}</h2>
      {#if table.note}<p class="note">{table.note}</p>{/if}
      {#if table.rows.length === 0}
        <p class="muted">{table.emptyText}</p>
      {:else}
        <!-- Un tableau qui défile horizontalement doit rester accessible au clavier (WCAG 2.1.1). -->
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <div
          class="scroll"
          tabindex="0"
          role="region"
          aria-label="{table.title} — tableau défilant"
        >
          <table>
            <thead>
              <tr>
                {#each table.columns as col (col.label)}
                  <th class={col.align}>{col.label}</th>
                {/each}
              </tr>
            </thead>
            <tbody>
              {#each table.rows as row, r (r)}
                <tr>
                  {#each row as c, i (i)}
                    <td class="{table.columns[i]?.align ?? 'left'} num {c.tone}">
                      {c.text}{#if c.sub}<span class="sub">{c.sub}</span>{/if}
                    </td>
                  {/each}
                </tr>
              {/each}
            </tbody>
            {#if table.total}
              <tfoot>
                <tr>
                  {#each table.total as c, i (i)}
                    <td class="{table.columns[i]?.align ?? 'left'} num {c.tone}">{c.text}</td>
                  {/each}
                </tr>
              </tfoot>
            {/if}
          </table>
        </div>
      {/if}
    </section>
  {/each}

  <section class="card methodology">
    <h2>{model.methodology.title}</h2>
    {#each model.methodology.items as item (item.title)}
      <h3>{item.title}</h3>
      <p>{item.text}</p>
    {/each}
  </section>

  <footer class="foot muted small">
    <span>{model.footer.left}</span>
    <span>{model.footer.right}</span>
  </footer>
</article>

<style>
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
    max-width: 960px;
    margin: 0 auto;
    padding: var(--space-3);
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
  }
  .primary {
    background: var(--accent);
    color: var(--accent-fg);
  }
  .secondary {
    border: 1px solid var(--border);
    color: var(--fg);
  }
  .primary:disabled,
  .secondary:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .small {
    font-size: var(--fs-xs);
  }
  .report {
    max-width: 960px;
    margin: 0 auto var(--space-6);
    padding: 0 var(--space-3);
    display: grid;
    gap: var(--space-4);
  }
  /* Les cartes (éléments de grille) doivent pouvoir rétrécir sous la largeur de leurs tableaux :
     sinon la page déborde sur mobile et le navigateur dézoome. */
  .report > * {
    min-width: 0;
  }
  .details td,
  .details th {
    overflow-wrap: anywhere;
  }
  .cover,
  section {
    padding: var(--space-4);
  }
  .brand {
    font-size: var(--fs-xs);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--fg-muted);
  }
  .cover h1 {
    margin: var(--space-2) 0 var(--space-1);
  }
  .facts {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: var(--space-1) var(--space-4);
    margin: var(--space-4) 0 0;
    font-size: var(--fs-sm);
  }
  .facts dt {
    color: var(--fg-muted);
    font-weight: 600;
  }
  .facts dd {
    margin: 0;
  }
  .notes {
    margin: var(--space-3) 0 0;
    padding-left: var(--space-4);
    font-size: var(--fs-sm);
    color: var(--fg-muted);
  }
  .disclaimer {
    margin-top: var(--space-4);
    padding: var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-sunken);
    font-size: var(--fs-xs);
    color: var(--fg-muted);
  }
  h2 {
    margin-bottom: var(--space-3);
  }
  .kpis {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: var(--space-2);
  }
  .kpi {
    padding: var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-sunken);
  }
  .label {
    font-size: var(--fs-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--fg-muted);
  }
  .value {
    font-size: var(--fs-lg);
    font-weight: 700;
  }
  .hint {
    font-size: var(--fs-xs);
    color: var(--fg-muted);
  }
  .note {
    font-size: var(--fs-xs);
    color: var(--fg-muted);
    margin-bottom: var(--space-2);
  }
  .scroll {
    overflow-x: auto;
  }
  .scroll:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--fs-sm);
  }
  .details {
    margin-top: var(--space-3);
  }
  th,
  td {
    padding: var(--space-2);
    border-bottom: 1px solid var(--border);
    vertical-align: top;
  }
  thead th {
    font-size: var(--fs-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--fg-muted);
    font-weight: 600;
  }
  .details th {
    text-align: left;
    font-weight: 600;
  }
  .right {
    text-align: right;
  }
  .left {
    text-align: left;
  }
  tfoot td {
    font-weight: 700;
    border-top: 2px solid var(--fg-muted);
    border-bottom: 0;
  }
  .sub {
    display: block;
    font-size: var(--fs-xs);
    color: var(--fg-muted);
    white-space: normal;
  }
  .methodology h3 {
    margin-top: var(--space-3);
  }
  .methodology p {
    font-size: var(--fs-sm);
    color: var(--fg-muted);
  }
  .foot {
    display: flex;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  @media (min-width: 640px) {
    .kpis {
      grid-template-columns: repeat(3, 1fr);
    }
  }

  @media print {
    @page {
      size: A4 portrait;
      margin: 14mm 12mm;
    }
    :global(body) {
      background: #fff;
      color: #000;
    }
    :global(.nav),
    :global(.bar),
    :global(.update),
    .actions {
      display: none !important;
    }
    .report {
      max-width: none;
      padding: 0;
      gap: 8mm;
      color: #000;
    }
    .cover,
    section {
      border: 0;
      box-shadow: none;
      background: #fff;
      padding: 0;
      border-radius: 0;
    }
    .cover {
      min-height: 55vh;
      break-after: page;
      page-break-after: always;
    }
    .kpi,
    .disclaimer {
      background: #fff;
      border-color: #bbb;
    }
    table,
    .kpis,
    .kpi,
    tr {
      break-inside: avoid;
      page-break-inside: avoid;
    }
    thead {
      display: table-header-group;
    }
    h2,
    h3 {
      break-after: avoid;
      page-break-after: avoid;
    }
    .methodology {
      break-before: page;
      page-break-before: always;
    }
    .report :global(.gain) {
      color: #15803d;
    }
    .report :global(.loss) {
      color: #b91c1c;
    }
    .muted,
    .hint,
    .label,
    .note,
    .sub,
    .brand,
    .disclaimer,
    .methodology p,
    thead th {
      color: #555;
    }
  }
</style>
