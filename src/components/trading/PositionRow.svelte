<script lang="ts">
  /**
   * Position perp ouverte, présentée comme une ligne de position de l'espace Investissement
   * (même grammaire visuelle qu'`AssetRow`) avec des colonnes de trading : taille · entrée,
   * marque (valeur ÷ taille), valeur notionnelle, latent (et % sur la marge engagée),
   * distance à la liquidation (P123). La ligne mène à l'aller-retour ouvert (détail + journal)
   * quand il existe.
   */
  import { D, ZERO, divOrNull, type Big } from '$lib/domain/money';
  import { isNearLiquidation, liquidationDistance } from '$lib/domain/trading/liquidation';
  import type { OpenPosition } from '$lib/domain/trading/types';
  import { fmtMoney, fmtPct, fmtPrice } from '$lib/format/fr';
  import { router } from '$lib/router.svelte';
  import CoinBadge from '../shared/CoinBadge.svelte';
  import Info from '../shared/Info.svelte';
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
  /**
   * ROE % comme sur la plateforme : P&L latent ÷ marge INITIALE (valeur d'entrée ÷ levier),
   * pas la marge au prix de marque — vérifié sur données réelles le 23/08/2026
   * (BTC 40x : 2 022 ÷ (152 872 ÷ 40) = +52,9 %, le chiffre affiché par Hyperliquid).
   */
  const initialMargin = $derived.by((): Big => {
    if (p.entryPrice !== null && p.leverage > 0)
      return D(p.entryPrice).times(p.size).div(String(p.leverage));
    return D(p.marginUsed);
  });
  const roe = $derived(initialMargin.gt(ZERO) ? upnl.div(initialMargin) : null);

  // --- Distance à la liquidation (P123) ----------------------------------------------------
  const distance = $derived(liquidationDistance(p));
  /**
   * Le badge « proche » ne s'ajoute qu'à la phrase de distance elle-même : un instantané PÉRIMÉ
   * (`breached`) est toujours « proche » au sens de la fraction (≤ 0, donc ≤ 10 %), mais sa
   * propre phrase (« Instantané périmé ») porte déjà l'alerte — un second mot ferait doublon.
   */
  const near = $derived(
    distance.kind === 'value' && !distance.breached && isNearLiquidation(distance),
  );
  /** Texte visible, jamais un chiffre en dur : les quatre états de `LiquidationDistance`. */
  const liqText = $derived.by((): string => {
    if (distance.kind === 'none') return 'Pas de seuil de liquidation au collatéral actuel';
    if (distance.kind === 'unknown') return 'Distance à la liquidation indisponible';
    if (distance.breached) return 'Instantané périmé : actualisez';
    const verb = p.side === 'long' ? 'Peut baisser de' : 'Peut monter de';
    const pct = fmtPct(distance.fraction, { sign: false });
    const gap = fmtMoney(distance.priceGap, 'USD', { sign: true });
    return `${verb} ${pct} (${gap}) avant liquidation`;
  });
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
      ><span class="sr-only">Marque</span>{mark ? fmtPrice(mark, 'USD') : '—'}</span
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
      /><span class="small"><Pct value={roe} /> <span class="muted">ROE</span></span></span
    >
    <span class="liq small muted">
      {liqText}
      {#if near}<span
          class="badge"
          title="Écart sous les 10 % du prix de marque (heuristique d'affichage)">proche</span
        >{/if}
      {#if distance.kind === 'value' && !distance.breached && distance.crossMargin}<Info
          title="Marge croisée"
          >En marge croisée, ce seuil dépend de tout le compte : il suppose le reste inchangé, et un
          dépôt, un retrait ou une autre position peut le déplacer.</Info
        >{/if}
    </span>
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
      'price price'
      'liq liq';
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
  .liq {
    grid-area: liq;
    font-size: var(--fs-xs);
  }
  .badge {
    display: inline-block;
    margin-left: var(--space-1);
    padding: 0 var(--space-2);
    border: 1px solid currentColor;
    border-radius: var(--radius-sm);
    color: var(--warn);
    font-size: var(--fs-xs);
    font-weight: 600;
    line-height: 1.6;
  }
  @media (min-width: 768px) {
    .row {
      grid-template-columns: 2fr 1.4fr 1.4fr 1fr 1.2fr;
      grid-template-areas:
        'id qty price value latent'
        'liq liq liq liq liq';
      align-items: center;
    }
    .qty,
    .price {
      text-align: right;
    }
  }
</style>
