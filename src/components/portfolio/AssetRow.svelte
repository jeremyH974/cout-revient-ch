<script lang="ts">
  import type { PositionReport } from '$lib/domain/engine';

  import { nowMs } from '$lib/clock';
  import { fmtPrice as fmtPriceBase, fmtRelative } from '$lib/format/fr';
  import { assetName } from '$lib/pricing/tickers';
  import { router } from '$lib/router.svelte';
  import CoinBadge from '../shared/CoinBadge.svelte';
  import Money from '../shared/Money.svelte';
  import Pct from '../shared/Pct.svelte';
  import Qty from '../shared/Qty.svelte';
  import { app } from '../../state/app.svelte';
  const price = (v: Parameters<typeof fmtPriceBase>[0]): string => fmtPriceBase(v, app.currency);

  let { position, now = nowMs() }: { position: PositionReport; now?: number } = $props();
  const p = $derived(position);
</script>

<!--
  Une position = un lien (vers la fiche de l'actif) dans une liste : les rôles de tableau ne
  conviennent pas à des lignes cliquables. Les libellés invisibles (« Prix », « Valeur »…) donnent
  aux lecteurs d'écran ce que l'en-tête visuel fournit sur grand écran.
-->
<li class="item">
  <a class="row" href={router.href({ name: 'asset', asset: p.asset })}>
    <span class="cell id"
      ><CoinBadge asset={p.asset} /><span class="names"
        ><strong
          >{p.asset.toUpperCase()}{#if p.price?.stale}<span
              class="stale"
              title="Prix issu du cache : actualisez">périmé</span
            >{/if}</strong
        ><span class="muted small">{assetName(p.asset)}</span></span
      ></span
    >
    <span class="cell qty"
      ><span class="sr-only">Quantité</span><Qty value={p.qty} abbreviate /><span
        class="muted small">PRU {p.pru ? price(p.pru) : '—'}</span
      ></span
    >
    <span class="cell price muted"
      ><span class="sr-only">Prix</span>{p.price ? price(p.price.priceEur) : '—'}{#if p.price}<span
          class="small source">{p.price.source} · {fmtRelative(p.price.at, now)}</span
        >{/if}</span
    >
    <span class="cell value"
      ><span class="sr-only">Valeur</span><Money value={p.value} compact /></span
    >
    <span class="cell latent"
      ><span class="sr-only">Latent</span><Money value={p.unrealized} sign colored compact /><span
        class="small"><Pct value={p.unrealizedPct} /> <span class="muted">vs PRU</span></span
      ></span
    >
    <span class="cell realized"
      ><span class="label">Réalisé</span><Money value={p.realized} sign colored compact /></span
    >
    <span class="cell total"
      ><span class="sr-only">Total</span><Money value={p.total} sign colored strong compact /></span
    >
    {#if p.status === 'no-price'}<span class="flag warn">Prix indisponible</span>{/if}
    {#if p.status === 'needs-qualification'}<span class="flag warn">À qualifier</span>{/if}
  </a>
</li>

<style>
  .item {
    list-style: none;
    margin: 0;
    padding: 0;
  }
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
    justify-content: flex-start;
    text-align: left;
    gap: var(--space-3);
  }
  .names {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    line-height: 1.2;
    min-width: 0;
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
  .label {
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
  .stale {
    margin-left: var(--space-2);
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--warn);
    border: 1px solid currentColor;
    border-radius: var(--radius-sm);
    padding: 0 var(--space-1);
    vertical-align: middle;
  }
  .source {
    white-space: nowrap;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
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
      flex-direction: column;
      text-align: right;
      align-items: flex-end;
    }
    .value {
      text-align: right;
      align-items: flex-end;
    }
    /* Sur grand écran l'en-tête de colonnes suffit visuellement : le libellé reste lu à l'oral. */
    .label {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }
    .total {
      font-size: var(--fs-md);
    }
  }
</style>
