<script lang="ts">
  /**
   * L'arbre d'une trace, en `<ul>`/`<li>` avec `<details>`/`<summary>` natifs : le pliage, le
   * clavier et l'annonce « développé / réduit » viennent du navigateur, donc aucun attribut ARIA
   * ne peut être oublié. Une ligne brute se rend en `<dl>` (terme / valeur) et non en tableau :
   * un tableau à cinq colonnes déborderait sur téléphone (WCAG 1.4.10 Reflow).
   */
  import type { RenderedTraceNode } from '$lib/format/trace';
  import Self from './TraceTree.svelte';

  let {
    nodes,
    depth = 0,
    expandAll = false,
  }: { nodes: readonly RenderedTraceNode[]; depth?: number; expandAll?: boolean } = $props();
  /** Indentation plafonnée à deux niveaux : au-delà, la colonne de texte devient inutilisable. */
  const indent = $derived(Math.min(depth, 2));
</script>

<ul class="tree" style="--indent: {indent}">
  {#each nodes as node (node.id)}
    <li class:leaf={node.children.length === 0}>
      {#if node.children.length > 0}
        <details open={expandAll || depth < 1}>
          <summary>
            <span class="label">{node.label}</span>
            {#if node.amount}<span class="num amount">{node.amount}</span>{/if}
          </summary>
          {#if node.details.length > 0}
            <dl>
              {#each node.details as detail (detail.term + detail.value)}
                <dt>{detail.term}</dt>
                <dd>{detail.value}</dd>
              {/each}
            </dl>
          {/if}
          {#if node.gap}<p class="gap">{node.gap}</p>{/if}
          <Self nodes={node.children} depth={depth + 1} {expandAll} />
        </details>
      {:else}
        <p class="row">
          <span class="label">{node.label}</span>
          {#if node.amount}<span class="num amount">{node.amount}</span>{/if}
        </p>
        {#if node.details.length > 0}
          <dl>
            {#each node.details as detail (detail.term + detail.value)}
              <dt>{detail.term}</dt>
              <dd>{detail.value}</dd>
            {/each}
          </dl>
        {/if}
        {#if node.gap}<p class="gap">{node.gap}</p>{/if}
      {/if}
    </li>
  {/each}
</ul>

<style>
  .tree {
    list-style: none;
    margin: 0;
    padding: 0;
    padding-left: calc(var(--indent) * var(--space-3));
  }
  li {
    border-left: 1px solid var(--border);
    padding-left: var(--space-2);
    margin-top: var(--space-2);
  }
  summary,
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2);
    /* Cible tactile ≥ 24 px (WCAG 2.2 AA, target-size) : un résumé se clique. */
    min-height: 24px;
  }
  summary {
    cursor: pointer;
  }
  .label {
    font-weight: 600;
  }
  .amount {
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    white-space: nowrap;
  }
  dl {
    display: grid;
    grid-template-columns: minmax(0, auto) minmax(0, 1fr);
    gap: 0 var(--space-2);
    margin: var(--space-1) 0 0;
    font-size: var(--fs-xs);
    color: var(--fg-muted);
  }
  dt {
    color: var(--fg-faint);
  }
  dd {
    margin: 0;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .gap {
    margin-top: var(--space-1);
    font-size: var(--fs-xs);
    color: var(--warn);
  }
  /* Sous 768 px, l'indentation ne dépasse jamais un cran : la colonne de texte reste lisible. */
  @media (max-width: 767px) {
    .tree {
      padding-left: calc(min(var(--indent), 1) * var(--space-2));
    }
    dl {
      grid-template-columns: minmax(0, 1fr);
    }
    dd {
      margin-bottom: var(--space-1);
    }
  }
</style>
