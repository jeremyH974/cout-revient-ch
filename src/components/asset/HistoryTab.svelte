<script lang="ts">
  import type { PositionReport } from '$lib/domain/engine';
  import { fmtDateTime, fmtPrice, fmtQty } from '$lib/format/fr';
  import Money from '../shared/Money.svelte';
  import Qty from '../shared/Qty.svelte';

  let { position }: { position: PositionReport } = $props();
  const labels: Record<string, string> = {
    buy: 'ACHAT',
    sell: 'VENTE',
    reward: 'RÉCOMPENSE',
    deposit: 'DÉPÔT',
    withdrawal: 'RETRAIT',
    'migration-in': 'MIGRATION (entrée)',
    'migration-out': 'MIGRATION (sortie)',
    'opening-balance': 'SOLDE INITIAL',
  };
</script>

{#each position.history as h (h.eventId + h.kind)}
  <article
    class="op"
    class:sell={h.kind === 'sell' || h.kind === 'withdrawal' || h.kind === 'migration-out'}
  >
    <header>
      <span
        ><strong>{labels[h.kind] ?? h.kind}</strong>
        <span class="muted">{fmtDateTime(h.at)}</span></span
      >
      <Qty value={h.qty} asset={position.asset} sign abbreviate />
    </header>
    <p>
      {#if h.valueEur}<Money value={h.valueEur} />
        {h.kind === 'buy' ? 'all-in' : h.kind === 'sell' ? 'reçus' : ''}{/if}
      {#if h.counterAsset && h.counterAsset !== 'eur'}<span class="chip"
          >via {h.counterAsset.toUpperCase()}</span
        >{/if}
      {#if h.unitPrice}<span class="muted">· {fmtPrice(h.unitPrice)} / unité</span>{/if}
      {#if h.quotePrice}<span class="muted"
          >· cours {fmtQty(h.quotePrice.price)} {h.quotePrice.asset.toUpperCase()}</span
        >{/if}
    </p>
    {#if h.feeEur.gt('0') || h.rebateEur.gt('0')}
      <p class="muted small">
        Frais <Money value={h.feeEur} />{#if h.rebateEur.gt('0')}&nbsp;(après remise <Money
            value={h.rebateEur}
          />){/if}
      </p>
    {/if}
    <p class="after">
      {#if h.realized !== null}Réalisé sur cette opération : <Money
          value={h.realized}
          sign
          colored
        /> ·
      {/if}
      PRU {h.realized !== null ? 'inchangé' : 'après'} : {h.pruAfter ? fmtPrice(h.pruAfter) : '—'} · reste
      <Qty value={h.qtyAfter} abbreviate />
    </p>
    {#each h.warnings as w (w)}<p class="warn small">{w}</p>{/each}
  </article>
{:else}
  <p class="muted empty">Aucune opération.</p>
{/each}

<style>
  .op {
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--border);
    border-left: 3px solid var(--gain);
    display: grid;
    gap: 2px;
    font-size: var(--fs-sm);
  }
  .op.sell {
    border-left-color: var(--loss);
  }
  header {
    display: flex;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .chip {
    font-size: var(--fs-xs);
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 1px 8px;
    color: var(--fg-muted);
  }
  .after {
    color: var(--fg-muted);
  }
  .small {
    font-size: var(--fs-xs);
  }
  .warn {
    color: var(--warn);
  }
  .empty {
    padding: var(--space-3) var(--space-4);
  }
</style>
