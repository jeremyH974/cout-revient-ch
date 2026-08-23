<script lang="ts">
  import type { HistoryEntry, PositionReport } from '$lib/domain/engine';
  import { ZERO } from '$lib/domain/money';
  import { fmtDateTime, fmtQty } from '$lib/format/fr';
  import { fmtPrice as fmtPriceBase } from '$lib/format/fr';
  import Money from '../shared/Money.svelte';
  import Qty from '../shared/Qty.svelte';
  import { app } from '../../state/app.svelte';
  const price = (v: Parameters<typeof fmtPriceBase>[0]): string => fmtPriceBase(v, app.currency);

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
  /** Ce que représente le montant affiché, selon l'opération. */
  const amountLabel: Record<HistoryEntry['kind'], string> = {
    buy: 'all-in',
    sell: 'reçus',
    reward: 'valeur à la réception',
    deposit: "coût d'acquisition",
    withdrawal: 'valeur de cession',
    'migration-in': 'coût reporté',
    'migration-out': 'valorisation de la sortie',
    'opening-balance': 'coût du solde initial',
  };
  const zeroCost = (h: HistoryEntry): boolean => h.valueEur !== null && h.valueEur.eq(ZERO);
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
      {#if h.valueEur && zeroCost(h)}
        <span class="muted"
          >coût nul{h.kind === 'reward'
            ? ' (récompense comptée à 0 €)'
            : h.kind === 'deposit'
              ? " (coût d'acquisition inconnu)"
              : ''}</span
        >
      {:else if h.valueEur}
        <Money value={h.valueEur} />
        {amountLabel[h.kind]}
      {/if}
      {#if h.counterAsset && h.counterAsset !== 'eur'}<span class="chip"
          >via {h.counterAsset.toUpperCase()}</span
        >{/if}
      {#if h.unitPrice && !zeroCost(h)}<span class="muted">· {price(h.unitPrice)} / unité</span
        >{/if}
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
      {#if h.qtyAfter.eq(ZERO)}
        position soldée (plus aucune unité)
      {:else}
        PRU {h.realized !== null ? 'inchangé' : 'après'} : {h.pruAfter ? price(h.pruAfter) : '—'} · reste
        <Qty value={h.qtyAfter} abbreviate />
      {/if}
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
