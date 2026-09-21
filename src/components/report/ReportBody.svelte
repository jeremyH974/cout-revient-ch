<script lang="ts">
  /**
   * Le corps d'un rapport : la garde, les sections, le pied. **Un seul rendu pour tous les
   * périmètres.**
   *
   * Ce composant ne connaît aucune section par son nom — il itère `model.sections` et sait dessiner
   * les six formes de `ReportBlock` (décision n° 174). C'est ce qui permet au rapport de patrimoine
   * et au rapport d'investissement d'avoir la même apparence : une norme de notation demande que la
   * même signification reçoive la même mise en forme, et deux markups jumeaux ne le garantissent
   * pas — un seul, si.
   *
   * Ce qui reste propre à un périmètre lui est passé sous forme de bribe : l'appelant décide de ce
   * qui suit la garde et de la figure de répartition, le corps décide *où* cela se place.
   */
  import type { Snippet } from 'svelte';
  import type { ReportKpi, ReportModel } from '$lib/export/report-model';
  import InsightList from '../shared/InsightList.svelte';

  let {
    model,
    afterCover,
    allocationChart,
  }: {
    model: ReportModel;
    /** Rendu juste après la garde. Le récit IA du rapport d'investissement s'y place. */
    afterCover?: Snippet;
    /**
     * La figure de répartition, rendue là où une section l'annonce (`chart === 'allocation'`).
     * Le corps ne sait pas d'où viennent ses données — et c'est la limite assumée de la décision
     * n° 174 : le modèle porte le fait qu'une figure accompagne le tableau, pas ses données.
     */
    allocationChart?: Snippet;
  } = $props();
</script>

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

  <!-- Ce que l'appelant ajoute juste apres la garde : le recit IA, cote Investissement. -->
  {#if afterCover}{@render afterCover()}{/if}

  {#snippet detailsTable(details: readonly ReportKpi[])}
    <table class="details">
      <tbody>
        {#each details as d (d.label)}
          <tr>
            <th scope="row">{d.label}</th>
            <td class="right num {d.tone}">{d.value}</td>
            <td class="hint">{d.hint ?? ''}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/snippet}

  <!--
    UNE BOUCLE, six formes. L'écran ne connaît plus aucune section par son nom : ni son rang, ni la
    figure qui l'accompagne, ni sa présence. C'est ce qui le tient au même récit que le PDF — les
    deux séquences étaient écrites à la main, chacune de son côté, et celle du PDF avait perdu la
    liste des comptes à déclarer au 3916-bis sans que rien ne le dise (décision n° 174).
  -->
  {#each model.sections as s (s.id)}
    <section class="card" class:methodology={s.block.kind === 'paragraphs'}>
      <h2>{s.title}</h2>
      {#if s.lead}<p class="note">{s.lead}</p>{/if}

      {#if s.block.kind === 'kpis'}
        <div class="kpis">
          {#each s.block.kpis as kpi (kpi.label)}
            <div class="kpi">
              <p class="label">{kpi.label}</p>
              <p class="value num {kpi.tone}">{kpi.value}</p>
              {#if kpi.hint}<p class="hint">{kpi.hint}</p>{/if}
            </div>
          {/each}
        </div>
        {@render detailsTable(s.block.details)}
      {:else if s.block.kind === 'details'}
        {@render detailsTable(s.block.details)}
      {:else if s.block.kind === 'insights'}
        <InsightList insights={s.block.items} />
      {:else if s.block.kind === 'bullets'}
        <ul class="warnings">
          {#each s.block.items as item (item)}
            <li>{item}</li>
          {/each}
        </ul>
      {:else if s.block.kind === 'paragraphs'}
        {#each s.block.items as item (item.title)}
          <h3>{item.title}</h3>
          <p>{item.text}</p>
        {/each}
      {:else if s.block.kind === 'table'}
        {#if s.block.chart === 'allocation' && s.block.table.rows.length > 0 && allocationChart}
          {@render allocationChart()}
        {/if}
        {#if s.block.table.rows.length === 0}
          <p class="muted">{s.block.table.emptyText}</p>
        {:else}
          <!-- Un tableau qui défile horizontalement doit rester accessible au clavier (WCAG 2.1.1). -->
          <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
          <div class="scroll" tabindex="0" role="region" aria-label="{s.title} — tableau défilant">
            <table>
              <thead>
                <tr>
                  {#each s.block.table.columns as col (col.label)}
                    <th class={col.align}>{col.label}</th>
                  {/each}
                </tr>
              </thead>
              <tbody>
                {#each s.block.table.rows as row, r (r)}
                  <tr>
                    {#each row as c, i (i)}
                      <td class="{s.block.table.columns[i]?.align ?? 'left'} num {c.tone}">
                        {c.text}{#if c.sub}<span class="sub">{c.sub}</span>{/if}
                      </td>
                    {/each}
                  </tr>
                {/each}
              </tbody>
              {#if s.block.table.total}
                <tfoot>
                  <tr>
                    {#each s.block.table.total as c, i (i)}
                      <td class="{s.block.table.columns[i]?.align ?? 'left'} num {c.tone}"
                        >{c.text}</td
                      >
                    {/each}
                  </tr>
                </tfoot>
              {/if}
            </table>
          </div>
        {/if}
      {/if}

      {#if s.warnings.length > 0}
        <ul class="warnings">
          {#each s.warnings as warning (warning)}
            <li>{warning}</li>
          {/each}
        </ul>
      {/if}
      {#if s.note}<p class="note">{s.note}</p>{/if}
    </section>
  {/each}

  <footer class="foot muted small">
    <span>{model.footer.left}</span>
    <span>{model.footer.right}</span>
  </footer>
</article>

<style>
  .report {
    max-width: 960px;
    margin: 0 auto var(--space-6);
    padding: 0 var(--space-3);
    display: grid;
    gap: var(--space-4);
  }
  /* Les cartes (éléments de grille) doivent pouvoir rétrécir sous la largeur de leurs tableaux :
     sinon la page déborde sur mobile et le navigateur dézoome. */
  .report > :global(*) {
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
  .warnings {
    margin: var(--space-2) 0 0;
    padding-left: 1.2em;
    font-size: var(--fs-sm);
    color: var(--warn);
    display: grid;
    gap: var(--space-1);
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
    :global(.update) {
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
