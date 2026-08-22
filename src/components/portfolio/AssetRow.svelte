<script lang="ts">
  import type { PositionReport } from '$lib/domain/engine';

  import { fmtPrice as fmtPriceBase } from '$lib/format/fr';
  import { assetName } from '$lib/pricing/tickers';
  import { router } from '$lib/router.svelte';
  import CoinBadge from '../shared/CoinBadge.svelte';
  import Money from '../shared/Money.svelte';
  import Pct from '../shared/Pct.svelte';
  import Qty from '../shared/Qty.svelte';
  import { app } from '../../state/app.svelte';
  const price = (v: Parameters<typeof fmtPriceBase>[0]): string => fmtPriceBase(v, app.currency);

  let { position }: { position: PositionReport } = $props();
  const p = $derived(position);
</script>

<a class="row" href={router.href({ name: 'asset', asset: p.asset })} role="row">
  <span class="cell id"
    ><CoinBadge asset={p.asset} /><span class="names"
      ><strong>{p.asset.toUpperCase()}</strong><span class="muted small">{assetName(p.asset)}</span
      ></span
    ></span
  >
  <span class="cell qty"
    ><Qty value={p.qty} abbreviate /><span class="muted small"
      >PRU {p.pru ? price(p.pru) : '—'}</span
    ></span
  >
  <span class="cell price muted">{p.price ? price(p.price.priceEur) : '—'}</span>
  <span class="cell value"><Money value={p.value} compact /></span>
  <span class="cell latent"
    ><Money value={p.unrealized} sign colored compact /><span class="small"
      ><Pct value={p.unrealizedPct} /> <span class="muted">vs PRU</span></span
    ></span
  >
  <span class="cell realized"><Money value={p.realized} sign colored compact /></span>
  <span class="cell total"><Money value={p.total} sign colored strong compact /></span>
  {#if p.status === 'no-price'}<span class="flag warn">Prix indisponible</span>{/if}
  {#if p.status === 'needs-qualification'}<span class="flag warn">À qualifier</span>{/if}
</a>

<style>
  .row {
    display: grid;
    grid-template-columns: 1fr auto;
    grid-template-areas:
      'id total'
      'qty latent'
      'value realized';
    gap: 2px var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--border);
    color: inherit;
    text-decoration: none;
    min-height: var(--tap);
  }
  .row:hover {
    background: var(--bg-elev);
  }
  .cell {
    display: flex;
    flex-direction: column;
    justify-content: center;
    min-width: 0;
  }
  .id {
    grid-area: id;
    flex-direction: row;
    align-items: center;
    gap: var(--space-3);
  }
  .names {
    display: flex;
    flex-direction: column;
    line-height: 1.2;
  }
  .qty {
    grid-area: qty;
  }
  .price {
    display: none;
  }
  .value {
    grid-area: value;
  }
  .latent {
    grid-area: latent;
    text-align: right;
    align-items: flex-end;
  }
  .realized {
    grid-area: realized;
    text-align: right;
    align-items: flex-end;
  }
  .realized::before {
    content: 'réalisé';
    font-size: var(--fs-xs);
    color: var(--fg-muted);
  }
  .total {
    grid-area: total;
    text-align: right;
    align-items: flex-end;
    font-size: var(--fs-lg);
  }
  .small {
    font-size: var(--fs-xs);
  }
  .flag {
    grid-column: 1 / -1;
    font-size: var(--fs-xs);
    color: var(--warn);
  }
  @media (min-width: 768px) {
    .row {
      grid-template-columns: 2fr 1.4fr 1fr 1fr 1.2fr 1fr 1fr;
      grid-template-areas: 'id qty price value latent realized total';
      align-items: center;
      padding: var(--space-2) var(--space-4);
    }
    .price {
      display: flex;
      text-align: right;
      align-items: flex-end;
    }
    .value {
      text-align: right;
      align-items: flex-end;
    }
    .realized::before {
      content: none;
    }
    .total {
      font-size: var(--fs-md);
    }
  }
</style>
