<script lang="ts">
  /**
   * Position perp ouverte, présentée comme une ligne de position de l'espace Investissement
   * (même grammaire visuelle qu'`AssetRow`) avec des colonnes de trading : taille · entrée,
   * marque (valeur ÷ taille), valeur notionnelle, latent (et % sur la marge engagée),
   * liquidation. La ligne mène à l'aller-retour ouvert (détail + journal) quand il existe.
   */
  import { D, ZERO, divOrNull, type Big } from '$lib/domain/money';
  import type { OpenPosition } from '$lib/domain/trading/types';
  import { fmtPrice } from '$lib/format/fr';
  import { router } from '$lib/router.svelte';
  import CoinBadge from '../shared/CoinBadge.svelte';
  import Money from '../shared/Money.svelte';
  import Pct from '../shared/Pct.svelte';
  import Qty from '../shared/Qty.svelte';
  import { app } from '../../state/app.svelte';

  let { position, tripId }: { position: OpenPosition; tripId: string | null } = $props();
  const p = $derived(position);
  const money = (value: Big): Big | null => app.usdcToDisplay(value);
  /** Prix de marque déduit de l'instantané : valeur notionnelle ÷ taille. */
  const mark = $derived(divOrNull(D(p.value).abs(), D(p.size)));
  const upnl = $derived(D(p.unrealizedPnl));
  /** Rendement sur la marge engagée (ROE), pas sur le notionnel. */
  const roe = $derived(D(p.marginUsed).gt(ZERO) ? upnl.div(p.marginUsed) : null);
</script>

<li class="item">
  <svelte:element
    this={tripId ? 'a' : 'div'}
    class="row"
    href={tripId ? router.href({ name: 'trade', id: tripId }) : undefined}
  >
    <span class="cell id"
      ><CoinBadge asset={p.symbol.toLowerCase()} /><span class="names"
        ><strong>{p.symbol}</strong><span class="small dir {p.side}"
          >{p.side === 'long' ? 'Long' : 'Short'} ×{p.leverage}
          <span class="muted">({p.leverageType})</span></span
        ></span
      ></span
    >
    <span class="cell qty"
      ><span class="sr-only">Taille</span><Qty value={D(p.size)} abbreviate /><span
        class="muted small">entrée {p.entryPrice ? fmtPrice(p.entryPrice, 'USD') : '—'}</span
      ></span
    >
    <span class="cell price muted"
      ><span class="sr-only">Marque</span>{mark ? fmtPrice(mark, 'USD') : '—'}<span class="small"
        >liq. {p.liquidationPrice ? fmtPrice(p.liquidationPrice, 'USD') : '—'}</span
      ></span
    >
    <span class="cell value"
      ><span class="sr-only">Valeur</span><Money value={money(D(p.value))} compact /></span
    >
    <span class="cell latent"
      ><span class="sr-only">Latent</span><Money
        value={money(upnl)}
        sign
        colored
        strong
        compact
      /><span class="small"><Pct value={roe} /> <span class="muted">sur marge</span></span></span
    >
  </svelte:element>
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
      'id latent'
      'qty value'
      'price price';
    gap: 2px var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--border);
    color: inherit;
    text-decoration: none;
  }
  a.row:hover {
    background: var(--bg-sunken);
  }
  .cell {
    display: grid;
    gap: 2px;
    align-content: start;
  }
  .id {
    grid-area: id;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }
  .names {
    display: grid;
    gap: 0;
    min-width: 0;
  }
  .dir {
    font-weight: 700;
  }
  .dir.long {
    color: var(--gain);
  }
  .dir.short {
    color: var(--loss);
  }
  .qty {
    grid-area: qty;
  }
  .price {
    grid-area: price;
  }
  .value {
    grid-area: value;
    text-align: right;
  }
  .latent {
    grid-area: latent;
    text-align: right;
  }
  @media (min-width: 768px) {
    .row {
      grid-template-columns: 2fr 1.4fr 1.4fr 1fr 1.2fr;
      grid-template-areas: 'id qty price value latent';
      align-items: center;
    }
    .qty,
    .price {
      text-align: right;
    }
  }
</style>
