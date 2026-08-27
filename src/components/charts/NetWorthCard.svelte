<script lang="ts">
  import { onMount } from 'svelte';
  import { nowMs } from '$lib/clock';
  import { fmtDate, fmtMoney } from '$lib/format/fr';
  import { periodWindow, sliceSeries, todayOf, type Period } from '$lib/history';
  import { hasUnavailable, latestNetWorth, type NetWorthPoint } from '$lib/history/net-worth';
  import { app } from '../../state/app.svelte';
  import { history } from '../../state/history.svelte';
  import Info from '../shared/Info.svelte';
  import EvolutionChart, { type ChartPoint } from './EvolutionChart.svelte';

  /**
   * La période vient du tableau de bord et n'est plus choisie ici : un seul contexte de temps
   * pour tout l'écran, sinon le chiffre du bandeau et la courbe parlent de deux fenêtres
   * différentes sans que rien ne le signale (règle « unify » de l'ISO 24896:2026).
   */
  let { period }: { period: Period } = $props();
  onMount(() => void history.ensure());

  const today = $derived(todayOf(nowMs()));
  // La série est calculée une fois dans l'état d'historique : le bandeau, la réconciliation et
  // cette courbe lisent le MÊME objet, donc aucun des trois ne peut diverger des deux autres.
  const series = $derived<NetWorthPoint[]>(history.netWorth);
  const window = $derived(periodWindow(period, today));
  const visible = $derived(
    sliceSeries(series, { from: window.from ?? series[0]?.day ?? today, to: window.to }),
  );

  /**
   * Courbe principale : la valeur nette. Courbe secondaire : les apports nets cumulés. L'écart
   * entre les deux EST le gain — c'est ce qui distingue cette courbe d'un solde de compte, où un
   * virement ressemble à une performance.
   */
  const points = $derived<ChartPoint[]>(
    visible.map((p) => ({
      day: p.day,
      primary: Number(p.net.toFixed(2)),
      secondary: Number(p.contributed.toFixed(2)),
      estimated: p.estimated.length > 0,
    })),
  );

  const latest = $derived(latestNetWorth(visible));
  const incomplete = $derived(hasUnavailable(visible));
  const tradingCount = $derived(history.netWorthContributions.length - 1);
</script>

<section class="card group" aria-labelledby="net-worth-title">
  <header>
    <h2 id="net-worth-title">Évolution du patrimoine</h2>
    <Info title="Évolution du patrimoine"
      >Ce que vous possédez, jour après jour, investissement et trading réunis. La courbe claire est
      le total de vos apports — l'argent entré dans le périmètre, jamais le coût de vos positions :
      l'écart entre les deux est votre résultat. Un virement déplace les deux courbes ensemble et ne
      ressemble donc jamais à une performance.</Info
    >
  </header>

  {#if points.length === 0}
    <p class="empty">Importez un export ou synchronisez un compte pour voir votre patrimoine.</p>
  {:else}
    <EvolutionChart
      {points}
      currency={app.currency}
      discreet={app.state.ui.discreet}
      colorMode="vsSecondary"
      labels={{ primary: 'Patrimoine', secondary: 'Apports nets' }}
    />
    {#if latest}
      <!--
        Équivalent textuel du graphique : un tracé SVG seul n'est lisible par personne au lecteur
        d'écran. C'est aussi l'ancrage du contrôle de cohérence — ce montant doit égaler, au
        centime, le « Patrimoine » du bandeau ci-dessus.
      -->
      <p class="summary" data-testid="net-worth-latest">
        Au {fmtDate(latest.day)}, patrimoine
        <strong data-testid="net-worth-latest-value">{fmtMoney(latest.net, app.currency)}</strong>,
        pour <strong>{fmtMoney(latest.contributed, app.currency)}</strong> d'apports nets.
      </p>
    {/if}
    <p class="legend">
      {#if tradingCount > 0}
        Investissement + {tradingCount} compte{tradingCount > 1 ? 's' : ''} de trading. L'équité de trading
        est ramenée à un point par jour : la courbe de l'écran Trading, non amincie, reste la référence
        pour lire un épisode violent.
      {:else}
        Espace Investissement seul — aucun compte de trading synchronisé.
      {/if}
    </p>
    {#if incomplete}
      <p class="warn" role="status">
        Certains jours sont <strong>incomplets</strong> : un compte n'a pas pu être converti en euros
        faute de taux de change. Le total affiché est donc trop bas sur ces jours-là, et non approché.
        Actualisez les taux depuis les réglages.
      </p>
    {/if}
  {/if}
</section>

<style>
  .group {
    padding: var(--space-4);
    display: grid;
    gap: var(--space-3);
  }
  header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  h2 {
    margin: 0;
    font-size: var(--fs-md);
  }
  .summary {
    margin: 0;
    font-size: var(--fs-sm);
    color: var(--fg);
  }
  .empty,
  .legend {
    margin: 0;
    font-size: var(--fs-xs);
    color: var(--fg-muted);
  }
  .warn {
    margin: 0;
    font-size: var(--fs-sm);
    color: var(--fg);
    border-left: 3px solid var(--warn, var(--border));
    padding-left: var(--space-3);
  }
</style>
