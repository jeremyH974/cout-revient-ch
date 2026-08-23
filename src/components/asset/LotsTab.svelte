<script lang="ts">
  import type { PositionReport } from '$lib/domain/engine';
  import { fmtDateTime } from '$lib/format/fr';
  import { fmtPrice as fmtPriceBase } from '$lib/format/fr';
  import Money from '../shared/Money.svelte';
  import Pct from '../shared/Pct.svelte';
  import Qty from '../shared/Qty.svelte';
  import { app } from '../../state/app.svelte';
  const price = (v: Parameters<typeof fmtPriceBase>[0]): string => fmtPriceBase(v, app.currency);

  let { position }: { position: PositionReport } = $props();
  const labels: Record<string, string> = {
    purchase: 'ACHAT',
    reward: 'RÉCOMPENSE',
    deposit: 'DÉPÔT',
    migration: 'MIGRATION',
    'opening-balance': 'SOLDE INITIAL',
  };
</script>

{#if position.lots.length === 0}
  <p class="muted empty">Aucune position ouverte.</p>
{:else}
  <p class="muted note">
    Un lot par achat. Chaque vente consomme la même fraction de chaque lot : la somme des latents
    des lots est exactement le latent de l'actif. Le « % » de chaque lot est son latent rapporté à
    son coût restant (écart du prix au prix all-in du lot).
  </p>
  {#each position.lots as lot (lot.id)}
    <article class="lot">
      <header>
        <span
          ><strong>{labels[lot.origin] ?? lot.origin}</strong>
          <span class="muted">{fmtDateTime(lot.openedAt)}</span></span
        >
        {#if lot.counterAsset && lot.counterAsset !== 'eur'}<span class="chip"
            >payé en {lot.counterAsset.toUpperCase()}</span
          >{/if}
      </header>
      <p>
        <Qty value={lot.qtyRemaining} asset={position.asset} />
        <span class="muted">@ {lot.unitCost ? price(lot.unitCost) : '—'} all-in</span
        >{#if !lot.qtyRemaining.eq(lot.qtyInitial)}&nbsp;<span class="muted">
            · entamé (initial <Qty value={lot.qtyInitial} />)</span
          >{/if}
      </p>
      <p class="pnl">
        <Money value={lot.unrealized} sign colored />
        <Pct value={lot.unrealizedPct} />
        <span class="muted">vs prix all-in · valeur <Money value={lot.value} /></span>
      </p>
    </article>
  {/each}
{/if}

<style>
  .empty,
  .note {
    padding: var(--space-3) var(--space-4);
    font-size: var(--fs-sm);
  }
  .lot {
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--border);
    display: grid;
    gap: 2px;
    font-size: var(--fs-sm);
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
  .pnl {
    font-size: var(--fs-md);
  }
</style>
