<script lang="ts">
  /**
   * Fraîcheur des prix : « Prix : il y a 2 min · CoinGecko, Hyperliquid », badge « périmé » si une
   * cotation vient du cache au-delà du délai (ou hors ligne). Texte, jamais la couleur seule.
   * Reste visible en mode discret : ce n'est ni un montant ni une quantité (décision n° 16).
   */
  import { onMount } from 'svelte';
  import { nowMs } from '$lib/clock';
  import { fmtRelative } from '$lib/format/fr';
  import { app } from '../../state/app.svelte';

  let tick = $state(nowMs());
  onMount(() => {
    const id = setInterval(() => (tick = nowMs()), 30_000);
    return () => clearInterval(id);
  });

  const quotes = $derived(
    [...app.report.positions, ...app.report.stablecoins].flatMap((p) => (p.price ? [p.price] : [])),
  );
  const sources = $derived([...new Set(quotes.map((q) => q.source))]);
  const stale = $derived(quotes.some((q) => q.stale));
  const text = $derived.by((): string => {
    const status = app.priceStatus;
    if (status.loading) return 'Mise à jour des prix…';
    if (app.state.ui.priceSource === 'off') return 'Prix désactivés (réglages)';
    if (!app.report.pricedAt)
      return status.online === false ? 'Hors ligne — aucun prix' : 'Prix non chargés';
    const rel = fmtRelative(app.report.pricedAt, tick);
    const from = sources.length > 0 ? ` · ${sources.join(', ')}` : '';
    return status.online === false
      ? `Hors ligne — derniers prix ${rel}${from}`
      : `Prix : ${rel}${from}`;
  });
</script>

<p class="freshness muted small">
  <span>{text}</span>
  {#if stale}<span class="badge" title="Au moins un prix vient du cache : actualisez">périmé</span
    >{/if}
</p>

<style>
  .freshness {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
  }
  .badge {
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--warn);
    border: 1px solid currentColor;
    border-radius: var(--radius-sm);
    padding: 0 var(--space-2);
    line-height: 1.6;
  }
</style>
